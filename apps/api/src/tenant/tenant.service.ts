import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_TENANT_CONFIG,
  TenantConfigSchema,
  uuidv7,
  type TenantConfig,
  type TenantConfigPatch,
} from '@fv/contracts';
import { AppError } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * B-013 / B-021 / B-058 — creating a factory, and what happens when it stops
 * paying.
 *
 * Registration takes three fields: factory name, owner name, phone. No tax
 * number, no full address. PRD F13.1 puts it plainly — every extra field at
 * signup pushes `time-to-value < 48 hours` further away, and the fields nobody
 * needs at signup are exactly the ones a factory owner abandons the form over.
 *
 * When the trial ends the tenant becomes READ-ONLY. It is not locked out, and
 * that is a product decision with a reason attached (Prinsip 8): withholding a
 * customer's own data is the fastest way to lose their trust, and it applies
 * just as much to the ones who have not paid yet.
 */
@Injectable()
export class TenantService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async createTenant(input: {
    factoryName: string;
    ownerName: string;
    phone: string;
  }): Promise<{ tenantId: string; userId: string }> {
    const existing = await this.prisma.raw.user.findUnique({ where: { phone: input.phone } });
    if (existing) {
      throw new AppError(
        'CONFLICT',
        'That phone number already has an account. Sign in instead of registering.',
      );
    }

    const tenantId = uuidv7();
    const userId = uuidv7();
    const trialEndsAt = new Date(Date.now() + this.env.TRIAL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.raw.$transaction([
      this.prisma.raw.tenant.create({
        data: { id: tenantId, name: input.factoryName, trialEndsAt },
      }),
      this.prisma.raw.user.create({
        data: {
          id: userId,
          tenantId,
          phone: input.phone,
          name: input.ownerName,
          // The person who registers the factory owns it. There is nobody else
          // yet, and a tenant whose only user cannot approve anything is a
          // tenant that cannot finish its first stock take.
          role: 'OWNER',
        },
      }),
      this.prisma.raw.tenantConfig.create({
        data: { tenantId, value: DEFAULT_TENANT_CONFIG as object, version: 1 },
      }),
    ]);

    return { tenantId, userId };
  }

  /** Merged over the Manufaktur defaults, exactly as the device does it. */
  async config(tenantId: string): Promise<{ config: TenantConfig; version: number }> {
    const row = await this.prisma.raw.tenantConfig.findUnique({ where: { tenantId } });
    if (!row) return { config: DEFAULT_TENANT_CONFIG, version: 0 };

    const parsed = TenantConfigSchema.safeParse(row.value);
    // A stored document that no longer parses is a bug in a migration, not a
    // reason to stop the factory working. Fall back loudly to the defaults.
    if (!parsed.success) return { config: DEFAULT_TENANT_CONFIG, version: row.version };
    return { config: parsed.data, version: row.version };
  }

  /**
   * Patches configuration branch by branch.
   *
   * `locationLevels` is replaced wholesale and never merged element by element.
   * A tenant shortening `['Warehouse','Zone','Rack']` to `['Warehouse','Rack']`
   * means exactly that — merging would quietly keep the third level alive and
   * the screen would then disagree with the setting that produced it.
   */
  async updateConfig(tenantId: string, patch: TenantConfigPatch): Promise<{ config: TenantConfig; version: number }> {
    const { config: current, version } = await this.config(tenantId);

    const next: TenantConfig = {
      ...current,
      ...patch,
      terms: { ...current.terms, ...(patch.terms ?? {}) },
      stages: { ...current.stages, ...(patch.stages ?? {}) },
      fieldRules: { ...current.fieldRules, ...(patch.fieldRules ?? {}) } as TenantConfig['fieldRules'],
      autoPass: { ...current.autoPass, ...(patch.autoPass ?? {}) } as TenantConfig['autoPass'],
      deepInspection: {
        ...current.deepInspection,
        ...(patch.deepInspection ?? {}),
      } as TenantConfig['deepInspection'],
      defaults: { ...current.defaults, ...(patch.defaults ?? {}) },
      reasons: { ...current.reasons, ...(patch.reasons ?? {}) },
      locationLevels: patch.locationLevels?.length ? patch.locationLevels : current.locationLevels,
    };

    const parsed = TenantConfigSchema.parse(next);

    await this.prisma.raw.tenantConfig.upsert({
      where: { tenantId },
      create: { tenantId, value: parsed as object, version: 1 },
      update: { value: parsed as object, version: version + 1 },
    });

    return { config: parsed, version: version + 1 };
  }

  /** True once the trial has run out and nothing has been paid (B-021). */
  async isReadOnly(tenantId: string, now = new Date()): Promise<boolean> {
    const tenant = await this.prisma.raw.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return true;
    if (tenant.paidUntil && tenant.paidUntil > now) return false;
    return tenant.trialEndsAt <= now;
  }
}
