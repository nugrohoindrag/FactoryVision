import type { AnyEvent, StockRef, StockStatus } from '@fv/contracts';
import { add, gt, isZero, sub, type Qty, ZERO } from './qty.js';

/**
 * Stock projection — the fold that turns the event log into "how much is where".
 *
 * Nothing in the product stores a stock level. Every number on every screen
 * comes through here, which is why Tech Stack §7 puts this before any screen:
 * "kalau projeksi stok belum benar, setiap layar akan menampilkan angka yang
 * salah dengan meyakinkan."
 *
 * Pure: no React, no Dexie, no clock. Feed it events, get a snapshot.
 */

export type StockKey = string;

export interface StockLevel extends StockRef {
  key: StockKey;
  quantity: Qty;
}

export function stockKey(ref: StockRef): StockKey {
  return [ref.productId, ref.batchId ?? '-', ref.locationId, ref.status].join('|');
}

export interface Movement {
  ref: StockRef;
  /** Signed decimal string. */
  delta: Qty;
}

const at = (ref: StockRef, status: StockStatus, locationId = ref.locationId): StockRef => ({
  ...ref,
  status,
  locationId,
});

/** Where an inspection decision sends the goods (UI Spec §9, DS §13). */
const INSPECTION_TARGET: Record<string, StockStatus> = {
  PASS: 'AVAILABLE',
  HOLD: 'QUARANTINE',
  REJECT: 'REJECTED',
};

/**
 * Some events describe an outcome without repeating the lines it applies to
 * (`handed_over`, `shipped`). The fold keeps just enough context to resolve
 * them — deliberately small, and rebuilt from the log every time.
 */
interface FoldContext {
  /** issueId → what was picked and handed over, per line. */
  issuePicks: Map<string, { lineId: string; ref: StockRef; quantity: Qty }[]>;
  /** `issueId|lineId` → quantity already returned, so closing removes only the rest. */
  issueReturned: Map<string, Qty>;
  /**
   * issueId → where the goods physically went at handover.
   *
   * Without this, closing an issue subtracts from `IN PRODUCTION` at the RACK
   * the goods were picked from, while handover credited `IN PRODUCTION` at the
   * production floor. The two cancel out in a whole-status total, so the bug
   * hides — until a per-location view shows −92 kg sitting on a rack.
   */
  issueLocation: Map<string, string>;
  shipmentPicks: Map<string, { ref: StockRef; quantity: Qty }[]>;
}

