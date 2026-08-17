import type { AnyEvent } from '@fv/contracts';
import { projectIssues, projectStock, totalQuantity } from '@fv/domain';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { integrationSuite } from './describe-integration.js';
import { factoryDay, ids, makeEvent, resetChains, type Builder } from './event-fixtures.js';
import { addUser, seedTenant, startTestApp, type SeededTenant, type TestApp } from './harness.js';

/**
 * Gate B2 — three proofs, and none of them is negotiable.
 *
 * 1. **Parity.** The same log gives the same numbers on the device and on the
 *    server, to the last digit. Anything else means two truths about stock.
 * 2. **Idempotency.** The same batch sent three times produces one receipt.
 * 3. **No negative lines.** The receive → issue → handover → return → close
 *    chain leaves nothing below zero at any location.
 *
 * Proof 3 has already caught a real bug once (Tech Stack §2.8b): a closing that
 * subtracted from the rack the goods were picked from while the handover had
 * moved them to the production line. In a per-status total the two cancelled
 * out, so it was invisible until somebody looked per location and saw −92 kg on
 * a rack. With lanes there is more room to get that wrong, not less.
 */
await integrationSuite('event ingest & projection (B-025 → B-038)', () => {
  let test: TestApp;
  let tenant: SeededTenant;
  let operator: Builder;
  let production: Builder;

  beforeAll(async () => {
    test = await startTestApp();
  });
  afterAll(async () => {
    await test.close();
  });

  beforeEach(async () => {
    await test.reset();
    resetChains();
    tenant = await seedTenant(test);
    const op = await addUser(test, tenant, 'OPERATOR');
    const prod = await addUser(test, tenant, 'PRODUCTION');
    operator = {
      deviceId: op.deviceId,
      actorId: op.userId,
      actorRole: 'OPERATOR',
      tenantId: tenant.tenantId,
    };
    production = {
      deviceId: prod.deviceId,
      actorId: prod.userId,
      actorRole: 'PRODUCTION',
      tenantId: tenant.tenantId,
    };
    // Both devices belong to their own user, so each writes its own chain —
    // the normal shape of a factory with thirty people, not an edge case.
    (operator as Builder & { auth: unknown }).auth = op.auth;
    (production as Builder & { auth: unknown }).auth = prod.auth;
    opAuth = op.auth;
    prodAuth = prod.auth;
  });

  let opAuth: { authorization: string };
  let prodAuth: { authorization: string };

  /**
   * Fails loudly on an unexpected rejection instead of letting the assertion
   * three lines later report a stock figure and leave the reason in a log
   * nobody reads.
   */
  const push = async (
    events: AnyEvent[],
    auth: { authorization: string },
    expectClean = true,
  ) => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/sync/events',
      headers: auth,
      payload: { events },
    });
    const body = response.json() as { rejected?: unknown[] };
    if (expectClean && body.rejected?.length) {
      throw new Error(`unexpected rejection: ${JSON.stringify(body.rejected)}`);
    }
    return response;
  };

  it('PARITY: the server computes exactly what the device computes (B-038)', async () => {
    const f = ids();
    const events = await factoryDay(operator, production, f);

    // The device's answer, from the same pure functions the screens use.
    const clientStock = projectStock(events);
    const clientIssues = projectIssues(events);

    const opEvents = events.filter((e) => e.deviceId === operator.deviceId);
    const prodEvents = events.filter((e) => e.deviceId === production.deviceId);

    expect((await push(opEvents, opAuth)).statusCode).toBe(201);
    expect((await push(prodEvents, prodAuth)).statusCode).toBe(201);

    const serverStock = await test.app.inject({
      method: 'GET',
      url: '/api/stock',
      headers: tenant.auth,
    });
    expect(serverStock.statusCode).toBe(200);

    const server = serverStock.json() as { levels: typeof clientStock };

    const normalise = (levels: readonly { key: string; quantity: string }[]) =>
      [...levels].sort((a, b) => (a.key < b.key ? -1 : 1)).map((l) => `${l.key}=${l.quantity}`);

    expect(normalise(server.levels)).toEqual(normalise(clientStock));

    // And the number the whole product exists for: 90 issued − 8 returned −
    // 0.5 spilled = 81.5 consumed (PRD M2).
    const balance = clientIssues.get(f.issueId);
    expect(balance?.lines[0]?.consumed).toBe('81.5');
    expect(balance?.status).toBe('CLOSED');

    const serverIssues = await test.app.inject({
      method: 'GET',
      url: '/api/issues',
      headers: tenant.auth,
    });
    const rows = serverIssues.json() as { issueId: string; lines: { consumed: string }[] }[];
    expect(rows.find((r) => r.issueId === f.issueId)?.lines[0]?.consumed).toBe('81.5');
  });

  it('IDEMPOTENT: the same batch three times makes one receipt (B-026)', async () => {
    const f = ids();
    const events = await factoryDay(operator, production, f);
    const opEvents = events.filter((e) => e.deviceId === operator.deviceId);

    const first = await push(opEvents, opAuth);
    const second = await push(opEvents, opAuth);
    const third = await push(opEvents, opAuth);

    for (const response of [first, second, third]) {
      expect(response.statusCode).toBe(201);
      // Already-known ids come back ACCEPTED, so the client's outbox row goes.
      // Rejecting them would leave the phone retrying work already done.
      expect((response.json() as { accepted: string[] }).accepted).toHaveLength(opEvents.length);
    }

    const stored = await test.prisma.event.count({ where: { tenantId: tenant.tenantId } });
    expect(stored).toBe(opEvents.length);
  });

  it('NO NEGATIVE LINES anywhere in the chain (Gate B2)', async () => {
    const f = ids();
    const events = await factoryDay(operator, production, f);
    await push(events.filter((e) => e.deviceId === operator.deviceId), opAuth);
    await push(events.filter((e) => e.deviceId === production.deviceId), prodAuth);

    const response = await test.app.inject({ method: 'GET', url: '/api/stock', headers: tenant.auth });
    const { levels } = response.json() as { levels: { quantity: string; locationId: string }[] };

    const negative = levels.filter((line) => line.quantity.startsWith('-'));
    expect(negative).toEqual([]);

    // The rack got 98 in, 90 out, 8 back = 16. The lane got 90, returned 8,
    // consumed 81.5, spilled 0.5 = 0 and therefore disappears.
    const rack = totalQuantity(levels as never, { locationId: f.rackId, status: 'AVAILABLE' });
    expect(rack).toBe('16');
  });

  it('rejects an event whose hash does not match itself (B-027)', async () => {
    const f = ids();
    const [created] = await factoryDay(operator, production, f);
    const tampered = {
      ...created!,
      payload: { ...(created!.payload as object), deliveryNoteNo: 'SJ-999' },
    };

    const response = await push([tampered as AnyEvent], opAuth, false);
    const body = response.json() as { accepted: string[]; rejected: { reason: string }[] };

    expect(body.accepted).toEqual([]);
    expect(body.rejected[0]?.reason).toBe('HASH_CHAIN_BROKEN');
  });

  it('rejects an event that chains onto something the server never saw (B-027)', async () => {
    const f = ids();
    const events = await factoryDay(operator, production, f);
    // Skip the first event: the second one now points at a hash the server has
    // no record of. That is a gap, and the client must be told which link.
    const response = await push([events[1]!], opAuth, false);
    const body = response.json() as { rejected: { reason: string; message: string }[] };

    expect(body.rejected[0]?.reason).toBe('HASH_CHAIN_BROKEN');
    expect(body.rejected[0]?.message).toMatch(/never seen|send it first/);
  });

  it('rejects an event the role may not write (B-018 on the log)', async () => {
    const impostor: Builder = { ...production, actorRole: 'PRODUCTION' };
    const event = await makeEvent(impostor, 'stock_take.approved', {
      sessionId: crypto.randomUUID(),
      approvedBy: production.actorId,
      adjustments: [],
    });

    const response = await push([event], prodAuth, false);
    const body = response.json() as { rejected: { reason: string }[] };
    // Approving a count posts adjustments. It stops at the owner, and the check
    // is on the ACTION, so it holds however the event got here.
    expect(body.rejected[0]?.reason).toBe('ROLE_NOT_PERMITTED');
  });

  it('CONFLICT: closing an issue that is already closed (B-029)', async () => {
    const f = ids();
    const events = await factoryDay(operator, production, f);
    await push(events.filter((e) => e.deviceId === operator.deviceId), opAuth);
    await push(events.filter((e) => e.deviceId === production.deviceId), prodAuth);

    const secondClose = await makeEvent(production, 'material_issue.closed', {
      issueId: f.issueId,
      shrinkage: [{ lineId: f.lineId, quantity: '2', reason: 'DAMAGED', photoIds: [] }],
      resultingStatus: 'CLOSED',
    });

    const response = await push([secondClose], prodAuth);
    const body = response.json() as {
      accepted: string[];
      conflicts: { eventId: string; serverVersion: unknown }[];
    };

    expect(body.accepted).toEqual([]);
    expect(body.conflicts[0]?.eventId).toBe(secondClose.id);
    // Both versions kept whole for L04 — nothing merged, nothing overwritten.
    expect(body.conflicts[0]?.serverVersion).toBeTruthy();

    const queue = await test.app.inject({
      method: 'GET',
      url: '/api/sync/conflicts',
      headers: tenant.auth,
    });
    expect((queue.json() as unknown[]).length).toBe(1);
  });

  it('CONFLICT: a movement that would push a location below zero (B-029)', async () => {
    const f = ids();
    const events = await factoryDay(operator, production, f);
    await push(events.filter((e) => e.deviceId === operator.deviceId), opAuth);

    // An adjustment is warehouse-head work: an operator writing one would be
    // correcting the stock they are also counting (PRD F9).
    const head = await addUser(test, tenant, 'WAREHOUSE_HEAD');
    const headBuilder: Builder = {
      deviceId: head.deviceId,
      actorId: head.userId,
      actorRole: 'WAREHOUSE_HEAD',
      tenantId: tenant.tenantId,
    };

    // 8 kg is left on the rack after the pick; write off 500.
    const overdraw = await makeEvent(headBuilder, 'stock.adjusted', {
      ref: { productId: f.productId, batchId: f.batchId, locationId: f.rackId, status: 'AVAILABLE' },
      delta: '-500',
      reasonCode: 'Miscount',
    });

    const response = await push([overdraw], head.auth);
    const body = response.json() as { conflicts: { serverVersion: unknown }[] };

    expect(body.conflicts).toHaveLength(1);
    expect(JSON.stringify(body.conflicts[0]?.serverVersion)).toMatch(/-/);

    // The event never entered the log, so the projection is untouched.
    const stock = await test.app.inject({ method: 'GET', url: '/api/stock', headers: tenant.auth });
    const { levels } = stock.json() as { levels: { quantity: string }[] };
    expect(levels.every((line) => !line.quantity.startsWith('-'))).toBe(true);
  });

  it('NOT a conflict: two devices receiving against the same PO (B-029)', async () => {
    const f = ids();
    const second = ids();

    const secondOperator = await addUser(test, tenant, 'OPERATOR');
    const other: Builder = {
      deviceId: secondOperator.deviceId,
      actorId: secondOperator.userId,
      actorRole: 'OPERATOR',
      tenantId: tenant.tenantId,
    };

    const line = (batchId: string, batchNo: string, quantity: string) => ({
      receiptId: crypto.randomUUID(),
      lineId: crypto.randomUUID(),
      productId: f.productId,
      batchId,
      batchNo,
      quantity,
      unit: 'kg',
      locationId: f.rackId,
      landsIn: 'AVAILABLE',
      purchaseOrderId: f.poId,
      purchaseOrderLineId: f.poLineId,
      defectQuantity: '0',
      defectPhotoIds: [],
    });

    const a = await makeEvent(operator, 'goods_receipt.item_added', line(f.batchId, 'LOT-A', '40'));
    const b = await makeEvent(other, 'goods_receipt.item_added', line(second.batchId, 'LOT-B', '60'));

    await push([a], opAuth);
    const response = await push([b], secondOperator.auth);
    const body = response.json() as { accepted: string[]; conflicts: unknown[] };

    // Two deliveries against one PO really both happened. The outstanding
    // quantity is simply recomputed — nothing here needs a human to decide.
    expect(body.conflicts).toEqual([]);
    expect(body.accepted).toEqual([b.id]);
  });

  it('CLAIM RACE: first to the server wins, and the loser is told who (B-030)', async () => {
    const taskId = `PUTAWAY:${crypto.randomUUID()}`;
    const refId = crypto.randomUUID();

    const firstClaim = await makeEvent(operator, 'task.claimed', {
      taskId,
      taskType: 'PUTAWAY',
      refId,
      claimedBy: operator.actorId,
    });
    const secondClaim = await makeEvent(production, 'task.claimed', {
      taskId,
      taskType: 'PUTAWAY',
      refId,
      claimedBy: production.actorId,
    });

    await push([firstClaim], opAuth);
    const response = await push([secondClaim], prodAuth);

    const body = response.json() as {
      accepted: string[];
      claimOutcomes: { taskId: string; winnerId: string; winnerName: string; lost: boolean }[];
    };

    // The losing claim is still ACCEPTED into the log. The physical work may
    // already have happened, and discarding it because of a sync race is the
    // fastest way to lose an operator's trust (Tech Stack §2.8d).
    expect(body.accepted).toContain(secondClaim.id);

    const outcome = body.claimOutcomes.find((o) => o.taskId === taskId);
    expect(outcome?.winnerId).toBe(operator.actorId);
    expect(outcome?.lost).toBe(true);
    // "Already taken" with no name cannot be acted on. The name is the point.
    expect(outcome?.winnerName).toBeTruthy();
  });

  it('refuses a batch bigger than the client is supposed to send (B-046)', async () => {
    const oversized = Array.from({ length: 51 }, () => ({}));
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/sync/events',
      headers: opAuth,
      payload: { events: oversized },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('BATCH_TOO_LARGE');
  });

  it('NEGATIVE: a device cannot push events for another factory (B-024)', async () => {
    const other = await seedTenant(test, { phone: '+628777000001', factoryName: 'Pabrik Lain' });
    const f = ids();

    const foreign = await makeEvent(
      { ...operator, tenantId: other.tenantId },
      'goods_receipt.created',
      {
        receiptId: f.receiptId,
        supplierId: f.supplierId,
        receivedAt: new Date().toISOString(),
        photoIds: [],
      },
    );

    const response = await push([foreign], opAuth, false);
    const body = response.json() as { rejected: { reason: string }[] };
    expect(body.rejected[0]?.reason).toBe('TENANT_MISMATCH');

    const leaked = await test.prisma.event.count({ where: { tenantId: other.tenantId } });
    expect(leaked).toBe(0);
  });

  it('rebuilds the projection from the log and gets the same answer (B-032)', async () => {
    const f = ids();
    const events = await factoryDay(operator, production, f);
    await push(events.filter((e) => e.deviceId === operator.deviceId), opAuth);
    await push(events.filter((e) => e.deviceId === production.deviceId), prodAuth);

    const before = await test.app.inject({ method: 'GET', url: '/api/stock', headers: tenant.auth });

    const rebuilt = await test.app.inject({
      method: 'POST',
      url: '/api/stock/rebuild',
      headers: tenant.auth,
    });
    expect(rebuilt.statusCode).toBe(201);

    const after = await test.app.inject({ method: 'GET', url: '/api/stock', headers: tenant.auth });

    // The materialised table is a cache and nothing more. If dropping it
    // changed an answer, one of the two was lying about the warehouse.
    expect(after.json()).toEqual(before.json());
  });
});
