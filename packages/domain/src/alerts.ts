import type { Batch, Product } from '@fv/contracts';
import { daysToExpiry } from './fefo.js';
import { issueAgeHours, type IssueBalance } from './issue.js';
import { add, gt, lt, mul, type Qty, ZERO } from './qty.js';
import { totalQuantity, type StockLevel } from './stock.js';

/**
 * Alert engine — six kinds, PRD F11 / UI Spec §18.
 *
 * **The priority order is locked and is not a sort option.** An overdue
 * material issue outranks everything else because it is the metric the product
 * is judged on; if it can be pushed down the list by six expiry warnings, the
 * core feature dies quietly (UI Spec D4).
 *
 * Every threshold is tenant configuration (K14), never a constant — a factory
 * that runs on 60-day materials should not be told everything is expiring.
 */

export type AlertKind =
  | 'ISSUE_OVERDUE'
  | 'STOCKTAKE_VARIANCE'
  | 'BELOW_MINIMUM'
  | 'EXPIRING_SOON'
  | 'QUARANTINE_AGEING'
  | 'DEAD_STOCK';

/** Locked order, highest first (UI Spec §18 L26). */
export const ALERT_PRIORITY: AlertKind[] = [
  'ISSUE_OVERDUE',
  'STOCKTAKE_VARIANCE',
  'BELOW_MINIMUM',
  'EXPIRING_SOON',
  'QUARANTINE_AGEING',
  'DEAD_STOCK',
];

export interface Alert {
  id: string;
  kind: AlertKind;
  title: string;
  detail: string;
  /** Only ISSUE_OVERDUE may be red on a dashboard (UI Spec D4). */
  severity: 'danger' | 'warning' | 'info';
  /** Rupiah at stake, when it can be computed. Drives ordering within a kind. */
  value?: Qty;
  href?: string;
}

export interface AlertInput {
  now: Date;
  today: string;
  stock: readonly StockLevel[];
  products: readonly Product[];
  batches: readonly Batch[];
  issues: readonly IssueBalance[];
  config: {
    issueOverdueHours: number;
    expiryWarningDays: number[];
    deadStockDays: number;
    quarantineWarningDays: number;
  };
  /** productId → last movement timestamp, for dead-stock detection. */
  lastMovement?: Readonly<Record<string, string>>;
}

export function buildAlerts(input: AlertInput): Alert[] {
  const { now, today, stock, products, batches, issues, config } = input;
  const alerts: Alert[] = [];
  const productOf = (id: string) => products.find((p) => p.id === id);
  const valueOf = (productId: string, quantity: Qty): Qty | undefined => {
    const cost = productOf(productId)?.averageCost;
    return cost ? mul(quantity, cost) : undefined;
  };

  /* 1 · Material issues open past the threshold — the one red condition. */
  for (const issue of issues) {
    if (issue.status === 'CLOSED' || !issue.handedOverAt) continue;
    const ageHours = issueAgeHours(issue.handedOverAt, now);
    if (ageHours < config.issueOverdueHours) continue;

    alerts.push({
      id: `issue-${issue.issueId}`,
      kind: 'ISSUE_OVERDUE',
      title: `Material issue open ${Math.floor(ageHours / 24)}d`,
      detail: `${issue.workOrderNo ?? issue.issueId.slice(0, 8)} · ${issue.lines.length} materials still unaccounted for`,
      severity: 'danger',
      value: issue.lines.reduce<Qty | undefined>((acc, line) => {
        const lineValue = valueOf(line.productId, line.issued);
        if (!lineValue) return acc;
        return acc ? add(acc, lineValue) : lineValue;
      }, undefined),
      href: `/f/issues/${issue.issueId}/close`,
    });
  }

  /* 3 · Stock below the minimum the factory set. */
  for (const product of products) {
    if (!product.minimumStock) continue;
    const onHand = totalQuantity(stock, { productId: product.id, status: 'AVAILABLE' });
    if (!lt(onHand, product.minimumStock)) continue;

    alerts.push({
      id: `min-${product.id}`,
      kind: 'BELOW_MINIMUM',
      title: `${product.name} below minimum`,
      detail: `${onHand} ${product.baseUnit} on hand, minimum ${product.minimumStock}`,
      severity: 'warning',
      value: valueOf(product.id, onHand),
      href: '/f/stock',
    });
  }

  /* 4 · Expiring inside the nearest configured window. */
  const nearestWindow = Math.min(...(config.expiryWarningDays.length ? config.expiryWarningDays : [30]));
  for (const level of stock) {
    if (level.status !== 'AVAILABLE' || !level.batchId) continue;
    const batch = batches.find((b) => b.id === level.batchId);
    const days = daysToExpiry(batch?.expiryDate, today);
    if (days === undefined || days < 0 || days > nearestWindow) continue;

    const product = productOf(level.productId);
    alerts.push({
      id: `exp-${level.key}`,
      kind: 'EXPIRING_SOON',
      title: `${product?.name ?? 'Item'} expires in ${days}d`,
      detail: `Batch ${batch?.batchNo ?? '—'} · ${level.quantity} ${product?.baseUnit ?? ''}`,
      severity: 'warning',
      value: valueOf(level.productId, level.quantity),
      href: '/f/stock',
    });
  }

  /* 5 · Held in quarantine too long — goods nobody decided about. */
  for (const level of stock) {
    if (level.status !== 'QUARANTINE') continue;
    const product = productOf(level.productId);
    alerts.push({
      id: `qua-${level.key}`,
      kind: 'QUARANTINE_AGEING',
      title: `${product?.name ?? 'Item'} held in quarantine`,
      detail: `${level.quantity} ${product?.baseUnit ?? ''} waiting on a decision`,
      severity: 'info',
      value: valueOf(level.productId, level.quantity),
      href: '/f/stock',
    });
  }

  /* 6 · Dead stock — value sitting still. */
  if (input.lastMovement) {
    for (const product of products) {
      const last = input.lastMovement[product.id];
      if (!last) continue;
      const days = Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000);
      if (days < config.deadStockDays) continue;

      const onHand = totalQuantity(stock, { productId: product.id, status: 'AVAILABLE' });
      if (!gt(onHand, ZERO)) continue;

      alerts.push({
        id: `dead-${product.id}`,
        kind: 'DEAD_STOCK',
        title: `${product.name} has not moved in ${days} days`,
        detail: `${onHand} ${product.baseUnit} sitting still`,
        severity: 'info',
        value: valueOf(product.id, onHand),
        href: '/f/stock',
      });
    }
  }

  return sortAlerts(alerts);
}

/**
 * Priority first, then rupiah within a priority. Never alphabetical, never by
 * recency — the most expensive problem of the most urgent kind comes first.
 */
export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const byKind = ALERT_PRIORITY.indexOf(a.kind) - ALERT_PRIORITY.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    const av = a.value ?? ZERO;
    const bv = b.value ?? ZERO;
    return gt(bv, av) ? 1 : gt(av, bv) ? -1 : 0;
  });
}

export function countByKind(alerts: readonly Alert[]): Record<AlertKind, number> {
  const counts = Object.fromEntries(ALERT_PRIORITY.map((k) => [k, 0])) as Record<AlertKind, number>;
  for (const alert of alerts) counts[alert.kind] += 1;
  return counts;
}
