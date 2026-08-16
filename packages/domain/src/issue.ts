import type { AnyEvent, MaterialIssueStatus, ShrinkageReason } from '@fv/contracts';
import { add, isNegative, sub, type Qty, ZERO } from './qty.js';

/**
 * Material Issue balance — the calculation the whole product hangs on.
 *
 *     Issued − Returned − Shrinkage = Consumed        (PRD F6, UI Spec L19)
 *
 * L19 shows this panel live while the operator types. If it leaves a fake
 * decimal remainder the issue never closes clean, and the metric that decides
 * whether this product works (≥85% of issues closed <24h) is unreachable.
 */

export interface IssueLineBalance {
  lineId: string;
  productId: string;
  unit: string;
  issued: Qty;
  returned: Qty;
  shrinkage: Qty;
  /** Derived, never entered: `issued − returned − shrinkage`. */
  consumed: Qty;
  /** The operator gave a shrinkage reason for this line (zero counts). */
  accounted: boolean;
  /** Returned + shrinkage exceeds issued — physically impossible, block the close. */
  overAccounted: boolean;
}

export interface IssueBalance {
  issueId: string;
  lines: IssueLineBalance[];
  totals: { issued: Qty; returned: Qty; shrinkage: Qty; consumed: Qty };
  /** Lines still unexplained. Non-empty ⇒ the issue cannot become CLOSED. */
  unaccountedLineIds: string[];
  /** True if any line is over-accounted. Blocks the close action entirely. */
  invalid: boolean;
  /**
   * Identity and lifecycle, projected alongside the arithmetic so screens
   * never re-derive it from the log themselves (L14, L17, K02 all need it).
   */
  workOrderNo?: string;
  requestedBy?: string;
  requestedAt?: string;
  /** When the goods actually reached the floor — the age clock starts here. */
  handedOverAt?: string;
  quick?: boolean;
  status: MaterialIssueStatus;
  /** Prepared but not yet handed over. */
  prepared: boolean;
}

export interface ShrinkageEntry {
  lineId: string;
  quantity: Qty;
  reason: ShrinkageReason;
  note?: string;
}

/** One line's arithmetic. Kept separate so L19 can call it on every keystroke. */
export function computeLineBalance(input: {
  lineId: string;
  productId: string;
  unit: string;
  issued: Qty;
  returned?: Qty;
  shrinkage?: Qty;
  accounted?: boolean;
}): IssueLineBalance {
  const returned = input.returned ?? ZERO;
  const shrinkage = input.shrinkage ?? ZERO;
  const consumed = sub(input.issued, returned, shrinkage);
  return {
    lineId: input.lineId,
    productId: input.productId,
    unit: input.unit,
    issued: input.issued,
    returned,
    shrinkage,
    consumed,
    accounted: input.accounted ?? false,
    overAccounted: isNegative(consumed),
  };
}

export function summariseIssue(
  issueId: string,
  lines: IssueLineBalance[],
  meta: Partial<Omit<IssueBalance, 'issueId' | 'lines' | 'totals' | 'unaccountedLineIds' | 'invalid'>> = {},
): IssueBalance {
  return {
    issueId,
    lines,
    status: 'OPEN',
    prepared: false,
    ...meta,
    totals: {
      issued: lines.reduce((acc, l) => add(acc, l.issued), ZERO),
      returned: lines.reduce((acc, l) => add(acc, l.returned), ZERO),
      shrinkage: lines.reduce((acc, l) => add(acc, l.shrinkage), ZERO),
      consumed: lines.reduce((acc, l) => add(acc, l.consumed), ZERO),
    },
    unaccountedLineIds: lines.filter((l) => !l.accounted).map((l) => l.lineId),
    invalid: lines.some((l) => l.overAccounted),
  };
}

/**
 * The status a close attempt would produce.
 *
 * There is no third option and no force-close: an issue with an unexplained
 * remainder stays PARTIALLY CLOSED and keeps showing up in L17 and K02. That
 * nagging is the only social pressure that gets issues closed (UI Spec §12).
 */
export function decideIssueStatus(balance: IssueBalance): MaterialIssueStatus {
  if (balance.invalid) return 'OPEN';
  return balance.unaccountedLineIds.length === 0 ? 'CLOSED' : 'PARTIALLY CLOSED';
}

/** Guard for the `Close issue` action — the UI disables the button on `false`. */
export function canClose(balance: IssueBalance): boolean {
  return !balance.invalid;
}

/**
 * Rebuilds every open/closed issue's balance from the log.
 * `issued` comes from what was actually prepared and handed over, not from
 * what was requested — the operator may have picked less than was asked for.
 */
