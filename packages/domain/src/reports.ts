import type { AnyEvent, ItemClass, Product } from '@fv/contracts';
import { issueAgeHours, type IssueBalance } from './issue.js';
import { add, cmp, div, gt, mul, sub, type Qty, ZERO } from './qty.js';
import { totalQuantity, type StockLevel } from './stock.js';

/**
 * Report aggregations — PRD F15, UI Spec §20.
 *
 * All pure, all computed from the same event log and stock projection the
 * screens use. There is no separate reporting store to fall out of step with
 * the operational numbers, which is the usual reason a warehouse report and a
 * warehouse disagree.
 *
 * Valuation is **weighted average** (PRD F15). FIFO valuation is an open
 * question (PRD #4) and is deliberately not implemented on a guess.
 */

export interface StockCardEntry {
  at: string;
  type: string;
  quantityIn: Qty;
  quantityOut: Qty;
  balance: Qty;
  actorRole: string;
}

/** Every movement of one product, with a running balance (PRD F15). */
export function stockCard(events: readonly AnyEvent[], productId: string): StockCardEntry[] {
  const entries: StockCardEntry[] = [];
  let balance: Qty = ZERO;

  const push = (event: AnyEvent, inQty: Qty, outQty: Qty) => {
    balance = sub(add(balance, inQty), outQty);
    entries.push({
      at: event.occurredAt,
      type: event.type,
      quantityIn: inQty,
      quantityOut: outQty,
      balance,
      actorRole: event.actorRole,
    });
  };

  for (const event of events) {
    switch (event.type) {
      case 'goods_receipt.item_added':
        if (event.payload.productId === productId) push(event, event.payload.quantity, ZERO);
        break;
      case 'production.output_submitted':
        if (event.payload.productId === productId) push(event, event.payload.quantity, ZERO);
        break;
      case 'material_issue.prepared':
        for (const pick of event.payload.picks) {
          if (pick.ref.productId === productId) push(event, ZERO, pick.quantity);
        }
        break;
      case 'material_issue.returned':
        for (const r of event.payload.returns) {
          if (r.ref.productId === productId) push(event, r.quantity, ZERO);
        }
        break;
      case 'shipment.picked':
        for (const pick of event.payload.picks) {
          if (pick.ref.productId === productId) push(event, ZERO, pick.quantity);
        }
        break;
      case 'stock.adjusted':
        if (event.payload.ref.productId === productId) {
          const delta = event.payload.delta;
          if (delta.startsWith('-')) push(event, ZERO, delta.slice(1));
          else push(event, delta, ZERO);
        }
        break;
      default:
        break;
    }
  }

  return entries;
}

export interface MovementSummaryRow {
  itemClass: ItemClass;
  quantityIn: Qty;
  quantityOut: Qty;
  net: Qty;
}

/** Movement over a period, grouped by item class (PRD F15). */
export function movementSummary(
  events: readonly AnyEvent[],
  products: readonly Product[],
  from: string,
  to: string,
): MovementSummaryRow[] {
  const rows = new Map<ItemClass, { in: Qty; out: Qty }>();
  const classOf = (productId: string) => products.find((p) => p.id === productId)?.itemClass;

  const bump = (productId: string, inQty: Qty, outQty: Qty) => {
    const itemClass = classOf(productId);
    if (!itemClass) return;
    const row = rows.get(itemClass) ?? { in: ZERO, out: ZERO };
    rows.set(itemClass, { in: add(row.in, inQty), out: add(row.out, outQty) });
  };

  for (const event of events) {
    const day = event.occurredAt.slice(0, 10);
    if (day < from || day > to) continue;

    if (event.type === 'goods_receipt.item_added' || event.type === 'production.output_submitted') {
      bump(event.payload.productId, event.payload.quantity, ZERO);
    } else if (event.type === 'material_issue.prepared') {
      for (const pick of event.payload.picks) bump(pick.ref.productId, ZERO, pick.quantity);
    } else if (event.type === 'shipment.picked') {
      for (const pick of event.payload.picks) bump(pick.ref.productId, ZERO, pick.quantity);
    }
  }

  return [...rows.entries()].map(([itemClass, row]) => ({
    itemClass,
    quantityIn: row.in,
    quantityOut: row.out,
    net: sub(row.in, row.out),
  }));
}

export interface InventoryValueRow {
  productId: string;
  name: string;
  itemClass: ItemClass;
  quantity: Qty;
  unitCost: Qty;
  value: Qty;
}

/** Inventory value at weighted average cost, biggest first (PRD F15). */
export function inventoryValue(
  stock: readonly StockLevel[],
  products: readonly Product[],
): { rows: InventoryValueRow[]; total: Qty; byClass: Record<string, Qty> } {
  const rows: InventoryValueRow[] = products
    .map((product) => {
      const quantity = totalQuantity(stock, { productId: product.id });
      const unitCost = product.averageCost ?? ZERO;
      return {
        productId: product.id,
        name: product.name,
        itemClass: product.itemClass,
        quantity,
        unitCost,
        value: mul(quantity, unitCost),
      };
    })
    .filter((row) => gt(row.quantity, ZERO))
    .sort((a, b) => cmp(b.value, a.value));

  const byClass: Record<string, Qty> = {};
  for (const row of rows) {
    byClass[row.itemClass] = add(byClass[row.itemClass] ?? ZERO, row.value);
  }

  return { rows, total: rows.reduce((acc, row) => add(acc, row.value), ZERO), byClass };
}

export interface UsageVarianceRow {
  productId: string;
  actual: Qty;
  /** Historical average per issue — the P0 comparator, stated as such in UI. */
  benchmark: Qty;
  variance: Qty;
  valueImpact: Qty;
}

