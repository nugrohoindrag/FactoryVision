import { db, type ConflictEntry, type OutboxEntry, type StoredEvent } from './schema';
import { uuidv7 } from './ids';

/**
 * Outbox drain — the client half of sync (T-045, PRD F14).
 *
 * The contract with the server is deliberately small:
 *
 * 1. **The client only ever appends.** It sends events; it never asks the
 *    server what the stock level is. Stock is projected locally from the log,
 *    so a device that has not synced for a week is still correct about its own
 *    warehouse (Tech Stack §2.1).
 * 2. **Ingest is idempotent by `eventId`.** Retrying a send that actually
 *    succeeded but whose response was lost must not create a second receipt.
 *    On a 3G connection in a metal-roofed warehouse, that is not an edge case.
 * 3. **A conflict is never resolved silently.** The server returns the
 *    conflicting version, both are stored whole, and the event stops being
 *    retried until a human decides (L04). PRD F14 forbids overwriting a stock
 *    balance quietly — that is how trust is lost permanently.
 *
 * The backend does not exist yet (Tech Stack §1.3). `transport` is the seam:
 * until NestJS is built, `noopTransport` keeps everything queued locally,
 * which is exactly what an offline warehouse looks like anyway.
 */

export interface IngestResult {
  /** Events the server accepted, by id. Accepting an already-known id is fine. */
  accepted: string[];
  /** Events the server refuses because its own version disagrees. */
  conflicts: { eventId: string; serverVersion: unknown }[];
}

export type SyncTransport = (events: StoredEvent[]) => Promise<IngestResult>;

/** Until the backend exists, nothing leaves the device. */
export const noopTransport: SyncTransport = async () => ({ accepted: [], conflicts: [] });

const BATCH_SIZE = 50;
/** Attempts before a row is left alone; it stays queued, it is not dropped. */
const MAX_ATTEMPTS = 8;

export interface SyncOutcome {
  sent: number;
  conflicted: number;
  failed: number;
  skipped: boolean;
}

export async function drainOutbox(
  tenantId: string,
  transport: SyncTransport = noopTransport,
): Promise<SyncOutcome> {
  if (!navigator.onLine) return { sent: 0, conflicted: 0, failed: 0, skipped: true };

  const queued = await db.outbox
    .where('[tenantId+state]')
    .equals([tenantId, 'queued'])
    .limit(BATCH_SIZE)
    .toArray();

  const sendable = queued.filter((entry) => entry.attempts < MAX_ATTEMPTS);
  if (sendable.length === 0) return { sent: 0, conflicted: 0, failed: 0, skipped: false };

  const events = (await db.events.bulkGet(sendable.map((e) => e.eventId))).filter(
    (event): event is StoredEvent => Boolean(event),
  );

  await markSending(sendable);

  try {
    const result = await transport(events);
    return await applyResult(tenantId, sendable, result);
  } catch (error) {
    // A failed send is not a lost transaction. The row goes back to `queued`
    // with the attempt counted, and the operator sees it as pending.
    await requeue(sendable, error instanceof Error ? error.message : 'send failed');
    return { sent: 0, conflicted: 0, failed: sendable.length, skipped: false };
  }
}

async function markSending(entries: OutboxEntry[]) {
  await db.transaction('rw', db.outbox, async () => {
    for (const entry of entries) {
      await db.outbox.update(entry.eventId, {
        state: 'sending',
        lastAttemptAt: new Date().toISOString(),
      });
    }
  });
}

async function requeue(entries: OutboxEntry[], error: string) {
  await db.transaction('rw', db.outbox, async () => {
    for (const entry of entries) {
      await db.outbox.update(entry.eventId, {
        state: 'queued',
        attempts: entry.attempts + 1,
        lastError: error,
      });
    }
  });
}

async function applyResult(
  tenantId: string,
  entries: OutboxEntry[],
  result: IngestResult,
): Promise<SyncOutcome> {
  const accepted = new Set(result.accepted);
  const conflicts = new Map(result.conflicts.map((c) => [c.eventId, c.serverVersion]));
  const now = new Date().toISOString();

  await db.transaction('rw', db.outbox, db.events, db.conflicts, async () => {
    for (const entry of entries) {
      if (accepted.has(entry.eventId)) {
        // Sent and acknowledged: the outbox row goes, the event stays forever.
        await db.outbox.delete(entry.eventId);
        await db.events.update(entry.eventId, { syncedAt: now });
        continue;
      }

      if (conflicts.has(entry.eventId)) {
        const local = await db.events.get(entry.eventId);
        const conflict: ConflictEntry = {
          id: uuidv7(),
          tenantId,
          eventId: entry.eventId,
          detectedAt: now,
          // Both versions kept whole — L04 shows them side by side.
          localVersion: local ?? null,
          serverVersion: conflicts.get(entry.eventId) ?? null,
          resolvedAt: null,
          resolution: null,
        };
        await db.conflicts.add(conflict);
        // Blocked, not retried: this one is waiting on a person now.
        await db.outbox.update(entry.eventId, { state: 'blocked' });
        continue;
      }

      await db.outbox.update(entry.eventId, {
        state: 'queued',
        attempts: entry.attempts + 1,
      });
    }
  });

  return {
    sent: result.accepted.length,
    conflicted: result.conflicts.length,
    failed: entries.length - result.accepted.length - result.conflicts.length,
    skipped: false,
  };
}

/**
 * Resolving a conflict (L04).
 *
 * `keep-local` re-queues the event unchanged — the operator is asserting that
 * what happened on the floor is what happened. `keep-server` drops it from the
 * outbox but keeps the event in the local log, because the log is a record of
 * what this device did, not a record of what won.
 */
export async function resolveConflict(
  conflictId: string,
  resolution: 'keep-local' | 'keep-server',
): Promise<void> {
  const conflict = await db.conflicts.get(conflictId);
  if (!conflict) return;

  await db.transaction('rw', db.conflicts, db.outbox, async () => {
    await db.conflicts.update(conflictId, {
      resolvedAt: new Date().toISOString(),
      resolution,
    });

    if (resolution === 'keep-local') {
      await db.outbox.update(conflict.eventId, { state: 'queued', attempts: 0, lastError: null });
    } else {
      await db.outbox.delete(conflict.eventId);
    }
  });
}