function movementsOf(event: AnyEvent, ctx: FoldContext): Movement[] {
  switch (event.type) {
    case 'goods_receipt.item_added': {
      const p = event.payload;
      // `quantity` is what came off the truck; `defectQuantity` is a part of
      // it, not an addition. Good stock is the remainder (PRD F2, v1.3).
      //
      // Falls back to zero when the field is absent: the log is append-only,
      // so receipts written before v1.3 keep replaying out of existing
      // databases forever. A projection that assumes every event carries every
      // field added later is a projection that breaks on upgrade.
      const defect = p.defectQuantity ? p.defectQuantity : ZERO;
      const good = sub(p.quantity, defect);
      const moves: Movement[] = [];
      if (!isZero(good)) {
        moves.push({
          ref: {
            productId: p.productId,
            batchId: p.batchId,
            locationId: p.locationId,
            status: p.landsIn,
          },
          delta: good,
        });
      }
      // Defect never touches AVAILABLE. It sits in REJECTED against its PO
      // line, waiting for a supplier return (F17, P1) or a reasoned PO close.
      if (!isZero(defect) && p.defectLocationId) {
        moves.push({
          ref: {
            productId: p.productId,
            batchId: p.batchId,
            locationId: p.defectLocationId,
            status: 'REJECTED',
          },
          delta: defect,
        });
      }
      return moves;
    }

    case 'inspection.decided': {
      const p = event.payload;
      const target = INSPECTION_TARGET[p.decision];
      if (!target) return [];
      return [
        { ref: p.ref, delta: `-${p.quantity}` },
        { ref: at(p.ref, target), delta: p.quantity },
      ];
    }

    case 'putaway.completed': {
      const p = event.payload;
      return [
        { ref: p.ref, delta: `-${p.quantity}` },
        { ref: at(p.ref, p.ref.status, p.toLocationId), delta: p.quantity },
      ];
    }

    case 'material_issue.prepared': {
      const p = event.payload;
      ctx.issuePicks.set(
        p.issueId,
        p.picks.map((pick) => ({ lineId: pick.lineId, ref: pick.ref, quantity: pick.quantity })),
      );
      // Reserved, not yet gone: the goods are still physically in the rack.
      return p.picks.flatMap((pick) => [
        { ref: pick.ref, delta: `-${pick.quantity}` },
        { ref: at(pick.ref, 'ALLOCATED'), delta: pick.quantity },
      ]);
    }

    case 'material_issue.handed_over': {
      const p = event.payload;
      const picks = ctx.issuePicks.get(p.issueId) ?? [];
      ctx.issueLocation.set(p.issueId, p.toLocationId);
      // Handover is the moment stock leaves the warehouse for the floor.
      return picks.flatMap((pick) => [
        { ref: at(pick.ref, 'ALLOCATED'), delta: `-${pick.quantity}` },
        { ref: at(pick.ref, 'IN PRODUCTION', p.toLocationId), delta: pick.quantity },
      ]);
    }

    case 'material_issue.returned': {
      const p = event.payload;
      const picks = ctx.issuePicks.get(p.issueId) ?? [];
      const floor = ctx.issueLocation.get(p.issueId);
      return p.returns.flatMap((r) => {
        const pick = picks.find((x) => x.lineId === r.lineId);
        // Material comes back from where it was handed over to.
        const from = pick ? at(pick.ref, 'IN PRODUCTION', floor ?? r.ref.locationId) : r.ref;
        const seen = `${p.issueId}|${r.lineId}`;
        ctx.issueReturned.set(seen, add(ctx.issueReturned.get(seen) ?? ZERO, r.quantity));
        return [
          { ref: from, delta: `-${r.quantity}` },
          { ref: at(r.ref, 'AVAILABLE', r.toLocationId), delta: r.quantity },
        ];
      });
    }

    case 'material_issue.closed': {
      // Consumed and shrinkage both leave stock for good. Whatever is still
      // sitting IN PRODUCTION for this issue is what was used up.
      const p = event.payload;
      if (p.resultingStatus !== 'CLOSED') return [];
      const picks = ctx.issuePicks.get(p.issueId) ?? [];
      const floor = ctx.issueLocation.get(p.issueId);
      return picks
        .map((pick) => {
          // What is still on the floor = picked − already returned.
          const returned = ctx.issueReturned.get(`${p.issueId}|${pick.lineId}`) ?? ZERO;
          return { pick, remaining: sub(pick.quantity, returned) };
        })
        .filter(({ remaining }) => gt(remaining, ZERO))
        .map(({ pick, remaining }) => ({
          // Consumed from the production floor — the same place handover put it.
          ref: at(pick.ref, 'IN PRODUCTION', floor ?? pick.ref.locationId),
          delta: `-${remaining}`,
        }));
    }

    case 'production.output_submitted': {
      const p = event.payload;
      const moves: Movement[] = [
        {
          ref: {
            productId: p.productId,
            batchId: p.batchId,
            locationId: p.locationId,
            status: p.landsIn,
          },
          delta: p.quantity,
        },
      ];
      // Reject never mixes with sellable stock (UI Spec §13).
      if (!isZero(p.rejectQuantity) && p.rejectLocationId) {
        moves.push({
          ref: {
            productId: p.productId,
            batchId: p.batchId,
            locationId: p.rejectLocationId,
            status: 'REJECTED',
          },
          delta: p.rejectQuantity,
        });
      }
      return moves;
    }

    case 'shipment.picked': {
      const p = event.payload;
      ctx.shipmentPicks.set(
        p.shipmentId,
        p.picks.map((pick) => ({ ref: pick.ref, quantity: pick.quantity })),
      );
      return p.picks.flatMap((pick) => [
        { ref: pick.ref, delta: `-${pick.quantity}` },
        { ref: at(pick.ref, 'ALLOCATED'), delta: pick.quantity },
      ]);
    }

    case 'shipment.shipped': {
      const picks = ctx.shipmentPicks.get(event.payload.shipmentId) ?? [];
      return picks.map((pick) => ({
        ref: at(pick.ref, 'ALLOCATED'),
        delta: `-${pick.quantity}`,
      }));
    }

    case 'stock.adjusted':
      return [{ ref: event.payload.ref, delta: event.payload.delta }];

    case 'stock_take.approved':
      return event.payload.adjustments.map((a) => ({ ref: a.ref, delta: a.delta }));

    default:
      // Requests, handover confirmations and counts move no stock by design.
      return [];
  }
}

/**
 * Folds events into stock levels. Events must be for a single tenant and in
 * log order (UUIDv7 ids already sort that way).
 *
 * Zero lines are dropped: a rack that was emptied should disappear from the
 * stock screen, not linger as `0 kg`.
 */
export function projectStock(events: readonly AnyEvent[]): StockLevel[] {
  const ledger = new Map<StockKey, StockLevel>();
  const ctx: FoldContext = {
    issuePicks: new Map(),
    issueReturned: new Map(),
    issueLocation: new Map(),
    shipmentPicks: new Map(),
  };

  for (const event of events) {
    for (const move of movementsOf(event, ctx)) {
      const key = stockKey(move.ref);
      const current = ledger.get(key);
      if (current) {
        current.quantity = add(current.quantity, move.delta);
      } else {
        ledger.set(key, { key, ...move.ref, quantity: add(ZERO, move.delta) });
      }
    }
  }

  return [...ledger.values()].filter((level) => !isZero(level.quantity));
}

