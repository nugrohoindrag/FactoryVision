import type { AnyEvent } from '@fv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendEvent, pendingCount, readLog } from './appendEvent';
import { db } from './schema';
import { drainOutbox } from './sync';
import { applyRemoteEvents, httpTransport, pullAll, pullOnce, readCursor } from './transport';

/**
 * B-043 / B-044 — the transport, and the ways it could quietly lose work.
 *
 * The assertions worth reading here are the ones about what does NOT happen:
 * the outbox is not touched by downstream events, a replayed page does not
 * duplicate anything, and a failed send leaves the queue exactly as it was.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ctx = {
  tenantId: TENANT,
  actorId: '50000000-0000-4000-8000-000000000001',
  actorRole: 'OPERATOR' as const,
};

const receipt = {
  receiptId: '60000000-0000-4000-8000-000000000001',
  supplierId: '30000000-0000-4000-8000-000000000001',
  receivedAt: '2026-08-16T08:00:00.000Z',
  photoIds: [],
};

const remoteEvent = (id: string, deviceId = 'other-device'): AnyEvent =>
  ({
    id,
    tenantId: TENANT,
    type: 'goods_receipt.created',
    occurredAt: '2026-08-16T09:00:00.000Z',
    actorId: '50000000-0000-4000-8000-000000000002',
    actorRole: 'WAREHOUSE_HEAD',
    deviceId,
    prevHash: null,
    hash: `hash-${id}`,
    payload: { ...receipt, receiptId: id },
  }) as unknown as AnyEvent;

const config = (fetchImpl: typeof fetch) => ({
  baseUrl: 'https://api.test',
  token: () => 'token',
  deviceId: 'this-device',
  fetchImpl,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('upstream transport', () => {
  it('sends queued events and clears the outbox on acceptance', async () => {
    const event = await appendEvent(ctx, 'goods_receipt.created', receipt);
    expect(await pendingCount(TENANT)).toBe(1);

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ accepted: [event.id], conflicts: [] }),
    ) as unknown as typeof fetch;

    const outcome = await drainOutbox(TENANT, httpTransport(config(fetchImpl)));

    expect(outcome.sent).toBe(1);
    expect(await pendingCount(TENANT)).toBe(0);
  });

  it('never sends local bookkeeping to the server', async () => {
    await appendEvent(ctx, 'goods_receipt.created', receipt);

    let sent: { events: Record<string, unknown>[] } | null = null;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as { events: Record<string, unknown>[] };
      return jsonResponse({ accepted: [], conflicts: [] });
    }) as unknown as typeof fetch;

    await drainOutbox(TENANT, httpTransport(config(fetchImpl)));

    // `syncedAt` is this device's note to itself. Sending it would invite a
    // server that reads it, and then two systems would own the same flag.
    expect(sent!.events[0]).not.toHaveProperty('syncedAt');
    expect(sent!.events[0]).toHaveProperty('hash');
  });

  it('keeps the row queued when the send fails', async () => {
    await appendEvent(ctx, 'goods_receipt.created', receipt);

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'INTERNAL', message: 'nope', retryable: true } }, 500),
    ) as unknown as typeof fetch;

    const outcome = await drainOutbox(TENANT, httpTransport(config(fetchImpl)));

    expect(outcome.failed).toBe(1);
    // A failed send is not a lost transaction — the whole point of the outbox.
    expect(await pendingCount(TENANT)).toBe(1);
  });
});

describe('downstream transport', () => {
  it('applies events other devices wrote', async () => {
    const applied = await applyRemoteEvents(TENANT, [
      remoteEvent('01a00000-0000-7000-8000-000000000001'),
      remoteEvent('01a00000-0000-7000-8000-000000000002'),
    ]);

    expect(applied).toBe(2);
    expect(await readLog(TENANT)).toHaveLength(2);
  });

  it('is idempotent — a replayed page changes nothing', async () => {
    const page = [remoteEvent('01a00000-0000-7000-8000-000000000003')];
    await applyRemoteEvents(TENANT, page);
    const second = await applyRemoteEvents(TENANT, page);

    expect(second).toBe(0);
    expect(await readLog(TENANT)).toHaveLength(1);
  });

  it('NEVER puts a downstream event in the outbox', async () => {
    await applyRemoteEvents(TENANT, [remoteEvent('01a00000-0000-7000-8000-000000000004')]);

    // Downstream is a different direction and a different table. An event that
    // came FROM the server must never be queued to go back to it.
    expect(await pendingCount(TENANT)).toBe(0);
  });

  it('does not disturb this device own queued work', async () => {
    const mine = await appendEvent(ctx, 'goods_receipt.created', receipt);
    await applyRemoteEvents(TENANT, [remoteEvent('01a00000-0000-7000-8000-000000000005')]);

    expect(await pendingCount(TENANT)).toBe(1);
    const stored = await db.events.get(mine.id);
    // Still unsent, still mine, still exactly as written.
    expect(stored?.syncedAt).toBeNull();
    expect(stored?.hash).toBe(mine.hash);
  });

  it('ignores events belonging to another factory', async () => {
    const foreign = {
      ...remoteEvent('01a00000-0000-7000-8000-000000000006'),
      tenantId: '00000000-0000-4000-8000-000000000099',
    } as AnyEvent;

    expect(await applyRemoteEvents(TENANT, [foreign])).toBe(0);
  });

  it('saves the cursor only after the events are stored', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        events: [remoteEvent('01a00000-0000-7000-8000-000000000007')],
        cursor: '2026-08-16T09:00:00.000Z|01a00000-0000-7000-8000-000000000007',
        hasMore: false,
      }),
    ) as unknown as typeof fetch;

    const result = await pullOnce(config(fetchImpl), TENANT);

    expect(result.applied).toBe(1);
    expect(await readCursor(TENANT)).toBe(result.cursor);
  });

  it('walks every page for a device coming back after a week', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      const id = `01a00000-0000-7000-8000-00000000010${call}`;
      return jsonResponse({
        events: [remoteEvent(id)],
        cursor: `2026-08-16T09:00:0${call}.000Z|${id}`,
        hasMore: call < 3,
      });
    }) as unknown as typeof fetch;

    const applied = await pullAll(config(fetchImpl), TENANT);

    expect(applied).toBe(3);
    expect(await readLog(TENANT)).toHaveLength(3);
  });
});
