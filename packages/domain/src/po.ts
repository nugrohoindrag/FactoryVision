import type { AnyEvent, PurchaseOrder, PurchaseOrderStatus } from '@fv/contracts';
import { add, gt, isZero, max, sub, type Qty, ZERO } from './qty.js';

/**
 * Purchase Order projection (F24).
 *
 * The status is never stored. It is folded from the receipts that reference
 * the PO, for exactly the reason stock levels are (PRD §8): a written status
 * drifts away from its own receipts the first time two devices sync in a
 * different order, and then the PO screen and the stock screen disagree about
 * the same delivery.
 *
 * Pure: no React, no Dexie, no clock. `overdue` takes `today` as an argument
 * rather than reading one, so a test can pin the date.
 */

export interface PoLineProgress {
  lineId: string;
  productId: string;
  unit: string;
  ordered: Qty;
  /** Good quantity only — defect does not settle a line (see below). */
  received: Qty;
  /** Marked defective at the door. Still owed by the supplier. */
  defect: Qty;
  /** `ordered − received`, never negative. Over-receipt shows in `overReceived`. */
  outstanding: Qty;
  /** How much more than ordered actually arrived. Usually `0`. */
  overReceived: Qty;
}

export interface PoProgress {
  purchaseOrderId: string;
  poNo: string;
  supplierId: string;
  eta: string;
  status: PurchaseOrderStatus;
  lines: PoLineProgress[];
  totalOrdered: Qty;
  totalReceived: Qty;
  totalOutstanding: Qty;
  totalDefect: Qty;
  /** Manually closed with a reason while quantity was still outstanding. */
  closedReason: string | null;
  receiptCount: number;
  /** Date of the last receipt against this PO — how on-time delivery is judged. */
  lastReceiptDate: string | null;
}

interface Accum {
  received: Qty;
  defect: Qty;
}

/**
 * Folds one PO's progress out of the log.
 *
 * Defect is tracked but does NOT count as received. That is the whole point of
 * correction #2: 100 arrive, 3 are defective, 97 enter stock, and the PO stays
 * `PARTIALLY RECEIVED` so the remaining 3 stay visible as something the
 * supplier still owes.
 */
export function projectPurchaseOrder(po: PurchaseOrder, events: readonly AnyEvent[]): PoProgress {
  const perLine = new Map<string, Accum>();
  const receipts = new Set<string>();
  let closedReason: string | null = null;
  let lastReceiptDate: string | null = null;

  for (const event of events) {
    if (event.type === 'goods_receipt.item_added') {
      const p = event.payload;
      if (p.purchaseOrderId !== po.id || !p.purchaseOrderLineId) continue;
      const current = perLine.get(p.purchaseOrderLineId) ?? { received: ZERO, defect: ZERO };
      // Same append-only tolerance as the stock projection: pre-v1.3 receipts
      // carry no defect field and must still replay.
      const defect = p.defectQuantity ? p.defectQuantity : ZERO;
      // Good = what came off the truck minus what was marked defective.
      perLine.set(p.purchaseOrderLineId, {
        received: add(current.received, sub(p.quantity, defect)),
        defect: add(current.defect, defect),
      });
      receipts.add(p.receiptId);
      const day = event.occurredAt.slice(0, 10);
      if (!lastReceiptDate || day > lastReceiptDate) lastReceiptDate = day;
      continue;
    }
    if (event.type === 'purchase_order.closed' && event.payload.purchaseOrderId === po.id) {
      closedReason = event.payload.reasonCode;
    }
  }

  const lines: PoLineProgress[] = po.lines.map((line) => {
    const acc = perLine.get(line.id) ?? { received: ZERO, defect: ZERO };
    const remaining = sub(line.quantityOrdered, acc.received);
    return {
      lineId: line.id,
      productId: line.productId,
      unit: line.unit,
      ordered: line.quantityOrdered,
      received: acc.received,
      defect: acc.defect,
      // Clamped: an over-receipt must not show as negative outstanding, or the
      // total goes down and the PO looks more complete than it is.
      outstanding: max(remaining, ZERO),
      overReceived: max(sub(acc.received, line.quantityOrdered), ZERO),
    };
  });

  const totalOrdered = lines.reduce((acc, l) => add(acc, l.ordered), ZERO);
  const totalReceived = lines.reduce((acc, l) => add(acc, l.received), ZERO);
  const totalOutstanding = lines.reduce((acc, l) => add(acc, l.outstanding), ZERO);
  const totalDefect = lines.reduce((acc, l) => add(acc, l.defect), ZERO);

  return {
    purchaseOrderId: po.id,
    poNo: po.poNo,
    supplierId: po.supplierId,
    eta: po.eta,
    status: deriveStatus({
      cancelled: po.cancelled,
      closedReason,
      totalReceived,
      totalOutstanding,
    }),
    lines,
    totalOrdered,
    totalReceived,
    totalOutstanding,
    totalDefect,
    closedReason,
    receiptCount: receipts.size,
    lastReceiptDate,
  };
}

