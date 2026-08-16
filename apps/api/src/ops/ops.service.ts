import { Inject, Injectable } from '@nestjs/common';
import { verifyChain, type HashableEvent } from '@fv/contracts';
import { AppError } from '../common/errors.js';
import { log } from '../common/logger.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectorService } from '../projection/projector.service.js';

/**
 * B-083 → B-092 — the operations surface.
 *
 * Everything here exists for one bad day. None of it adds a feature, and that
 * is exactly why it gets skipped: it is the work that has no demo. For a product
 * that holds the entire stock record of a factory, being able to still have
 * customers after a bad day is not an optional extra.
 */
@Injectable()
export class OpsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectorService) private readonly projector: ProjectorService,
  ) {}

  /**
   * B-083 — proves a backup is restorable by checking what came back.
   *
   * A cron job that runs is not a backup. A dump file that exists is not a
   * backup either. The only thing that counts is a database that was restored
   * and then agreed with itself, which is what this measures: every device's
   * hash chain intact, and the projection rebuildable from the log.
   *
   * Run against the RESTORED copy, not production.
   */
  async verifyRestore(tenantId: string): Promise<RestoreReport> {
    const events = await this.prisma.raw.event.findMany({
      where: { tenantId },
      orderBy: [{ deviceId: 'asc' }, { id: 'asc' }],
    });

    const byDevice = new Map<string, HashableEvent[]>();
    for (const event of events) {
      const list = byDevice.get(event.deviceId) ?? [];
      list.push({
        id: event.id,
        tenantId: event.tenantId,
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
        actorId: event.actorId,
        deviceId: event.deviceId,
        prevHash: event.prevHash,
        payload: event.payload,
        ...({ hash: event.hash } as object),
      } as HashableEvent);
      byDevice.set(event.deviceId, list);
    }

    const chains: RestoreReport['chains'] = [];
    for (const [deviceId, chain] of byDevice) {
      const result = await verifyChain(chain);
      chains.push({
        deviceId,
        events: chain.length,
        ok: result.ok,
        ...(result.ok ? {} : { brokenAt: result.brokenAt, reason: result.reason }),
      });
    }

    // Rebuilding is the second half: an intact log that projects to a different
    // stock figure than it did yesterday is a restore that silently lost rows.
    const before = await this.prisma.raw.stockLine.findMany({ where: { tenantId } });
    const rebuild = await this.projector.rebuild(tenantId);
    const after = await this.prisma.raw.stockLine.findMany({ where: { tenantId } });

    const key = (row: { productId: string; batchId: string | null; locationId: string; status: string; quantity: unknown }) =>
      `${row.productId}|${row.batchId ?? '-'}|${row.locationId}|${row.status}=${row.quantity?.toString()}`;

    const beforeSet = new Set(before.map(key));
    const afterSet = new Set(after.map(key));
    const drifted = [...afterSet].filter((line) => !beforeSet.has(line));

    const report: RestoreReport = {
      tenantId,
      events: events.length,
      chains,
      chainsOk: chains.every((chain) => chain.ok),
      projectionRebuilt: rebuild.lines,
      projectionDrift: drifted,
      ok: chains.every((chain) => chain.ok) && drifted.length === 0,
    };

    log().info({ ...report, chains: chains.length }, 'Restore verification finished');
    return report;
  }

  /**
   * B-088 — how long a full replay takes for this tenant.
   *
   * The number that decides whether checkpointing is an optimisation or a
   * requirement (BP-06). Measured on real data rather than assumed, because a
   * tenant in year three has three times the log of the one this was designed
   * against.
   */
  async replayTiming(tenantId: string): Promise<{
    events: number;
    milliseconds: number;
    eventsPerSecond: number;
  }> {
    const started = process.hrtime.bigint();
    const events = await this.projector.log(tenantId);
    await this.projector.rebuild(tenantId);
    const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000; // decimal-safe: hrtime nanoseconds → ms for a timing report, never a stock quantity

    return {
      events: events.length,
      milliseconds: Math.round(elapsed),
      eventsPerSecond: elapsed > 0 ? Math.round((events.length / elapsed) * 1000) : 0,
    };
  }

  /**
   * B-085 — the audit trail, readable.
   *
   * An audit trail nobody can query is a compliance checkbox. This is the
   * endpoint that answers "who changed that price", which is the question it
   * actually gets asked.
   */
  async auditTrail(
    tenantId: string,
    filter: { subject?: string; subjectId?: string; limit?: number },
  ) {
    const rows = await this.prisma.raw.adminAudit.findMany({
      where: {
        tenantId,
        ...(filter.subject ? { subject: filter.subject } : {}),
        ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      },
      orderBy: { at: 'desc' },
      take: Math.min(filter.limit ?? 200, 1000),
    });

    return rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      actorId: row.actorId,
      action: row.action,
      subject: row.subject,
      subjectId: row.subjectId,
      before: row.before,
      after: row.after,
      reason: row.reason,
    }));
  }

  /**
   * B-092 — deletes a customer completely, on request.
   *
   * The one operation allowed to remove log rows, and it needs the session flag
   * the append-only trigger looks for. Everything else in the product treats the
   * log as permanent; a customer asking to leave is not "everything else".
   *
   * Deliberately not exposed on any route. It runs from a console, by a person
   * who has read the request, because an HTTP endpoint that erases a factory is
   * an HTTP endpoint somebody will eventually call by mistake.
   */
  async deleteTenant(tenantId: string, confirmation: string): Promise<{ deleted: true }> {
    const tenant = await this.prisma.raw.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError('NOT_FOUND', 'No such factory');

    if (confirmation !== tenant.name) {
      // Typing the factory's name is the last thing between a support ticket
      // and an unrecoverable deletion.
      throw new AppError(
        'VALIDATION_FAILED',
        'To delete a factory, pass its exact name as confirmation',
      );
    }

    await this.prisma.raw.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL factoryvision.allow_log_delete = 'on'");
      await tx.tenant.delete({ where: { id: tenantId } });
    });

    log().warn({ tenantId, name: tenant.name }, 'Tenant deleted at customer request');
    return { deleted: true };
  }

  /** B-086 — the numbers a dashboard watches, per tenant and overall. */
  async metrics(): Promise<{
    tenants: number;
    events: number;
    devices: number;
    openConflicts: number;
    openAlerts: number;
    queuedApprovals: number;
  }> {
    const [tenants, events, devices, openConflicts, openAlerts, queuedApprovals] =
      await Promise.all([
        this.prisma.raw.tenant.count(),
        this.prisma.raw.event.count(),
        this.prisma.raw.device.count({ where: { revokedAt: null } }),
        this.prisma.raw.conflict.count({ where: { resolvedAt: null } }),
        this.prisma.raw.alert.count({ where: { clearedAt: null } }),
        this.prisma.raw.approval.count({ where: { decidedAt: null } }),
      ]);

    return { tenants, events, devices, openConflicts, openAlerts, queuedApprovals };
  }
}

export interface RestoreReport {
  tenantId: string;
  events: number;
  chains: {
    deviceId: string;
    events: number;
    ok: boolean;
    brokenAt?: string;
    reason?: string;
  }[];
  chainsOk: boolean;
  projectionRebuilt: number;
  /** Stock lines that came out different after a rebuild. Should be empty. */
  projectionDrift: string[];
  ok: boolean;
}
