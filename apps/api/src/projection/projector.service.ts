import { Inject, Injectable } from '@nestjs/common';
import type { AnyEvent, PurchaseOrder } from '@fv/contracts';
import {
  projectIssues,
  projectPurchaseOrders,
  projectStock,
  projectTasks,
  type IssueBalance,
  type PoProgress,
  type StockLevel,
  type Task,
} from '@fv/domain';
import { toPrismaDecimal } from '../common/decimal.js';
import { log } from '../common/logger.js';
import { EventStoreService } from '../events/event-store.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * B-031 → B-037 — the server's projections.
 *
 * ## One projection, two runtimes
 *
 * Every number below comes out of `@fv/domain`, used exactly as the device uses
 * it. Not adapted, not re-implemented, not "ported to SQL for performance".
 *
 * The rule is worth stating in full because the temptation to break it will be
 * real the first time a report is slow: **if a function here cannot be used as
 * it is, the fix is to change it in `packages/domain`, never to write a second
 * version on this side.** Two implementations of a stock figure will agree for
 * a while and then diverge, and the one that loses is always the one the
 * operator is looking at — which makes it the one that gets blamed, and the
 * product stops being believed. Gate B2 exists to prove they still agree
 * (`test/parity.test.ts`).
 *
 * ## What is materialised, and what is not
 *
 * Only `StockLine` is written to a table, because "how much of this is on that
 * rack" is asked constantly and by every report. Issues, PO progress and tasks
 * are projected on demand: they are bounded (open issues, live POs, open tasks)
 * and a stale copy of them would be worse than the millisecond it costs.
 *
 * The materialised table is derived data and says so — it can be dropped and
 * rebuilt from `event` at any time, which is exactly what `rebuild()` does.
 */
@Injectable()
export class ProjectorService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventStoreService) private readonly store: EventStoreService,
  ) {}

  /**
   * B-032 — replays only what arrived since the last checkpoint.
   *
   * The whole log is still re-folded (the fold has cross-event context, so it
   * cannot start from the middle), but the WRITE is limited to the lines that
   * actually changed. On a tenant with 200,000 movements the difference between
   * rewriting every stock line and rewriting nine is the difference between a
   * sync that finishes and one that times out (BP-06).
   */
  async catchUp(tenantId: string): Promise<{ applied: number; lines: number }> {
    const checkpoint = await this.prisma.raw.projectionCheckpoint.findUnique({
      where: { tenantId },
    });

    const events = await this.store.readLog(tenantId);
    if (events.length === 0) return { applied: 0, lines: 0 };

    const last = events[events.length - 1]!;
    if (checkpoint?.lastEventId === last.id) return { applied: 0, lines: 0 };

    const levels = projectStock(events);
    const written = await this.writeStockLines(tenantId, levels);

    await this.prisma.raw.projectionCheckpoint.upsert({
      where: { tenantId },
      create: {
        tenantId,
        lastEventId: last.id,
        lastReceived: new Date(),
        eventsApplied: events.length,
      },
      update: {
        lastEventId: last.id,
        lastReceived: new Date(),
        eventsApplied: events.length,
        rebuiltAt: new Date(),
      },
    });

    return { applied: events.length, lines: written };
  }

  /**
   * Throws the projection away and rebuilds it from the log.
   *
   * The recovery command, and the proof that the materialised table is only
   * ever a cache. If this ever produced a different answer from `catchUp`, one
   * of them is lying about the warehouse.
   */
  async rebuild(tenantId: string): Promise<{ applied: number; lines: number }> {
    await this.prisma.raw.stockLine.deleteMany({ where: { tenantId } });
    await this.prisma.raw.projectionCheckpoint.deleteMany({ where: { tenantId } });
    const result = await this.catchUp(tenantId);
    log().info({ tenantId, ...result }, 'Projection rebuilt from the event log');
    return result;
  }

  private async writeStockLines(tenantId: string, levels: readonly StockLevel[]): Promise<number> {
    const existing = await this.prisma.raw.stockLine.findMany({ where: { tenantId } });
    const previous = new Map(existing.map((row) => [rowKey(row), row]));

    const seen = new Set<string>();
    let written = 0;

    for (const level of levels) {
      const key = level.key;
      seen.add(key);
      const before = previous.get(key);

      if (before && before.quantity.toString() === level.quantity) continue;

      if (before) {
        await this.prisma.raw.stockLine.update({
          where: { id: before.id },
          data: { quantity: toPrismaDecimal(level.quantity) },
        });
      } else {
        await this.prisma.raw.stockLine.create({
          data: {
            id: `${tenantId}:${key}`.slice(0, 200),
            tenantId,
            productId: level.productId,
            batchId: level.batchId,
            locationId: level.locationId,
            status: level.status,
            quantity: toPrismaDecimal(level.quantity),
          },
        });
      }
      written += 1;
    }

    // A line the projection no longer reports has gone to zero. It disappears
    // rather than lingering as `0 kg` — an emptied rack should leave the stock
    // screen, not sit there looking like stock.
    const stale = existing.filter((row) => !seen.has(rowKey(row)));
    if (stale.length > 0) {
      await this.prisma.raw.stockLine.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      written += stale.length;
    }

    return written;
  }

  /* --- read models -------------------------------------------------------- */

  async stock(tenantId: string): Promise<StockLevel[]> {
    return projectStock(await this.store.readLog(tenantId));
  }

  /** B-036 — `Issued − Returned − Shrinkage = Consumed`, with age and lane. */
  async issues(tenantId: string): Promise<Map<string, IssueBalance>> {
    return projectIssues(await this.store.readLog(tenantId));
  }

  /** B-035 — PO status is derived from receipts and never stored. */
  async purchaseOrders(tenantId: string): Promise<PoProgress[]> {
    const [events, rows] = await Promise.all([
      this.store.readLog(tenantId),
      this.prisma.raw.purchaseOrder.findMany({
        where: { tenantId },
        include: { lines: true },
      }),
    ]);

    const orders: PurchaseOrder[] = rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId as PurchaseOrder['tenantId'],
      poNo: row.poNo,
      supplierId: row.supplierId,
      orderDate: iso(row.orderDate),
      eta: iso(row.eta),
      note: row.note ?? undefined,
      cancelled: row.cancelled,
      lines: row.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        quantityOrdered: line.quantityOrdered.toString(),
        unit: line.unit,
        unitPrice: line.unitPrice?.toString(),
      })),
    }));

    return projectPurchaseOrders(orders, events);
  }

  /**
   * B-037 — tasks, including the arrival task that appears the day before a
   * PO's ETA. That is the answer to "how does an operator know goods are coming
   * before the truck reaches the gate" (PRD F24/F25).
   */
  async tasks(tenantId: string, today = new Date().toISOString().slice(0, 10)): Promise<Task[]> {
    const [events, purchaseOrders] = await Promise.all([
      this.store.readLog(tenantId),
      this.purchaseOrders(tenantId),
    ]);
    return projectTasks(events, { today, purchaseOrders });
  }

  async log(tenantId: string): Promise<AnyEvent[]> {
    return this.store.readLog(tenantId);
  }
}

function rowKey(row: {
  productId: string;
  batchId: string | null;
  locationId: string;
  status: string;
}): string {
  return [row.productId, row.batchId ?? '-', row.locationId, row.status].join('|');
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
