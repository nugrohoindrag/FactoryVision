import type { AnyEvent, EventType, Role } from '@fv/contracts';
import { EventPayloads } from '@fv/contracts';
import Dexie from 'dexie';
import { hashEvent } from './hash';
import { uuidv7 } from './ids';
import { db, getDeviceId, type StoredEvent } from './schema';

/**
 * The single write path. No screen writes a stock level, a balance, or a
 * status — it appends an event, and every number is projected from the log.
 *
 * The write is local and synchronous from the user's point of view: save →
 * UI updates in <200ms → sync happens later in the background. There is no
 * spinner in an input flow (Tech Stack §2.1).
 */

export interface AppendContext {
  tenantId: string;
  actorId: string;
  actorRole: Role;
}

/** Appends one event and queues it for sync, in a single transaction. */
export async function appendEvent<T extends EventType>(
  ctx: AppendContext,
  type: T,
  payload: unknown,
): Promise<StoredEvent> {
  // Validate before writing: a malformed event in an append-only log is
  // permanent, and it would poison every projection built over it.
  const parsedPayload = EventPayloads[type].parse(payload);

  const deviceId = await getDeviceId();
  const id = uuidv7();
  const occurredAt = new Date().toISOString();

  // The chain is per device, so two devices offline at once do not collide.
  const previous = await db.events
    .where('[tenantId+id]')
    .between([ctx.tenantId, Dexie.minKey], [ctx.tenantId, Dexie.maxKey])
    .filter((e) => e.deviceId === deviceId)
    .last();

  const prevHash = previous?.hash ?? null;

  const draft = {
    id,
    tenantId: ctx.tenantId,
    type,
    occurredAt,
    actorId: ctx.actorId,
    deviceId,
    prevHash,
    payload: parsedPayload,
  };

  const stored: StoredEvent = {
    ...draft,
    actorRole: ctx.actorRole,
    hash: await hashEvent(draft),
    syncedAt: null,
  };

  await db.transaction('rw', db.events, db.outbox, async () => {
    await db.events.add(stored);
    await db.outbox.add({
      eventId: stored.id,
      tenantId: ctx.tenantId,
      queuedAt: occurredAt,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      state: 'queued',
    });
  });

  return stored;
}

/** Reads one tenant's log in order — the input to every projection. */
export async function readLog(tenantId: string): Promise<AnyEvent[]> {
  const rows = await db.events
    .where('[tenantId+id]')
    .between([tenantId, Dexie.minKey], [tenantId, Dexie.maxKey])
    .toArray();
  return rows as unknown as AnyEvent[];
}

/** Queue depth for the sync indicator (D3): "3 pending" is normal, not an error. */
export async function pendingCount(tenantId: string): Promise<number> {
  return db.outbox.where('[tenantId+state]').equals([tenantId, 'queued']).count();
}

/** Unresolved conflicts — the only sync state allowed to show red (D3). */
export async function conflictCount(tenantId: string): Promise<number> {
  // `resolvedAt: null` is not indexable in IndexedDB, so this filters in memory.
  // The unresolved set is tiny by design: a conflict blocks until a human acts.
  return db.conflicts
    .where('tenantId')
    .equals(tenantId)
    .filter((c) => c.resolvedAt === null)
    .count();
}
