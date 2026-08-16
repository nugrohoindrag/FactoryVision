import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Batch, type Product } from '@fv/contracts';
import {
  buildAlerts,
  isPoOverdue,
  isPoPartialStale,
  lastMovementByProduct,
  sortAlerts,
  type Alert as DomainAlert,
} from '@fv/domain';
import { log } from '../common/logger.js';
import { runAsSystem } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectorService } from '../projection/projector.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { PushService } from './push.service.js';

/**
 * B-066 / B-070 — the nine thresholds of PRD F11, and the reason each one only
 * fires once.
 *
 * ## Why alerts are rows and not a query
 *
 * The obvious implementation recomputes the list every time somebody looks. It
 * is also the implementation that sends "material issue open past 24 hours"
 * every five minutes for three days.
 *
 * That is not a cosmetic problem. An operator who gets thirty notifications
 * about one issue turns notifications off, and the moment they do, the metric
 * this whole product is built around — open issues closed within 24 hours,
 * PRD §11 — stops reaching anybody at all. The alert that matters most is the
 * one most likely to be silenced by repetition.
 *
 * So each live alert is a row keyed by `(kind, subject)`. It is raised once,
 * notified once, refreshed quietly while it persists, and cleared when the
 * condition goes away.
 */
@Injectable()
export class AlertService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectorService) private readonly projector: ProjectorService,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  /** Evaluates one tenant. Returns what changed, not the whole list. */
  async evaluate(
    tenantId: string,
    now = new Date(),
  ): Promise<{ raised: number; cleared: number; notified: number }> {
    return runAsSystem(tenantId, async () => {
      const today = now.toISOString().slice(0, 10);
      const { config } = await this.tenants.config(tenantId);

      const [stock, issues, purchaseOrders, tasks, events, productRows, batchRows] =
        await Promise.all([
          this.projector.stock(tenantId),
          this.projector.issues(tenantId),
          this.projector.purchaseOrders(tenantId),
          this.projector.tasks(tenantId, today),
          this.projector.log(tenantId),
          this.prisma.raw.product.findMany({ where: { tenantId } }),
          this.prisma.raw.batch.findMany({ where: { tenantId } }),
        ]);

      const products = productRows.map(
        (row): Product => ({
          id: row.id,
          tenantId: row.tenantId as Product['tenantId'],
          sku: row.sku,
          name: row.name,
          itemClass: row.itemClass as Product['itemClass'],
          baseUnit: row.baseUnit,
          conversions: (row.conversions ?? []) as Product['conversions'],
          shelfLifeDays: row.shelfLifeDays ?? undefined,
          minimumStock: row.minimumStock?.toString(),
          averageCost: row.averageCost?.toString(),
          active: row.active,
        }),
      );

      const batches = batchRows.map(
        (row): Batch => ({
          id: row.id,
          tenantId: row.tenantId as Batch['tenantId'],
          productId: row.productId,
          batchNo: row.batchNo,
          producedOn: row.producedOn?.toISOString().slice(0, 10),
          expiryDate: row.expiryDate?.toISOString().slice(0, 10),
          supplierId: row.supplierId ?? undefined,
          purchaseOrderId: row.purchaseOrderId ?? undefined,
        }),
      );

      /* --- six of the nine come straight from @fv/domain ----------------- */
      const domainAlerts = buildAlerts({
        now,
        today,
        stock,
        products,
        batches,
        issues: [...issues.values()],
        config: {
          issueOverdueHours: config.defaults.issueOverdueHours,
          expiryWarningDays: config.defaults.expiryWarningDays,
          deadStockDays: config.defaults.deadStockDays,
          quarantineWarningDays: config.defaults.quarantineWarningDays,
        },
        lastMovement: lastMovementByProduct(events),
      });

      const live: LiveAlert[] = sortAlerts(domainAlerts).map((alert) => ({
        kind: alert.kind,
        subjectId: subjectOf(alert),
        severity: alert.severity,
        payload: { title: alert.title, detail: alert.detail, value: alert.value, href: alert.href },
      }));

      /* --- the three PRD v1.3 added, which live above the domain layer --- */
      for (const po of purchaseOrders) {
        if (isPoOverdue(po, today)) {
          live.push({
            kind: 'PO_OVERDUE',
            subjectId: po.purchaseOrderId,
            severity: 'warning',
            payload: {
              title: `${po.poNo} is past its promised date`,
              detail: `Expected ${po.eta}. Nothing has arrived yet.`,
            },
          });
        }
        if (isPoPartialStale(po, today, config.defaults.poPartialStaleDays)) {
          live.push({
            kind: 'PO_PARTIAL_STALE',
            subjectId: po.purchaseOrderId,
            severity: 'warning',
            payload: {
              title: `${po.poNo} is still short`,
              detail:
                'Part of this order arrived and the rest never followed. It is still owed by ' +
                'the supplier until somebody closes it with a reason.',
            },
          });
        }
      }

      const unclaimedCutoffMs = config.defaults.taskUnclaimedHours * 3_600_000;
      for (const task of tasks) {
        if (task.status !== 'UNASSIGNED') continue;
        const age = now.getTime() - new Date(task.createdAt).getTime();
        if (age < unclaimedCutoffMs) continue;
        live.push({
          kind: 'TASK_UNCLAIMED',
          subjectId: task.id,
          severity: 'warning',
          payload: {
            title: 'Nobody has picked this job up',
            detail: `${task.label} has been waiting more than ${config.defaults.taskUnclaimedHours} hours.`,
          },
        });
      }

      return this.reconcile(tenantId, live, now);
    });
  }

  /**
   * B-070 — the difference between a live alert and a new one.
   *
   * Already open → touch `lastSeen` and say nothing. New → insert and notify
   * once. Gone → clear it, so a resolved issue stops occupying the dashboard.
   */
  private async reconcile(
    tenantId: string,
    live: readonly LiveAlert[],
    now: Date,
  ): Promise<{ raised: number; cleared: number; notified: number }> {
    const open = await this.prisma.raw.alert.findMany({ where: { tenantId, clearedAt: null } });
    const openByKey = new Map(open.map((row) => [`${row.kind}|${row.subjectId}`, row]));
    const liveKeys = new Set(live.map((alert) => `${alert.kind}|${alert.subjectId}`));

    let raised = 0;
    let notified = 0;

    for (const alert of live) {
      const key = `${alert.kind}|${alert.subjectId}`;
      const existing = openByKey.get(key);

      if (existing) {
        await this.prisma.raw.alert.updateMany({
          where: { id: existing.id },
          data: { lastSeen: now, payload: alert.payload as object },
        });
        continue;
      }

      await this.prisma.raw.alert.upsert({
        where: { tenantId_kind_subjectId: { tenantId, kind: alert.kind, subjectId: alert.subjectId } },
        create: {
          id: uuidv7(),
          tenantId,
          kind: alert.kind,
          subjectId: alert.subjectId,
          severity: alert.severity,
          payload: alert.payload as object,
        },
        // Re-raised after being cleared: the condition came back, so it counts
        // as new and is worth telling somebody about again.
        update: {
          severity: alert.severity,
          payload: alert.payload as object,
          firstSeen: now,
          lastSeen: now,
          clearedAt: null,
          notifiedAt: null,
        },
      });
      raised += 1;

      const sent = await this.push.notifyTenant(tenantId, alert);
      if (sent > 0) {
        await this.prisma.raw.alert.updateMany({
          where: { tenantId, kind: alert.kind, subjectId: alert.subjectId },
          data: { notifiedAt: now },
        });
        notified += 1;
      }
    }

    const stale = open.filter((row) => !liveKeys.has(`${row.kind}|${row.subjectId}`));
    if (stale.length > 0) {
      await this.prisma.raw.alert.updateMany({
        where: { id: { in: stale.map((row) => row.id) } },
        data: { clearedAt: now },
      });
    }

    if (raised > 0 || stale.length > 0) {
      log().info({ tenantId, raised, cleared: stale.length, notified }, 'Alerts reconciled');
    }

    return { raised, cleared: stale.length, notified };
  }

  async open(tenantId: string) {
    const rows = await this.prisma.raw.alert.findMany({
      where: { tenantId, clearedAt: null },
      orderBy: [{ severity: 'asc' }, { firstSeen: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      subjectId: row.subjectId,
      severity: row.severity,
      since: row.firstSeen.toISOString(),
      notified: Boolean(row.notifiedAt),
      ...(row.payload as object),
    }));
  }
}

interface LiveAlert {
  kind: string;
  subjectId: string;
  severity: string;
  payload: Record<string, unknown>;
}

/**
 * The thing an alert is about, pulled out of the domain alert's id.
 *
 * `@fv/domain` builds ids like `issue-<issueId>` and `min-<productId>` — a
 * prefix plus the subject, which is exactly what this table keys on. Splitting
 * it here rather than changing the domain keeps the alert builder usable on the
 * device, where there is no table and no dedup to do.
 */
function subjectOf(alert: DomainAlert): string {
  const separator = alert.id.indexOf('-');
  return separator === -1 ? alert.id : alert.id.slice(separator + 1);
}
