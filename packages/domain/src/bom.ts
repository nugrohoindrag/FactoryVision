import type { AnyEvent, Bom } from '@fv/contracts';
import { add, div, gt, isZero, mul, sub, type Qty, ZERO } from './qty.js';

/**
 * Bill of Materials (F21, moved to P0 in PRD v1.3).
 *
 * Two jobs, and it matters that they are separate:
 *
 *   1. Turn "make 500 loaves" into a material request the production floor
 *      does not have to type. This is what protects the <30s target — BOM
 *      REDUCES typing, it does not add a step.
 *   2. Provide the `Standard` column the variance report compares against.
 *      Before v1.3 that column had no source in P0, so K12 fell back to a
 *      historical average and the "cut variance by 30%" metric had nothing to
 *      measure against.
 */

export interface ExplodedLine {
  productId: string;
  unit: string;
  /** `standardQuantity × (planned ÷ outputQuantity)`, shrinkage included. */
  requiredQuantity: Qty;
  /** Before the shrinkage allowance — useful for showing the allowance itself. */
  netQuantity: Qty;
  standardShrinkagePct: Qty;
}

/**
 * Scales a recipe to a planned output.
 *
 * `outputQuantity` is what lets a per-batch recipe (`1000 g` of dough) and a
 * per-unit recipe (`1 pcs`) share one structure — the factory fills in its own
 * basis, which was never a decision anyone could make from an office.
 *
 * Every step goes through big.js. This is a multiplication of two decimals
 * feeding every variance figure downstream, which is precisely where a float
 * would rot quietly (Tech Stack §2.4).
 */
export function explodeBom(bom: Bom, plannedQuantity: Qty): ExplodedLine[] {
  if (isZero(bom.outputQuantity)) return [];
  const factor = div(plannedQuantity, bom.outputQuantity);

  return bom.lines.map((line) => {
    const net = mul(line.standardQuantity, factor);
    const pct = line.standardShrinkagePct ?? ZERO;
    // Allowance is ON TOP of net: making 100 needs more than 100 worth of
    // input when 2% is expected to be lost on the way.
    const allowance = isZero(pct) ? ZERO : mul(net, div(pct, '100'));
    return {
      productId: line.productId,
      unit: line.unit,
      netQuantity: net,
      requiredQuantity: add(net, allowance),
      standardShrinkagePct: pct,
    };
  });
}

/**
 * Standard consumption for one already-issued line, read from the SNAPSHOT
 * taken at request time — never from the current BOM.
 *
 * A live lookup would make last month's variance change every time someone
 * corrects a recipe, and a report that rewrites its own history is a report
 * people stop trusting (Tech Stack §2.8c).
 */
export function standardForIssueLine(event: AnyEvent, lineId: string): Qty | null {
  if (event.type !== 'material_issue.requested') return null;
  const hit = event.payload.bomStandard.find((s) => s.lineId === lineId);
  return hit ? hit.standardQuantity : null;
}

export interface BomUsageVariance {
  issueId: string;
  lineId: string;
  productId: string;
  /** Production line the issue was handed to — what turns a number into an action. */
  destinationId: string | null;
  standard: Qty | null;
  actual: Qty;
  /** `actual − standard`. Positive means overconsumption. */
  variance: Qty | null;
  /** True when no BOM snapshot existed — K12 must say so rather than imply a standard. */
  withoutStandard: boolean;
}

/**
 * Variance per issue line: what the recipe said versus what was actually used.
 *
 * `actual` comes from the issue projection (`issued − returned − shrinkage`),
 * so this function takes it rather than recomputing it — one definition of
 * "consumed", used everywhere.
 */
export function bomUsageVariance(
  events: readonly AnyEvent[],
  consumedByLine: ReadonlyMap<string, Qty>,
): BomUsageVariance[] {
  const rows: BomUsageVariance[] = [];
  const destinations = new Map<string, string>();

  for (const event of events) {
    if (event.type === 'material_issue.requested') {
      destinations.set(event.payload.issueId, event.payload.destinationId);
    }
  }

  for (const event of events) {
    if (event.type !== 'material_issue.requested') continue;
    const p = event.payload;
    for (const line of p.lines) {
      const key = `${p.issueId}|${line.lineId}`;
      const actual = consumedByLine.get(key);
      if (actual === undefined) continue;
      const standard = standardForIssueLine(event, line.lineId);
      rows.push({
        issueId: p.issueId,
        lineId: line.lineId,
        productId: line.productId,
        destinationId: destinations.get(p.issueId) ?? null,
        standard,
        actual,
        variance: standard === null ? null : sub(actual, standard),
        withoutStandard: standard === null,
      });
    }
  }

  // Largest overconsumption first. Rupiah ordering happens in the report layer,
  // which is the only place that knows the cost per product.
  return rows.sort((a, b) => {
    if (a.variance === null) return 1;
    if (b.variance === null) return -1;
    return gt(b.variance, a.variance) ? 1 : gt(a.variance, b.variance) ? -1 : 0;
  });
}

/** Groups variance by production line — the split that makes K12 actionable. */
export function varianceByDestination(rows: readonly BomUsageVariance[]): Map<string, Qty> {
  const byLane = new Map<string, Qty>();
  for (const row of rows) {
    if (row.variance === null) continue;
    const key = row.destinationId ?? 'UNKNOWN';
    byLane.set(key, add(byLane.get(key) ?? ZERO, row.variance));
  }
  return byLane;
}

/**
 * Lines the warehouse cannot currently cover. Surfaced in L13 at request time
 * rather than when the warehouse starts preparing — production has a right to
 * know before it waits.
 */
export function shortLines(
  exploded: readonly ExplodedLine[],
  availableByProduct: ReadonlyMap<string, Qty>,
): ExplodedLine[] {
  return exploded.filter((line) =>
    gt(line.requiredQuantity, availableByProduct.get(line.productId) ?? ZERO),
  );
}