/**
 * The same fold, held open.
 *
 * `projectStock` is the right shape for a screen: hand it a log, get a
 * snapshot. It is the wrong shape for ingest, where the server has to ask
 * "would THIS event send anything below zero" once per incoming event. Doing
 * that with `projectStock` means re-folding the whole log per event — 50 events
 * against a 200,000-movement log is ten million folds for one sync from one
 * phone, and the warehouse is holding a truck while it happens.
 *
 * So the fold is exposed as an object that keeps its own context and applies
 * events one at a time. Same code path, same `movementsOf`, same context — this
 * is not a second implementation, which is exactly the property that matters
 * (Backend Plan B-031: one projection, two runtimes).
 */
export class StockProjector {
  private readonly ledger = new Map<StockKey, StockLevel>();
  private readonly ctx: FoldContext = {
    issuePicks: new Map(),
    issueReturned: new Map(),
    issueLocation: new Map(),
    shipmentPicks: new Map(),
  };

  /** Keys touched by the last `apply` — enough to check for new negatives. */
  private lastTouched: StockKey[] = [];

  apply(event: AnyEvent): void {
    this.lastTouched = [];
    for (const move of movementsOf(event, this.ctx)) {
      const key = stockKey(move.ref);
      this.lastTouched.push(key);
      const current = this.ledger.get(key);
      if (current) {
        current.quantity = add(current.quantity, move.delta);
      } else {
        this.ledger.set(key, { key, ...move.ref, quantity: add(ZERO, move.delta) });
      }
    }
  }

  applyAll(events: readonly AnyEvent[]): void {
    for (const event of events) this.apply(event);
  }

  /** Non-zero lines, same contract as `projectStock`. */
  levels(): StockLevel[] {
    return [...this.ledger.values()].filter((level) => !isZero(level.quantity));
  }

  /**
   * Lines the LAST applied event pushed below zero.
   *
   * Only the touched keys are inspected, so the check costs what the event
   * costs rather than what the history costs.
   */
  negativeFromLast(): StockLevel[] {
    const seen = new Set<StockKey>();
    const bad: StockLevel[] = [];
    for (const key of this.lastTouched) {
      if (seen.has(key)) continue;
      seen.add(key);
      const level = this.ledger.get(key);
      if (level && level.quantity.startsWith('-')) bad.push({ ...level });
    }
    return bad;
  }

  /** Every key the ledger has ever touched, zero balances included. */
  allKeys(): Set<StockKey> {
    return new Set(this.ledger.keys());
  }

  /** Keys the last `apply` touched — what the caller has to re-examine. */
  touchedKeys(): StockKey[] {
    return [...new Set(this.lastTouched)];
  }

  /** Undoes the last `apply` by folding its inverse — used to reject an event. */
  revert(event: AnyEvent): void {
    // The context is NOT rewound: `movementsOf` reads picks and handover
    // locations recorded by earlier events, and an event that is being rejected
    // has not contributed any. Reverting quantities is enough, and rewinding
    // context would mean modelling every event's effect on it twice.
    for (const move of movementsOf(event, cloneContext(this.ctx))) {
      const key = stockKey(move.ref);
      const current = this.ledger.get(key);
      if (current) current.quantity = sub(current.quantity, move.delta);
    }
  }
}

function cloneContext(ctx: FoldContext): FoldContext {
  return {
    issuePicks: new Map(ctx.issuePicks),
    issueReturned: new Map(ctx.issueReturned),
    issueLocation: new Map(ctx.issueLocation),
    shipmentPicks: new Map(ctx.shipmentPicks),
  };
}

/** Total across every batch/location/status that passes `filter`. */
export function totalQuantity(
  levels: readonly StockLevel[],
  filter?: Partial<Pick<StockRef, 'productId' | 'locationId' | 'status' | 'batchId'>>,
): Qty {
  return levels
    .filter((l) =>
      Object.entries(filter ?? {}).every(([k, v]) => l[k as keyof StockRef] === v),
    )
    .reduce((acc, l) => add(acc, l.quantity), ZERO);
}

/** What can actually be issued or shipped right now. */
export function availableStock(levels: readonly StockLevel[], productId?: string): StockLevel[] {
  return levels.filter(
    (l) => l.status === 'AVAILABLE' && gt(l.quantity, ZERO) && (!productId || l.productId === productId),
  );
}

/** Lines whose quantity went below zero — a projection bug or a bad import. */
export function negativeLines(levels: readonly StockLevel[]): StockLevel[] {
  return levels.filter((l) => l.quantity.startsWith('-'));
}
