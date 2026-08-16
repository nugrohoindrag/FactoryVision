import type { AnyEvent } from '@fv/contracts';
import { db, type StoredEvent } from './schema';
import type { IngestResult, SyncTransport } from './sync';

/**
 * B-043 / B-044 — the real transport, replacing `noopTransport`.
 *
 * Sync has two directions and they are not symmetrical.
 *
 * **Up** is the outbox: events this device wrote, already treated as done by
 * the operator who wrote them. Nothing here can fail in a way that loses them —
 * a failed send leaves the row queued, and that is the whole contract.
 *
 * **Down** is what everybody else wrote. This closes the hole the offline-first
 * design left open: PRD §10 allows thirty users in one factory, and until now
 * the warehouse head could create a purchase order at the office desk that the
 * operator's phone would never hear about. The truck would arrive against a PO
 * the receiving screen could not show.
 *
 * ## Why events come down, and not stock figures
 *
 * A downstream stock figure would disagree with the transactions still sitting
 * in this device's outbox, and the operator would watch numbers move for no
 * reason they can see. Events do not have that problem: applying somebody
 * else's event is an append to the same log, the projection is deterministic,
 * and both devices land on the same number without anything being overwritten.
 * PRD F14's rule — never overwrite a stock balance silently — is kept because
 * nothing is overwritten at all.
 */

export interface TransportConfig {
  baseUrl: string;
  /** Called per request so a refreshed token is picked up without a reload. */
  token: () => string | null;
  deviceId: string;
  fetchImpl?: typeof fetch;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Should the outbox keep the row and try again? */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function request<T>(
  config: TransportConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const doFetch = config.fetchImpl ?? fetch;
  const token = config.token();

  const response = await doFetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-device-id': config.deviceId,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; retryable?: boolean } }
      | null;
    throw new SyncHttpError(
      response.status,
      body?.error?.message ?? `Sync failed (${response.status})`,
      // The server says whether trying again can work. Guessing from the status
      // alone would either retry a permanently invalid event forever or drop
      // one that would have gone through on the next tower.
      body?.error?.retryable ?? response.status >= 500,
    );
  }

  return (await response.json()) as T;
}

/** The upstream half — what `drainOutbox` calls. */
export function httpTransport(config: TransportConfig): SyncTransport {
  return async (events: StoredEvent[]): Promise<IngestResult> => {
    const result = await request<IngestResult & { rejected?: { eventId: string }[] }>(
      config,
      '/sync/events',
      {
        method: 'POST',
        body: JSON.stringify({
          // `syncedAt` is local bookkeeping and never leaves the device.
          events: events.map(({ syncedAt: _syncedAt, ...event }) => event),
        }),
      },
    );

    /**
     * A REJECTED event is not a conflict and not a success.
     *
     * It is an event the server will never accept — a broken hash chain, a role
     * that may not write it. Reporting it as accepted would delete the outbox
     * row and lose the operator's work silently; reporting it as a conflict
     * would put it in front of the warehouse head, who cannot do anything
     * about a hash. So it stays queued and visible, and the attempt counter in
     * `drainOutbox` eventually stops the retries without dropping anything.
     */
    return { accepted: result.accepted, conflicts: result.conflicts };
  };
}

export interface PullResult {
  applied: number;
  cursor: string | null;
  hasMore: boolean;
}

const CURSOR_KEY = (tenantId: string) => `sync:cursor:${tenantId}`;

export async function readCursor(tenantId: string): Promise<string | null> {
  const row = await db.meta.get(CURSOR_KEY(tenantId));
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * B-044 — applies what other devices wrote.
 *
 * Three properties this has to hold, and each one is a way it could lose work:
 *
 * 1. **Idempotent.** The same event arriving twice is stored once. Cursors get
 *    replayed after a dropped connection; that must be boring.
 * 2. **It never touches the outbox.** Downstream is a different direction and a
 *    different table. Marking a local row as sent because a remote event
 *    happened to arrive is how a transaction disappears with no trace — the
 *    exact failure PRD §10 says must never be silent.
 * 3. **It never rewrites an event this device wrote.** Our own events come back
 *    down the feed after the server accepts them; they are already in the log,
 *    hash and all, so they are skipped rather than re-saved.
 */
export async function applyRemoteEvents(
  tenantId: string,
  events: readonly AnyEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const ids = events.map((event) => event.id);
  const existing = new Set(
    (await db.events.bulkGet(ids)).filter(Boolean).map((event) => event!.id),
  );

  const fresh = events
    .filter((event) => !existing.has(event.id) && event.tenantId === tenantId)
    .map(
      (event): StoredEvent => ({
        id: event.id,
        tenantId: event.tenantId,
        type: event.type,
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        actorRole: event.actorRole,
        deviceId: event.deviceId,
        prevHash: event.prevHash,
        hash: event.hash,
        payload: event.payload,
        // Came FROM the server, so it is by definition already synced. It must
        // not enter the outbox and be sent back.
        syncedAt: new Date().toISOString(),
      }),
    );

  if (fresh.length === 0) return 0;

  await db.transaction('rw', db.events, async () => {
    await db.events.bulkPut(fresh);
  });

  return fresh.length;
}

/** Pulls one page and applies it. Returns whether there is more to fetch. */
export async function pullOnce(
  config: TransportConfig,
  tenantId: string,
): Promise<PullResult> {
  const since = await readCursor(tenantId);
  const query = since ? `?since=${encodeURIComponent(since)}` : '';

  const page = await request<{ events: AnyEvent[]; cursor: string | null; hasMore: boolean }>(
    config,
    `/sync/events${query}`,
  );

  const applied = await applyRemoteEvents(tenantId, page.events);

  if (page.cursor) {
    // Written only after the events are stored. A cursor saved first would skip
    // a page permanently if the write failed in between — and the movements in
    // that page would never appear on this device again.
    await db.meta.put({ key: CURSOR_KEY(tenantId), value: page.cursor });
  }

  return { applied, cursor: page.cursor, hasMore: page.hasMore };
}

/** Drains the whole downstream backlog — a device returning after a week. */
export async function pullAll(
  config: TransportConfig,
  tenantId: string,
  maxPages = 50,
): Promise<number> {
  let applied = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await pullOnce(config, tenantId);
    applied += result.applied;
    if (!result.hasMore) break;
  }
  return applied;
}
