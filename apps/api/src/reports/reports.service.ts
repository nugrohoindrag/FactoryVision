import { Inject, Injectable } from '@nestjs/common';
import type { Product } from '@fv/contracts';
import {
  bomUsageVariance,
  computeVariance,
  inventoryValue,
  lastMovementByProduct,
  materialUsagePerBatch,
  movementSummary,
  projectCounts,
  receiptsWithoutPo,
  shrinkageByReason,
  stockAging,
  stockCard,
  supplierPerformance,
  usageVariance,
  varianceByDestination,
} from '@fv/domain';
import { big, sum as sumDecimals } from '../common/decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectorService } from '../projection/projector.service.js';

/**
 * B-071 → B-080 — the ten reports of PRD F15 plus the owner's dashboard.
 *
 * UI Spec §15.3 marks K11–K12 as `❌ needs server aggregates`. This is those
 * aggregates. It is also the only part of the product the person paying for it
 * ever looks at, which is worth remembering when deciding how much care each
 * number deserves.
 *
 * ## Two rules that apply to every function here
 *
 * **Reports read `occurredAt`, never `receivedAt`.** A receipt that physically
 * happened on Monday appears on Monday even if the phone only found signal on
 * Wednesday. Replay uses the other clock; that split was decided up front
 * (Backend Plan §3.2) and this is where it pays off.
 *
 * **The arithmetic lives in `@fv/domain`.** Nothing here computes a quantity.
 * A report that did its own maths would eventually disagree with the screen the
 * operator is looking at, and the report is the one the owner would believe.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectorService) private readonly projector: ProjectorService,
  ) {}

  private async products(tenantId: string): Promise<Product[]> {
    const rows = await this.prisma.raw.product.findMany({ where: { tenantId } });
    return rows.map((row) => ({
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
    }));
  }

  /** B-071 — every movement of one item, with a running balance. */
  async stockCard(tenantId: string, productId: string) {
    const events = await this.projector.log(tenantId);
    return stockCard(events, productId);
  }

  /** B-072 — what came in and went out over a period, per item class. */
  async movements(tenantId: string, from: string, to: string) {
    const [events, products] = await Promise.all([
      this.projector.log(tenantId),
      this.products(tenantId),
    ]);
    return movementSummary(events, products, from, to);
  }

  /**
   * B-073 — inventory value at weighted average cost.
   *
   * PRD §14.4 is still open on whether any factory needs FIFO for tax. P0 is
   * weighted average, and the report says which method it used rather than
   * leaving the reader to assume.
   */
  async inventoryValue(tenantId: string) {
    const [stock, products] = await Promise.all([
      this.projector.stock(tenantId),
      this.products(tenantId),
    ]);
    return { method: 'WEIGHTED_AVERAGE' as const, ...inventoryValue(stock, products) };
  }

  /** B-074 — stock take history, variance ordered by rupiah, not by quantity. */
  async stockTakes(tenantId: string, recountThresholdPercent = 5) {
    const [events, stock, products] = await Promise.all([
      this.projector.log(tenantId),
      this.projector.stock(tenantId),
      this.products(tenantId),
    ]);

    const costByProduct = Object.fromEntries(
      products.map((product) => [product.id, product.averageCost]),
    );

    const sessions = events.filter((event) => event.type === 'stock_take.session_created');

    return sessions.map((session) => {
      if (session.type !== 'stock_take.session_created') return null;
      const sessionId = session.payload.sessionId;
      const counted = projectCounts(events, sessionId);
      const variance = computeVariance(counted, stock, costByProduct, recountThresholdPercent);
      const approved = events.some(
        (event) => event.type === 'stock_take.approved' && event.payload.sessionId === sessionId,
      );
      return {
        sessionId,
        startedAt: session.occurredAt,
        approved,
        counters: session.payload.countedBy,
        ...variance,
      };
    }).filter(Boolean);
  }

  /** B-075 — what each production batch actually consumed. */
  async usagePerBatch(tenantId: string) {
    const [events, issues] = await Promise.all([
      this.projector.log(tenantId),
      this.projector.issues(tenantId),
    ]);
    return materialUsagePerBatch(events, issues);
  }

  /**
   * B-076 — usage against the BOM, split per production line.
   *
   * The report a factory owner actually asks for (PRD F6), and the one most
   * able to mislead. Two things travel with every row and neither is optional:
   *
   * - `withoutStandard` — this product has no recipe, so there is nothing to
   *   compare against and the row is informational.
   * - `unverifiedRecipe` — there IS a recipe but no human has confirmed it.
   *   Variance against a number somebody typed once and never checked is
   *   variance against fiction, and PRD §12 requires that to be visible rather
   *   than presented as sound.
   *
   * Both flags go into the Excel and PDF exports too. A report printed for a
   * meeting loses its screen context, and that is exactly the copy decisions
   * get made from.
   */
  async bomVariance(tenantId: string) {
    const [events, issues, products, bomRows] = await Promise.all([
      this.projector.log(tenantId),
      this.projector.issues(tenantId),
      this.products(tenantId),
      this.prisma.raw.bom.findMany({ where: { tenantId } }),
    ]);

    const consumedByLine = new Map<string, string>();
    for (const [issueId, balance] of issues) {
      for (const line of balance.lines) {
        consumedByLine.set(`${issueId}|${line.lineId}`, line.consumed);
      }
    }

    const verified = new Map(bomRows.map((bom) => [bom.productId, bom.verified]));
    const rows = bomUsageVariance(events, consumedByLine).map((row) => {
      const cost = products.find((product) => product.id === row.productId)?.averageCost ?? '0';
      const magnitude = row.variance?.replace('-', '') ?? '0';
      return {
        ...row,
        unverifiedRecipe: !row.withoutStandard && verified.get(row.productId) !== true,
        valueImpact: multiply(magnitude, cost),
      };
    });

    return {
      rows: rows.sort((a, b) => byValueDesc(a.valueImpact, b.valueImpact)),
      byLane: [...varianceByDestination(rows).entries()].map(([destinationId, variance]) => ({
        destinationId,
        variance,
      })),
      /** The fallback comparator for products with no recipe at all (K12). */
      historical: usageVariance([...issues.values()], products),
    };
  }

  /** B-077 — aging buckets and shrinkage by reason. */
  async aging(tenantId: string, now = new Date()) {
    const [events, stock, products] = await Promise.all([
      this.projector.log(tenantId),
      this.projector.stock(tenantId),
      this.products(tenantId),
    ]);
    return stockAging(stock, products, lastMovementByProduct(events), now);
  }

  async shrinkage(tenantId: string) {
    return shrinkageByReason(await this.projector.log(tenantId));
  }

  /** B-078 — supplier performance: quantity, timeliness, defect rate. */
  async suppliers(tenantId: string) {
    const [progress, partners] = await Promise.all([
      this.projector.purchaseOrders(tenantId),
      this.prisma.raw.partner.findMany({ where: { tenantId } }),
    ]);
    const names = new Map(partners.map((partner) => [partner.id, partner.name]));
    return supplierPerformance(progress).map((row) => ({
      ...row,
      supplierName: names.get(row.supplierId) ?? 'Unknown supplier',
    }));
  }

  /**
   * B-079 — receipts with no purchase order.
   *
   * Receiving without a PO stays allowed (PRD F24). This report is the entire
   * enforcement mechanism: tidiness is pushed by making it visible, never by
   * blocking an operator with a truck at the door.
   */
  async receiptsWithoutPo(tenantId: string) {
    const events = await this.projector.log(tenantId);
    const receiptIds = receiptsWithoutPo(events);

    return events
      .filter(
        (event) =>
          event.type === 'goods_receipt.created' && receiptIds.includes(event.payload.receiptId),
      )
      .map((event) => {
        if (event.type !== 'goods_receipt.created') return null;
        return {
          receiptId: event.payload.receiptId,
          supplierId: event.payload.supplierId,
          deliveryNoteNo: event.payload.deliveryNoteNo,
          receivedAt: event.payload.receivedAt,
          recordedBy: event.actorId,
        };
      })
      .filter(Boolean);
  }

  /**
   * B-080 — the owner's dashboard (PRD F12): nine numbers, one round trip.
   *
   * The target is five minutes a day. Five minutes that begins with nine
   * sequential requests over a factory's connection is not five minutes.
   */
  async dashboard(tenantId: string, now = new Date()) {
    const today = now.toISOString().slice(0, 10);
    const [stock, issues, purchaseOrders, products, events, alerts] = await Promise.all([
      this.projector.stock(tenantId),
      this.projector.issues(tenantId),
      this.projector.purchaseOrders(tenantId),
      this.products(tenantId),
      this.projector.log(tenantId),
      this.prisma.raw.alert.findMany({ where: { tenantId, clearedAt: null } }),
    ]);

    const value = inventoryValue(stock, products);
    const open = [...issues.values()].filter((issue) => issue.status !== 'CLOSED');

    const costOf = (productId: string) =>
      products.find((product) => product.id === productId)?.averageCost ?? '0';

    /**
     * The rupiah value sitting on the production floor unaccounted for.
     *
     * `issued − returned − shrinkage` is what has physically left the warehouse
     * and not yet been explained. That is the number PRD M2 is about, and it is
     * the first card on the dashboard for that reason — a count of open issues
     * says how many, this says how much.
     */
    const openIssueValue = open.reduce(
      (total, issue) =>
        issue.lines.reduce(
          (sum, line) => addStrings(sum, multiply(line.consumed, costOf(line.productId))),
          total,
        ),
      '0',
    );

    const belowMinimum = products.filter((product) => {
      if (!product.minimumStock) return false;
      const held = sumDecimals(
        stock
          .filter((line) => line.productId === product.id && line.status === 'AVAILABLE')
          .map((line) => line.quantity),
      );
      return big(held).lt(big(product.minimumStock));
    }).length;

    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);

    return {
      asOf: now.toISOString(),
      inventoryValue: { total: value.total, byClass: value.byClass },
      belowMinimum,
      // Issue-not-closed is the metric this product exists for (PRD M2), so it
      // is the first card and it carries a rupiah figure, not just a count.
      openIssues: { count: open.length, value: openIssueValue },
      purchaseOrders: {
        overdue: purchaseOrders.filter((po) => po.status !== 'RECEIVED' && po.eta < today).length,
        incomplete: purchaseOrders.filter((po) => po.status === 'PARTIALLY RECEIVED').length,
      },
      movement7Days: movementSummary(events, products, sevenDaysAgo, today),
      deadStock: stockAging(stock, products, lastMovementByProduct(events), now)
        .filter((row) => row.bucket === '90+')
        .sort((a, b) => byValueDesc(a.value, b.value))
        .slice(0, 5),
      alerts: alerts.length,
    };
  }
}

/**
 * Rupiah arithmetic, through big.js like everything else.
 *
 * These are three lines and it would be tempting to use `Number` for a total
 * nobody transacts against. That is exactly how the rule erodes: the report is
 * where the owner reads the figure, so it is the last place a rounding drift
 * should be allowed to appear (Tech Stack §2.4).
 */
function multiply(a: string, b: string): string {
  return big(a).times(big(b)).toFixed();
}

function addStrings(a: string, b: string): string {
  return big(a).plus(big(b)).toFixed();
}

/** Descending by decimal value, compared through big.js so nothing rounds. */
function byValueDesc(a: string, b: string): number {
  return big(b).cmp(big(a));
}