/**
 * Usage variance against a HISTORICAL AVERAGE (K12, PRD F6).
 *
 * Since PRD v1.3 this is the fallback, not the default: products with a BOM are
 * measured against their recipe by `bomUsageVariance` in `bom.ts`. This one
 * still matters, because a product without a recipe must not simply vanish from
 * the report — and the screen has to say which comparator it used rather than
 * dressing an average up as a standard (UI Spec K12).
 */
export function usageVariance(
  issues: readonly IssueBalance[],
  products: readonly Product[],
): UsageVarianceRow[] {
  const totals = new Map<string, { consumed: Qty; count: number }>();

  for (const issue of issues) {
    if (issue.status !== 'CLOSED') continue;
    for (const line of issue.lines) {
      const row = totals.get(line.productId) ?? { consumed: ZERO, count: 0 };
      totals.set(line.productId, {
        consumed: add(row.consumed, line.consumed),
        count: row.count + 1,
      });
    }
  }

  const rows: UsageVarianceRow[] = [];
  for (const [productId, row] of totals) {
    if (row.count < 2) continue; // an average of one is not an average
    const benchmark = div(row.consumed, String(row.count));
    const lastIssue = [...issues]
      .reverse()
      .find((i) => i.status === 'CLOSED' && i.lines.some((l) => l.productId === productId));
    const actual =
      lastIssue?.lines.find((l) => l.productId === productId)?.consumed ?? ZERO;
    const variance = sub(actual, benchmark);
    const cost = products.find((p) => p.id === productId)?.averageCost ?? ZERO;

    rows.push({
      productId,
      actual,
      benchmark,
      variance,
      valueImpact: mul(variance.startsWith('-') ? variance.slice(1) : variance, cost),
    });
  }

  return rows.sort((a, b) => cmp(b.valueImpact, a.valueImpact));
}

export interface AgingBucketRow {
  productId: string;
  bucket: '0-30' | '31-60' | '61-90' | '90+';
  quantity: Qty;
  value: Qty;
}

/** Stock age buckets (PRD F15) — where value is quietly getting older. */
export function stockAging(
  stock: readonly StockLevel[],
  products: readonly Product[],
  lastMovement: Readonly<Record<string, string>>,
  now: Date,
): AgingBucketRow[] {
  return stock
    .filter((level) => level.status === 'AVAILABLE')
    .map((level) => {
      const last = lastMovement[level.productId];
      const days = last ? Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000) : 0;
      const bucket: AgingBucketRow['bucket'] =
        days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      const cost = products.find((p) => p.id === level.productId)?.averageCost ?? ZERO;
      return {
        productId: level.productId,
        bucket,
        quantity: level.quantity,
        value: mul(level.quantity, cost),
      };
    });
}

export interface ShrinkageRow {
  reason: string;
  quantity: Qty;
  occurrences: number;
}

/** Shrinkage grouped by reason — why the closed list is mandatory (PRD F6). */
export function shrinkageByReason(events: readonly AnyEvent[]): ShrinkageRow[] {
  const rows = new Map<string, { quantity: Qty; occurrences: number }>();

  for (const event of events) {
    if (event.type !== 'material_issue.closed') continue;
    for (const entry of event.payload.shrinkage) {
      const row = rows.get(entry.reason) ?? { quantity: ZERO, occurrences: 0 };
      rows.set(entry.reason, {
        quantity: add(row.quantity, entry.quantity),
        occurrences: row.occurrences + 1,
      });
    }
  }

  return [...rows.entries()]
    .map(([reason, row]) => ({ reason, ...row }))
    .sort((a, b) => cmp(b.quantity, a.quantity));
}

/** Material consumed per production batch — two-way traceability groundwork. */
export function materialUsagePerBatch(
  events: readonly AnyEvent[],
  issues: ReadonlyMap<string, IssueBalance>,
): { batchNo: string; productId: string; materials: { productId: string; consumed: Qty }[] }[] {
  const out: { batchNo: string; productId: string; materials: { productId: string; consumed: Qty }[] }[] = [];

  for (const event of events) {
    if (event.type !== 'production.output_submitted') continue;
    const issue = event.payload.linkedIssueId ? issues.get(event.payload.linkedIssueId) : undefined;
    out.push({
      batchNo: event.payload.batchNo,
      productId: event.payload.productId,
      materials:
        issue?.lines.map((line) => ({ productId: line.productId, consumed: line.consumed })) ?? [],
    });
  }

  return out;
}

/** Last time each product moved — feeds dead stock and aging. */
export function lastMovementByProduct(events: readonly AnyEvent[]): Record<string, string> {
  const map: Record<string, string> = {};
  const touch = (productId: string, at: string) => {
    if (!map[productId] || map[productId]! < at) map[productId] = at;
  };

  for (const event of events) {
    switch (event.type) {
      case 'goods_receipt.item_added':
      case 'production.output_submitted':
        touch(event.payload.productId, event.occurredAt);
        break;
      case 'material_issue.prepared':
      case 'shipment.picked':
        for (const pick of event.payload.picks) touch(pick.ref.productId, event.occurredAt);
        break;
      default:
        break;
    }
  }

  return map;
}

/** Issues closed within the threshold — the product's headline metric. */
export function closureRate(
  issues: readonly IssueBalance[],
  thresholdHours: number,
): { closedInTime: number; total: number; percent: number } {
  const handed = issues.filter((i) => i.handedOverAt);
  const closedInTime = handed.filter(
    (i) => i.status === 'CLOSED' && issueAgeHours(i.handedOverAt!, new Date()) <= thresholdHours,
  ).length;

  return {
    closedInTime,
    total: handed.length,
    percent: handed.length === 0 ? 100 : Math.round((closedInTime / handed.length) * 1000) / 10,
  };
}
