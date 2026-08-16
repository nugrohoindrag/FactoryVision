import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { uuidv7 } from '@fv/contracts';
import { z } from 'zod';
import { Requires, Write } from '../auth/public.decorator.js';
import { audit } from '../common/audit.js';
import { big } from '../common/decimal.js';
import { AppError } from '../common/errors.js';
import { requireActor } from '../common/request-context.js';
import { ZodBody } from '../common/zod.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { AlertService } from './alert.service.js';
import { PushService } from './push.service.js';
import { SchedulerService } from './scheduler.service.js';

/**
 * F11 alerts, F9 approvals, and the push plumbing behind both.
 */
@Controller()
export class AlertsController {
  constructor(
    @Inject(AlertService) private readonly alerts: AlertService,
    @Inject(PushService) private readonly push: PushService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  @Get('alerts')
  async list() {
    const actor = requireActor();
    return this.alerts.open(actor.tenantId);
  }

  /** Forces an evaluation. Used by the dashboard on open and by operations. */
  @Post('alerts/evaluate')
  async evaluate() {
    const actor = requireActor();
    return this.alerts.evaluate(actor.tenantId);
  }

  /** Runs the whole background pass now — for a smoke test after deploy. */
  @Post('alerts/tick')
  @Requires('config.write')
  async tick() {
    return this.scheduler.tick();
  }

  /* --- push (B-064, B-069) ------------------------------------------------ */

  @Get('push/key')
  key(): { publicKey: string } {
    return { publicKey: this.push.publicKey() };
  }

  @Post('push/subscribe')
  @Write()
  async subscribe(
    @ZodBody(
      z.object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      }),
    )
    body: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    const actor = requireActor();
    await this.push.subscribe({
      tenantId: actor.tenantId,
      userId: actor.actorId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    return { ok: true };
  }

  @Post('push/unsubscribe')
  @Write()
  async unsubscribe(@ZodBody(z.object({ endpoint: z.string().url() })) body: { endpoint: string }) {
    await this.push.unsubscribe(body.endpoint);
    return { ok: true };
  }

  /* --- B-068 approvals ---------------------------------------------------- */

  /**
   * An adjustment above the tenant's threshold waits for the owner (PRD F9).
   *
   * The event is written and synced as normal — the stock moves when the
   * operator says it moved, because that is what actually happened on the floor.
   * What waits is the OWNER'S SIGN-OFF, recorded here alongside it. Holding the
   * stock movement itself would mean the system disagrees with the warehouse
   * until somebody checks their phone, and the warehouse is the one that is
   * right.
   */
  @Post('approvals')
  @Write()
  async request(
    @ZodBody(
      z.object({
        kind: z.literal('ADJUSTMENT'),
        subjectId: z.string().min(1),
        value: z.string().regex(/^-?\d+(\.\d+)?$/),
        note: z.string().optional(),
      }),
    )
    body: { kind: 'ADJUSTMENT'; subjectId: string; value: string; note?: string },
  ) {
    const actor = requireActor();
    const { config } = await this.tenants.config(actor.tenantId);
    const threshold = config.defaults.approvalThresholdValue;

    const needed = big(body.value).abs().gte(big(threshold));
    if (!needed) {
      return { required: false, threshold };
    }

    const id = uuidv7();
    await this.prisma.raw.approval.create({
      data: {
        id,
        tenantId: actor.tenantId,
        kind: body.kind,
        subjectId: body.subjectId,
        requestedBy: actor.actorId,
        payload: { value: body.value, note: body.note } as object,
      },
    });

    await this.push.notifyTenant(actor.tenantId, {
      kind: 'APPROVAL_PENDING',
      payload: {
        title: 'An adjustment needs your approval',
        detail: `Rp ${body.value} — ${body.note ?? 'no note given'}`,
        href: `/approvals/${id}`,
      },
    });

    return { required: true, approvalId: id, threshold };
  }

  @Get('approvals')
  async pending() {
    const actor = requireActor();
    const rows = await this.prisma.raw.approval.findMany({
      where: { tenantId: actor.tenantId, decidedAt: null },
      orderBy: { requestedAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      subjectId: row.subjectId,
      requestedBy: row.requestedBy,
      requestedAt: row.requestedAt.toISOString(),
      ...(row.payload as object),
    }));
  }

  @Post('approvals/:id/decide')
  @Write()
  @Requires('approval.decide')
  async decide(
    @Param('id') id: string,
    @ZodBody(
      z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().optional() }),
    )
    body: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  ) {
    const actor = requireActor();
    const approval = await this.prisma.raw.approval.findFirst({
      where: { id, tenantId: actor.tenantId },
    });
    if (!approval) throw new AppError('NOT_FOUND', 'That approval is not on this factory');
    if (approval.decidedAt) throw new AppError('CONFLICT', 'That has already been decided');

    await this.prisma.raw.approval.updateMany({
      where: { id },
      data: {
        decidedBy: actor.actorId,
        decidedAt: new Date(),
        decision: body.decision,
        note: body.note,
      },
    });

    await audit(this.prisma, {
      action: `approval.${body.decision.toLowerCase()}`,
      subject: 'approval',
      subjectId: id,
      before: approval.payload,
      reason: body.note,
    });

    return { ok: true };
  }
}
