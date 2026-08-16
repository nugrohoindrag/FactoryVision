import type { AnyEvent } from '@fv/contracts';
import { negativeLines, projectIssues, projectStock } from '@fv/domain';

/**
 * B-029 — when the server is allowed to say "conflict".
 *
 * The list is short on purpose, and the shortness is the design.
 *
 * Because stock is derived and the log is append-only, almost nothing actually
 * conflicts. Two devices receiving against the same PO is not a conflict —
 * both deliveries really happened, and the outstanding quantity is simply
 * recomputed. Two people claiming one task is not a conflict either; it is a
 * race, and it has an automatic winner (Tech Stack §2.8d).
 *
 * What IS a conflict is an event that cannot be reconciled by addition:
 *
 * | Case                                    | Why it cannot be added up          |
 * |-----------------------------------------|------------------------------------|
 * | Closing an already-closed issue         | Two different "consumed" figures   |
 * | Receiving against a manually CLOSED PO  | Erases a reasoned decision quietly |
 * | A stock line that would go negative     | Goods left a place that had none   |
 * | Recounting an approved stock take       | Approval already posted adjustments|
 *
 * Every conflict is work added to the warehouse head's day. A system that
 * declares them easily is a system whose conflict screen stops being opened —
 * and then the four cases above go unseen along with everything else.
 */

export type ConflictReason =
  | 'ISSUE_ALREADY_CLOSED'
  | 'PO_ALREADY_CLOSED'
  | 'WOULD_GO_NEGATIVE'
  | 'STOCK_TAKE_ALREADY_APPROVED';

export interface ConflictDecision {
  conflicted: boolean;
  reason?: ConflictReason;
  /** What the server believes instead — L04 shows both sides whole. */
  serverVersion?: unknown;
  message?: string;
}

export interface ServerState {
  /** Every event already accepted for this tenant. */
  log: readonly AnyEvent[];
  /** PO ids closed manually with a reason (F24). */
  closedPurchaseOrders: ReadonlySet<string>;
}

const ACCEPTED: ConflictDecision = { conflicted: false };

export function detectConflict(incoming: AnyEvent, state: ServerState): ConflictDecision {
  switch (incoming.type) {
    case 'material_issue.closed': {
      const balances = projectIssues(state.log);
      const existing = balances.get(incoming.payload.issueId);
      if (existing?.status === 'CLOSED') {
        return {
          conflicted: true,
          reason: 'ISSUE_ALREADY_CLOSED',
          serverVersion: existing,
          message:
            'This material issue was already closed on another device. ' +
            'Two closings mean two different "consumed" figures — pick one.',
        };
      }
      return ACCEPTED;
    }

    case 'goods_receipt.item_added': {
      const poId = incoming.payload.purchaseOrderId;
      if (poId && state.closedPurchaseOrders.has(poId)) {
        return {
          conflicted: true,
          reason: 'PO_ALREADY_CLOSED',
          serverVersion: { purchaseOrderId: poId, status: 'CLOSED' },
          message:
            'This purchase order was closed with a reason. Accepting more goods against ' +
            'it would erase that decision without anyone seeing.',
        };
      }
      return ACCEPTED;
    }

    case 'stock_take.counted': {
      const approved = state.log.some(
        (event) =>
          event.type === 'stock_take.approved' &&
          event.payload.sessionId === incoming.payload.sessionId,
      );
      if (approved) {
        return {
          conflicted: true,
          reason: 'STOCK_TAKE_ALREADY_APPROVED',
          serverVersion: { sessionId: incoming.payload.sessionId, status: 'APPROVED' },
          message:
            'That stock take was already approved and its adjustments were posted. ' +
            'A later count needs a new session.',
        };
      }
      return ACCEPTED;
    }

    default:
      return ACCEPTED;
  }
}

/**
 * The check that catches what the per-type rules cannot: an event that is
 * individually legal but leaves a location holding less than nothing.
 *
 * This is the one that has already found a real bug — a closing that removed
 * stock from the rack it was picked from, while the handover had moved it to
 * the production line. The two cancelled out in a per-status total, so the fault
 * was invisible until somebody looked per location and saw −92 kg on a rack
 * (Tech Stack §2.8b). With lanes there is more room to get it wrong, not less,
 * so this check is kept and run on every ingest.
 */
export function wouldGoNegative(log: readonly AnyEvent[], incoming: AnyEvent): ConflictDecision {
  const before = negativeLines(projectStock(log));
  const after = negativeLines(projectStock([...log, incoming]));

  if (after.length <= before.length) return ACCEPTED;

  const newlyNegative = after.filter(
    (line) => !before.some((existing) => existing.key === line.key),
  );

  return {
    conflicted: true,
    reason: 'WOULD_GO_NEGATIVE',
    serverVersion: newlyNegative,
    message:
      'This would leave stock below zero at ' +
      `${newlyNegative.length} location${newlyNegative.length === 1 ? '' : 's'}. ` +
      'Something moved that was not there — usually a transaction that has not synced yet.',
  };
}
