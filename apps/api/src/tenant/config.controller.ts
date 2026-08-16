import { Controller, Get, Inject, Post } from '@nestjs/common';
import { TenantConfigPatch } from '@fv/contracts';
import { Requires, Write } from '../auth/public.decorator.js';
import { audit } from '../common/audit.js';
import { requireActor } from '../common/request-context.js';
import { ZodBody } from '../common/zod.js';
import { MasterService } from '../master/master.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantService } from './tenant.service.js';

/**
 * B-058 — K14 Settings.
 *
 * Everything PRD §9.2 lists as configuration lives in one document, versioned
 * so a device can tell whether the copy it cached offline is still current.
 *
 * The interesting endpoint is the levels one below. Renaming a warehouse level
 * is language and costs nothing; REMOVING one is structural, and it is refused
 * while real locations still sit at that depth. Allowing it would leave those
 * rows with a depth that has no name — they would not vanish, they would render
 * as blanks in every picker, which is worse than an error.
 */
@Controller('config')
export class ConfigController {
  constructor(
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(MasterService) private readonly master: MasterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  async read() {
    const actor = requireActor();
    return this.tenants.config(actor.tenantId);
  }

  @Post()
  @Write()
  @Requires('config.write')
  async update(@ZodBody(TenantConfigPatch) patch: TenantConfigPatch) {
    const actor = requireActor();

    if (patch.locationLevels) {
      await this.master.assertLevelsRemovable(patch.locationLevels as string[]);
    }

    const before = await this.tenants.config(actor.tenantId);
    const after = await this.tenants.updateConfig(actor.tenantId, patch);

    await audit(this.prisma, {
      action: 'config.updated',
      subject: 'tenantConfig',
      subjectId: actor.tenantId,
      before: { version: before.version },
      after: { version: after.version, changed: Object.keys(patch) },
    });

    return after;
  }

  /** How many locations sit at each depth — what K14 shows next to each level. */
  @Get('location-levels/usage')
  async levelUsage() {
    const usage = await this.master.depthUsage();
    return [...usage.entries()].map(([depth, count]) => ({ depth, count }));
  }
}