export function projectIssues(events: readonly AnyEvent[]): Map<string, IssueBalance> {
  type Draft = {
    issueId: string;
    lines: Map<string, { productId: string; unit: string; issued: Qty; returned: Qty; shrinkage: Qty; accounted: boolean }>;
    status: MaterialIssueStatus;
    prepared: boolean;
    workOrderNo?: string;
    requestedBy?: string;
    requestedAt?: string;
    handedOverAt?: string;
    quick?: boolean;
  };

  type DraftLine = {
    productId: string;
    unit: string;
    issued: Qty;
    returned: Qty;
    shrinkage: Qty;
    accounted: boolean;
  };

  /** A line we have quantities for but no request yet — see `requested` above. */
  const blankLine = (
    meta?: { productId: string; unit: string },
    fallbackProductId = '',
  ): DraftLine => ({
    productId: meta?.productId ?? fallbackProductId,
    unit: meta?.unit ?? '',
    issued: ZERO,
    returned: ZERO,
    shrinkage: ZERO,
    accounted: false,
  });

  const drafts = new Map<string, Draft>();
  const lineUnits = new Map<string, { productId: string; unit: string }>();

  const draftFor = (issueId: string): Draft => {
    let d = drafts.get(issueId);
    if (!d) {
      d = { issueId, lines: new Map(), status: 'OPEN', prepared: false };
      drafts.set(issueId, d);
    }
    return d;
  };

  for (const event of events) {
    switch (event.type) {
      case 'material_issue.requested': {
        const d = draftFor(event.payload.issueId);
        d.workOrderNo = event.payload.workOrderNo;
        d.requestedBy = event.payload.requestedBy;
        d.requestedAt = event.occurredAt;
        d.quick = event.payload.quick;
        for (const line of event.payload.lines) {
          lineUnits.set(line.lineId, { productId: line.productId, unit: line.unit });
          /**
           * MERGE, never replace.
           *
           * The request does not have to be the first event of its issue to
           * arrive. Production writes it on their phone on the factory floor;
           * the warehouse writes `prepared` and `handed_over` on theirs. If the
           * warehouse device syncs first — which it does, because it is the one
           * standing near the office wifi — the request lands on top of a line
           * that already has 90 kg issued against it.
           *
           * Replacing the line here would zero that, and the closing figure
           * would come out as `0 − 8 − 0.5 = −8.5 consumed`. Negative
           * consumption is not a number anybody can act on, and it appears
           * only on the server and on the devices that pulled the events in
           * that order — so two people looking at the same issue would see
           * different figures and neither would be able to say why.
           */
          const existing = d.lines.get(line.lineId);
          d.lines.set(line.lineId, {
            productId: line.productId,
            unit: line.unit,
            issued: existing?.issued ?? ZERO,
            returned: existing?.returned ?? ZERO,
            shrinkage: existing?.shrinkage ?? ZERO,
            accounted: existing?.accounted ?? false,
          });
        }
        break;
      }

      case 'material_issue.prepared': {
        const d = draftFor(event.payload.issueId);
        d.prepared = true;
        for (const pick of event.payload.picks) {
          const meta = lineUnits.get(pick.lineId);
          const line = d.lines.get(pick.lineId) ?? {
            productId: meta?.productId ?? pick.ref.productId,
            unit: meta?.unit ?? '',
            issued: ZERO,
            returned: ZERO,
            shrinkage: ZERO,
            accounted: false,
          };
          line.issued = add(line.issued, pick.quantity);
          d.lines.set(pick.lineId, line);
        }
        break;
      }

      case 'material_issue.handed_over':
        // The age clock starts at handover, not at the request: an issue is
        // only "open" once the material has actually left the warehouse.
        draftFor(event.payload.issueId).handedOverAt = event.occurredAt;
        break;

      case 'material_issue.returned': {
        const d = draftFor(event.payload.issueId);
        for (const r of event.payload.returns) {
          // Same reasoning as `requested`: a return can reach the log before
          // the request that names the line. Creating the line rather than
          // dropping the quantity keeps the arithmetic whole whatever order
          // the two devices happen to sync in.
          const line = d.lines.get(r.lineId) ?? blankLine(lineUnits.get(r.lineId), r.ref.productId);
          line.returned = add(line.returned, r.quantity);
          d.lines.set(r.lineId, line);
        }
        break;
      }

      case 'material_issue.closed': {
        const d = draftFor(event.payload.issueId);
        for (const s of event.payload.shrinkage) {
          const line = d.lines.get(s.lineId) ?? blankLine(lineUnits.get(s.lineId));
          line.shrinkage = add(line.shrinkage, s.quantity);
          line.accounted = true;
          d.lines.set(s.lineId, line);
        }
        d.status = event.payload.resultingStatus;
        break;
      }

      default:
        break;
    }
  }

  const result = new Map<string, IssueBalance>();
  for (const [issueId, draft] of drafts) {
    const lines = [...draft.lines.entries()].map(([lineId, l]) =>
      computeLineBalance({ lineId, ...l }),
    );
    result.set(
      issueId,
      summariseIssue(issueId, lines, {
        status: draft.status,
        prepared: draft.prepared,
        workOrderNo: draft.workOrderNo,
        requestedBy: draft.requestedBy,
        requestedAt: draft.requestedAt,
        handedOverAt: draft.handedOverAt,
        quick: draft.quick,
      }),
    );
  }
  return result;
}

/** Age in whole hours. >24 is the one condition allowed to show red (UI Spec D4). */
export function issueAgeHours(openedAt: string, now: Date): number {
  const ms = now.getTime() - new Date(openedAt).getTime();
  return Math.max(0, Math.floor(ms / 3_600_000));
}

export function isOverdue(openedAt: string, now: Date, thresholdHours = 24): boolean {
  return issueAgeHours(openedAt, now) >= thresholdHours;
}

/** Convenience for L19's live panel — recompute on every keystroke. */
export function previewClose(
  lines: Omit<IssueLineBalance, 'consumed' | 'accounted' | 'overAccounted'>[],
  entries: ShrinkageEntry[],
): IssueBalance & { resultingStatus: MaterialIssueStatus } {
  const byLine = new Map(entries.map((e) => [e.lineId, e]));
  const computed = lines.map((l) => {
    const entry = byLine.get(l.lineId);
    return computeLineBalance({
      ...l,
      shrinkage: entry ? entry.quantity : ZERO,
      accounted: Boolean(entry),
    });
  });
  const balance = summariseIssue('preview', computed);
  return { ...balance, resultingStatus: decideIssueStatus(balance) };
}
