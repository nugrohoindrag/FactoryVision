import type { AnyEvent, TaskStatus, TaskType } from '@fv/contracts';
import type { PoProgress } from './po.js';

/**
 * Task queue & assignment (F25, lapisan N).
 *
 * Answers the question nothing in the product answered before: *how does an
 * operator know there is work?* Until v1.3 the model was pure pull — badges on
 * Home, and whoever was nearest picked it up. Nobody owned anything, so
 * nobody could be asked about a discrepancy (M12).
 *
 * ## Tasks are projected, not created
 *
 * There is no `task.created` event. A task exists because work exists: a PO
 * whose goods have not arrived, a request nobody has prepared, a stock take
 * session still running. It disappears when the work is done — no manual
 * checkbox, because a checkbox creates a second truth that will disagree with
 * the first one (UI Spec L27).
 *
 * What IS recorded is ownership: `task.claimed`, `task.assigned`,
 * `task.released`. Those reference a task by a DERIVED, deterministic id
 * (`type:refId`), which is what lets a claim point at something no event ever
 * created.
 */

export interface Task {
  /** Deterministic: `${type}:${refId}`. Stable across replays and devices. */
  id: string;
  type: TaskType;
  /** The document this task is about — PO id, receipt id, issue id… */
  refId: string;
  /** Human reference shown on the card: `PO-1042`, `MR-207`, `Session #7`. */
  label: string;
  status: TaskStatus;
  ownerId: string | null;
  /** ISO date the work should be done by. `null` when nothing sets a deadline. */
  dueDate: string | null;
  /** When the underlying work appeared — drives the "waiting for" age. */
  createdAt: string;
  /** Extra context for the card, e.g. `Line 2` or `6 items`. */
  detail: string;
  overdue: boolean;
}

const taskId = (type: TaskType, refId: string): string => `${type}:${refId}`;

interface Ownership {
  ownerId: string | null;
  /** `ASSIGNED` outranks `CLAIMED` in the badge, but both lock the task. */
  kind: 'CLAIMED' | 'ASSIGNED' | null;
}

/** Last ownership event wins. Release clears it back to the open queue. */
function foldOwnership(events: readonly AnyEvent[]): Map<string, Ownership> {
  const owners = new Map<string, Ownership>();
  for (const event of events) {
    switch (event.type) {
      case 'task.claimed':
        owners.set(event.payload.taskId, {
          ownerId: event.payload.claimedBy,
          kind: 'CLAIMED',
        });
        break;
      case 'task.assigned':
        owners.set(event.payload.taskId, {
          ownerId: event.payload.assignedTo,
          kind: 'ASSIGNED',
        });
        break;
      case 'task.released':
        owners.set(event.payload.taskId, { ownerId: null, kind: null });
        break;
      default:
        break;
    }
  }
  return owners;
}

export interface TaskSources {
  /** Today as `YYYY-MM-DD`. Passed in, never read — so tests can pin it. */
  today: string;
  /** PO progress drives the arrival tasks. Without an ETA there is no task. */
  purchaseOrders?: readonly PoProgress[];
  /** How many days before ETA an arrival task appears. H-1 by default. */
  arrivalLeadDays?: number;
}

/** `YYYY-MM-DD` minus n days, without pulling in a date library. */
function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the live task list.
 *
 * Returns ONLY open work. A finished task is absent, not `DONE` — see the
 * header. `DONE` stays in the status enum because the board may later want to
 * show a completed tail, but nothing in P0 produces it.
 */
