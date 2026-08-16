import { beforeEach, describe, expect, it } from 'vitest';
import { appendEvent, pendingCount, readLog } from './appendEvent';
import { hashEvent, verifyChain } from './hash';
import { isUuidV7, timestampOf, uuidv7 } from './ids';
import { db } from './schema';

const ctx = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  actorId: '50000000-0000-4000-8000-000000000001',
  actorRole: 'OPERATOR' as const,
};

const receiptPayload = {
  receiptId: '60000000-0000-4000-8000-000000000001',
  supplierId: '30000000-0000-4000-8000-000000000001',
  receivedAt: '2026-08-16T08:00:00.000Z',
  photoIds: [],
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('uuidv7', () => {
  it('is time-ordered, so the log replays in creation order', () => {
    const early = uuidv7(1_755_000_000_000);
    const late = uuidv7(1_755_000_001_000);
    expect(early < late).toBe(true);
  });

  it('carries its timestamp and is well formed', () => {
    // Ahead of the timestamps the previous case pinned. The generator refuses
    // to emit an id that sorts before one it has already handed out (a phone
    // whose clock is corrected must not start writing events "before" the ones
    // already in its log), so asking for a past millisecond legitimately
    // returns a clamped one.
    const at = 1_755_000_002_000;
    const id = uuidv7(at);
    expect(timestampOf(id)).toBe(at);
    expect(isUuidV7(id)).toBe(true);
  });

  it('is strictly increasing inside one millisecond', () => {
    // Two events in the same millisecond used to come out in random order,
    // which let a projection apply a handover before the pick it hands over.
    const ids = Array.from({ length: 500 }, () => uuidv7(1_755_000_003_000));
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('event hash chain', () => {
  const base = {
    id: 'a',
    tenantId: ctx.tenantId,
    type: 'goods_receipt.created',
    occurredAt: '2026-08-16T08:00:00.000Z',
    actorId: ctx.actorId,
    deviceId: 'device-1',
    prevHash: null,
    payload: receiptPayload,
  };

  it('is stable regardless of key order', async () => {
    const { photoIds, ...rest } = receiptPayload;
    const reordered = { ...base, payload: { photoIds, ...rest } };
    expect(await hashEvent(base)).toBe(await hashEvent(reordered));
  });

  it('changes when any field changes', async () => {
    const tampered = { ...base, payload: { ...receiptPayload, supplierId: 'someone-else' } };
    expect(await hashEvent(base)).not.toBe(await hashEvent(tampered));
  });

  it('detects a break in the chain', async () => {
    const first = { ...base, id: 'a' };
    const firstHash = await hashEvent(first);
    const second = { ...base, id: 'b', prevHash: firstHash };
    const orphan = { ...base, id: 'c', prevHash: 'not-the-previous-hash' };

    expect(await verifyChain([first, second])).toEqual({ ok: true });
    expect(await verifyChain([first, orphan])).toMatchObject({ ok: false, reason: 'chain-broken' });
  });
});

describe('appendEvent', () => {
  it('writes the event and queues it for sync in one transaction', async () => {
    const stored = await appendEvent(ctx, 'goods_receipt.created', receiptPayload);

    expect(stored.syncedAt).toBeNull();
    expect(await db.events.count()).toBe(1);
    expect(await pendingCount(ctx.tenantId)).toBe(1);
  });

  it('chains each event to the previous one on the same device', async () => {
    const first = await appendEvent(ctx, 'goods_receipt.created', receiptPayload);
    const second = await appendEvent(ctx, 'goods_receipt.created', {
      ...receiptPayload,
      receiptId: '60000000-0000-4000-8000-000000000002',
    });

    expect(first.prevHash).toBeNull();
    expect(second.prevHash).toBe(first.hash);
  });

  it('refuses a malformed payload instead of poisoning the log', async () => {
    await expect(
      appendEvent(ctx, 'goods_receipt.created', { receiptId: 'not-a-uuid' }),
    ).rejects.toThrow();
    expect(await db.events.count()).toBe(0);
  });

  it('keeps tenants apart', async () => {
    await appendEvent(ctx, 'goods_receipt.created', receiptPayload);
    await appendEvent(
      { ...ctx, tenantId: '00000000-0000-4000-8000-000000000002' },
      'goods_receipt.created',
      receiptPayload,
    );

    expect(await readLog(ctx.tenantId)).toHaveLength(1);
    expect(await pendingCount(ctx.tenantId)).toBe(1);
  });
});
