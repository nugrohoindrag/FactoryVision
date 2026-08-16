import type { AnyEvent, StockRef } from '@fv/contracts';
import { abs, add, cmp, div, gt, mul, sub, type Qty, ZERO } from './qty.js';
import { stockKey, type StockLevel } from './stock.js';

/**
 * Stock take variance (PRD F10, UI Spec §16).
 *
 * The counting is blind, but the RECONCILIATION is not — this is where the
 * system figure and the counted figure finally meet.
 *
 * Two rules shape everything here:
 *
 * 1. **Variance is ranked by rupiah, never by quantity.** 2 kg of gold matters
 *    more than 500 kg of cardboard, and a report sorted by quantity buries the
 *    finding that pays for the whole stock take (UI Spec §16 K08).
 * 2. **A recount is triggered automatically above the threshold**, not chosen
 *    by the counter. Letting the person who counted decide whether their own
 *    count was wrong defeats the purpose.
 */

export interface CountedLine {
  ref: StockRef;
  key: string;
  countedQuantity: Qty;
  countedBy: string;
  round: number;
}

export interface VarianceLine {
  key: string;
  ref: StockRef;
  /** What the projection says is there. Never shown to the counter. */
  systemQuantity: Qty;
  countedQuantity: Qty;
  /** counted − system. Negative means stock is missing. */
  variance: Qty;
  /** Absolute rupiah impact, using the product's weighted-average cost. */
  valueImpact: Qty;
  /** |variance| ÷ system, as a percentage. `null` when system is zero. */
  variancePercent: number | null;
  needsRecount: boolean;
  countedBy: string;
  round: number;
}

export interface VarianceSummary {
  lines: VarianceLine[];
  totalValueImpact: Qty;
  itemsWithVariance: number;
  countedLines: number;
  /** Lines that matched exactly, as a percentage of lines counted. */
  accuracyPercent: number;
  recountRequired: number;
}

/** Counts recorded for a session, latest round per stock line winning. */
export function projectCounts(events: readonly AnyEvent[], sessionId: string): CountedLine[] {
  const byKey = new Map<string, CountedLine>();

  for (const event of events) {
    if (event.type !== 'stock_take.counted') continue;
    if (event.payload.sessionId !== sessionId) continue;

    const key = stockKey(event.payload.ref);
    const existing = byKey.get(key);
    // A recount supersedes the first count; an earlier round never wins.
    if (existing && existing.round > event.payload.round) continue;

    byKey.set(key, {
      ref: event.payload.ref,
      key,
      countedQuantity: event.payload.countedQuantity,
      countedBy: event.payload.countedBy,
      round: event.payload.round,
    });
  }

  return [...byKey.values()];
}

export function computeVariance(
  counts: readonly CountedLine[],
  stock: readonly StockLevel[],
  costByProduct: Readonly<Record<string, Qty | undefined>>,
  recountThresholdPercent: number,
): VarianceSummary {
  const lines: VarianceLine[] = counts.map((count) => {
    const level = stock.find((l) => l.key === count.key);
    const systemQuantity = level?.quantity ?? ZERO;
    const variance = sub(count.countedQuantity, systemQuantity);
    const cost = costByProduct[count.ref.productId] ?? ZERO;
    const valueImpact = mul(abs(variance), cost);

    const variancePercent =
      systemQuantity === ZERO
        ? null
        : Number(mul(div(abs(variance), systemQuantity), '100'));

    return {
      key: count.key,
      ref: count.ref,
      systemQuantity,
      countedQuantity: count.countedQuantity,
      variance,
      valueImpact,
      variancePercent,
      // A line that appeared from nowhere counts as needing a second look too.
      needsRecount:
        count.round === 1 &&
        (variancePercent === null
          ? gt(abs(variance), ZERO)
          : variancePercent > recountThresholdPercent),
      countedBy: count.countedBy,
      round: count.round,
    };
  });

  // Rupiah descending — the ordering the report exists for.
  lines.sort((a, b) => cmp(b.valueImpact, a.valueImpact));

  const withVariance = lines.filter((line) => gt(abs(line.variance), ZERO));
  const totalValueImpact = lines.reduce((acc, line) => add(acc, line.valueImpact), ZERO);

  return {
    lines,
    totalValueImpact,
    itemsWithVariance: withVariance.length,
    countedLines: lines.length,
    accuracyPercent:
      lines.length === 0
        ? 100
        : Math.round(((lines.length - withVariance.length) / lines.length) * 1000) / 10,
    recountRequired: lines.filter((line) => line.needsRecount).length,
  };
}

/** Adjustments a variance report would post if approved (K08 → K09). */
export function adjustmentsFromVariance(
  summary: VarianceSummary,
): { ref: StockRef; delta: Qty }[] {
  return summary.lines
    .filter((line) => gt(abs(line.variance), ZERO))
    .map((line) => ({ ref: line.ref, delta: line.variance }));
}