export function projectTasks(events: readonly AnyEvent[], sources: TaskSources): Task[] {
  const { today, purchaseOrders = [], arrivalLeadDays = 1 } = sources;
  const owners = foldOwnership(events);
  const tasks: Task[] = [];

  /* --- 1 · Receive delivery, from PO ETA -------------------------------- */
  // This is the answer to "how does an operator know goods are coming before
  // the truck shows up at the gate" (PRD F24/F25).
  for (const po of purchaseOrders) {
    if (po.status !== 'OPEN' && po.status !== 'PARTIALLY RECEIVED') continue;
    // Not yet worth showing: still more than the lead time away.
    if (today < minusDays(po.eta, arrivalLeadDays)) continue;
    tasks.push(
      build({
        type: 'RECEIVE_DELIVERY',
        refId: po.purchaseOrderId,
        label: po.poNo,
        detail: `${po.lines.length} lines · ${po.totalOutstanding} outstanding`,
        dueDate: po.eta,
        createdAt: minusDays(po.eta, arrivalLeadDays),
        // Something has arrived but not all of it — genuinely part-done work.
        progressed: po.status === 'PARTIALLY RECEIVED',
        owners,
        today,
      }),
    );
  }

  /* --- 2 · Putaway, per receipt ----------------------------------------- */
  const receiptLines = new Map<string, { count: number; createdAt: string }>();
  const batchToReceipt = new Map<string, string>();
  const putawayDone = new Map<string, number>();

  for (const event of events) {
    if (event.type === 'goods_receipt.item_added') {
      const p = event.payload;
      const current = receiptLines.get(p.receiptId) ?? { count: 0, createdAt: event.occurredAt };
      current.count += 1;
      receiptLines.set(p.receiptId, current);
      batchToReceipt.set(p.batchId, p.receiptId);
    }
    if (event.type === 'putaway.completed') {
      const receiptId = batchToReceipt.get(event.payload.ref.batchId ?? '');
      if (receiptId) putawayDone.set(receiptId, (putawayDone.get(receiptId) ?? 0) + 1);
    }
  }

  for (const [receiptId, info] of receiptLines) {
    const done = putawayDone.get(receiptId) ?? 0;
    if (done >= info.count) continue; // finished — the task simply ceases to exist
    tasks.push(
      build({
        type: 'PUTAWAY',
        refId: receiptId,
        label: shortRef('GR', receiptId),
        detail: `${info.count - done} of ${info.count} items left`,
        dueDate: info.createdAt.slice(0, 10),
        createdAt: info.createdAt,
        progressed: done > 0,
        owners,
        today,
      }),
    );
  }

  /* --- 3 · Prepare material issue --------------------------------------- */
  const requested = new Map<string, { at: string; dest: string; lines: number; wo: string }>();
  const prepared = new Set<string>();
  for (const event of events) {
    if (event.type === 'material_issue.requested') {
      requested.set(event.payload.issueId, {
        at: event.occurredAt,
        dest: event.payload.destinationId,
        lines: event.payload.lines.length,
        wo: event.payload.workOrderNo,
      });
    }
    if (event.type === 'material_issue.prepared') prepared.add(event.payload.issueId);
  }
  for (const [issueId, info] of requested) {
    if (prepared.has(issueId)) continue;
    tasks.push(
      build({
        type: 'PREPARE_ISSUE',
        refId: issueId,
        label: info.wo || shortRef('MR', issueId),
        detail: `${info.lines} materials`,
        dueDate: info.at.slice(0, 10),
        createdAt: info.at,
        progressed: false,
        owners,
        today,
      }),
    );
  }

  /* --- 4 · Pick & ship --------------------------------------------------- */
  const shipments = new Map<string, { at: string; lines: number }>();
  const picked = new Set<string>();
  for (const event of events) {
    if (event.type === 'shipment.created') {
      shipments.set(event.payload.shipmentId, {
        at: event.occurredAt,
        lines: event.payload.lines.length,
      });
    }
    if (event.type === 'shipment.shipped') picked.add(event.payload.shipmentId);
  }
  for (const [shipmentId, info] of shipments) {
    if (picked.has(shipmentId)) continue;
    tasks.push(
      build({
        type: 'PICK_SHIP',
        refId: shipmentId,
        label: shortRef('SO', shipmentId),
        detail: `${info.lines} lines`,
        dueDate: info.at.slice(0, 10),
        createdAt: info.at,
        progressed: false,
        owners,
        today,
      }),
    );
  }

  /* --- 5 · Stock take ---------------------------------------------------- */
  const sessions = new Map<string, { at: string; scope: number }>();
  const approved = new Set<string>();
  for (const event of events) {
    if (event.type === 'stock_take.session_created') {
      sessions.set(event.payload.sessionId, {
        at: event.occurredAt,
        scope: event.payload.scopeLocationIds.length,
      });
    }
    if (event.type === 'stock_take.approved') approved.add(event.payload.sessionId);
  }
  const counted = new Set<string>();
  for (const event of events) {
    if (event.type === 'stock_take.counted') counted.add(event.payload.sessionId);
  }
  for (const [sessionId, info] of sessions) {
    if (approved.has(sessionId)) continue;
    tasks.push(
      build({
        type: 'COUNT_STOCK',
        refId: sessionId,
        label: shortRef('Session', sessionId),
        detail: `${info.scope} locations`,
        dueDate: info.at.slice(0, 10),
        createdAt: info.at,
        progressed: counted.has(sessionId),
        owners,
        today,
      }),
    );
  }

  // Overdue first, then oldest. The board and the field list share this order
  // so "what is most urgent" never depends on which screen you opened.
  return tasks.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

function build(input: {
  type: TaskType;
  refId: string;
  label: string;
  detail: string;
  dueDate: string | null;
  createdAt: string;
  progressed: boolean;
  owners: Map<string, Ownership>;
  today: string;
}): Task {
  const id = taskId(input.type, input.refId);
  const own = input.owners.get(id) ?? { ownerId: null, kind: null };
  const status: TaskStatus = own.ownerId
    ? input.progressed
      ? 'IN PROGRESS'
      : (own.kind ?? 'CLAIMED')
    : 'UNASSIGNED';

  return {
    id,
    type: input.type,
    refId: input.refId,
    label: input.label,
    detail: input.detail,
    status,
    ownerId: own.ownerId,
    dueDate: input.dueDate,
    createdAt: input.createdAt,
    overdue: input.dueDate !== null && input.today > input.dueDate,
  };
}

/** `GR-3f2a` — enough to recognise, short enough for a 360px card. */
function shortRef(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/-/g, '').slice(-4).toUpperCase()}`;
}

/** Split for L27: mine on top, then what anyone may take. */
export function splitTasks(
  tasks: readonly Task[],
  userId: string,
): { mine: Task[]; available: Task[] } {
  return {
    mine: tasks.filter((t) => t.ownerId === userId),
    // A claimed task disappears from everyone else's `Available`. Two people
    // doing one putaway is the failure this screen exists to prevent.
    available: tasks.filter((t) => t.ownerId === null),
  };
}

/** Per-operator load, shown while assigning rather than only in a report (K18). */
export function workload(tasks: readonly Task[], userIds: readonly string[]): Map<string, number> {
  const load = new Map<string, number>(userIds.map((id) => [id, 0]));
  for (const task of tasks) {
    if (!task.ownerId) continue;
    load.set(task.ownerId, (load.get(task.ownerId) ?? 0) + 1);
  }
  return load;
}

/**
 * Offline claim conflict: first write to reach the server wins.
 *
 * This is the ONLY automatic conflict resolution in the product, and the
 * distinction matters — what is resolved here is task OWNERSHIP, coordination
 * metadata. Stock balances are never resolved automatically (PRD F14).
 *
 * The loser is told who won, and any work they already recorded is kept and
 * attached for review. Discarding someone's real work because they lost a sync
 * race is the fastest way to lose an operator's trust.
 */
export function resolveClaims(events: readonly AnyEvent[]): Map<string, string> {
  const winner = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'task.claimed' && !winner.has(event.payload.taskId)) {
      winner.set(event.payload.taskId, event.payload.claimedBy);
    }
    if (event.type === 'task.released') winner.delete(event.payload.taskId);
  }
  return winner;
}

export const TASK_ID = taskId;