function deriveStatus(input: {
  cancelled: boolean;
  closedReason: string | null;
  totalReceived: Qty;
  totalOutstanding: Qty;
}): PurchaseOrderStatus {
  if (input.cancelled) return 'CANCELLED';
  // A manual close wins over the arithmetic — that IS the point of closing:
  // settling a remainder nobody expects to arrive (PRD §14.9).
  if (input.closedReason) return 'CLOSED';
  if (isZero(input.totalOutstanding)) return 'RECEIVED';
  if (isZero(input.totalReceived)) return 'OPEN';
  return 'PARTIALLY RECEIVED';
}

export function projectPurchaseOrders(
  orders: readonly PurchaseOrder[],
  events: readonly AnyEvent[],
): PoProgress[] {
  return orders.map((po) => projectPurchaseOrder(po, events));
}

/** Past its ETA with nothing received yet. Feeds the L26 `PO overdue` alert. */
export function isPoOverdue(progress: PoProgress, today: string): boolean {
  if (progress.status !== 'OPEN') return false;
  return today > progress.eta;
}

/**
 * Still short after `days` past the ETA. This is the one that matters
 * commercially: the goods came, some of them were wrong, and nobody chased
 * the rest.
 */
export function isPoPartialStale(progress: PoProgress, today: string, days = 7): boolean {
  if (progress.status !== 'PARTIALLY RECEIVED') return false;
  const due = new Date(`${progress.eta}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + days);
  return today > due.toISOString().slice(0, 10);
}

/** Percent complete as a 0–100 decimal string, for the K15 progress bar. */
export function poCompletion(progress: PoProgress): Qty {
  if (isZero(progress.totalOrdered)) return ZERO;
  const pct = (Number(progress.totalReceived) / Number(progress.totalOrdered)) * 100;
  return String(Math.min(100, Math.round(pct)));
}

/**
 * Supplier performance (K11), built from the receipts that already exist —
 * no extra bookkeeping. Available from day one precisely because PO and
 * receipt were linked in P0 rather than P1.
 */
export interface SupplierPerformance {
  supplierId: string;
  orders: number;
  fullyReceived: number;
  onTime: number;
  totalOrdered: Qty;
  totalReceived: Qty;
  totalDefect: Qty;
}

export function supplierPerformance(progresses: readonly PoProgress[]): SupplierPerformance[] {
  const bySupplier = new Map<string, SupplierPerformance>();
  for (const p of progresses) {
    const row =
      bySupplier.get(p.supplierId) ??
      ({
        supplierId: p.supplierId,
        orders: 0,
        fullyReceived: 0,
        onTime: 0,
        totalOrdered: ZERO,
        totalReceived: ZERO,
        totalDefect: ZERO,
      } satisfies SupplierPerformance);
    row.orders += 1;
    if (p.status === 'RECEIVED') row.fullyReceived += 1;
    // On time = completed, and the last delivery landed on or before the ETA.
    if (p.status === 'RECEIVED' && p.lastReceiptDate && p.lastReceiptDate <= p.eta) {
      row.onTime += 1;
    }
    row.totalOrdered = add(row.totalOrdered, p.totalOrdered);
    row.totalReceived = add(row.totalReceived, p.totalReceived);
    row.totalDefect = add(row.totalDefect, p.totalDefect);
    bySupplier.set(p.supplierId, row);
  }
  // Worst defect rate first — that is the list a factory owner acts on.
  return [...bySupplier.values()].sort((a, b) =>
    gt(b.totalDefect, a.totalDefect) ? 1 : gt(a.totalDefect, b.totalDefect) ? -1 : 0,
  );
}

/** Receipts that were never tied to a PO — the `Receipts without PO` report. */
export function receiptsWithoutPo(events: readonly AnyEvent[]): string[] {
  const linked = new Set<string>();
  const all = new Set<string>();
  for (const event of events) {
    if (event.type === 'goods_receipt.created') {
      all.add(event.payload.receiptId);
      if (event.payload.purchaseOrderId) linked.add(event.payload.receiptId);
    }
  }
  return [...all].filter((id) => !linked.has(id));
}
