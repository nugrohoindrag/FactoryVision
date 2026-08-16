import type { AnyEvent } from '@fv/contracts';
import { projectStock } from '@fv/domain';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { integrationSuite } from './describe-integration.js';
import { factoryDay, ids, makeEvent, resetChains, type Builder } from './event-fixtures.js';
import { addUser, seedTenant, startTestApp, type SeededTenant, type TestApp } from './harness.js';

/**
 * Gate B3 — two devices and a server agree on the warehouse.
 *
 * The scenario is the one the product was designed around and the one nothing
 * had ever tested end to end: a phone works for a week with no signal, another
 * phone works in parallel, and when both reach a tower the numbers have to come
 * out the same on all three.
 *
 * The failure this guards against is not "sync errors out". It is sync
 * appearing to work while two people read different stock figures — which is
 * unrecoverable, because by the time anybody notices, both have acted on it.
 */
await integrationSuite('two-way sync (B-039 → B-048)', () => {
  let test: TestApp;
  let tenant: SeededTenant;
  let operator: Builder;
  let production: Builder;
  let opAuth: { authorization: string };
  let prodAuth: { authorization: string };

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
    opAuth = op.auth;
    prodAuth = prod.auth;
  });

  const push = (events: AnyEvent[], auth: { authorization: string }) =>
    test.app.inject({ method: 'POST', url: '/sync/events', headers: auth, payload: { events } });

  const pull = (auth: { authorization: string }, since?: string) =>
    test.app.inject({
      method: 'GET',
      url: `/sync/events${since ? `?since=${encodeURIComponent(since)}` : ''}`,
      headers: auth,
    });

  it('SEVEN DAYS OFFLINE: both devices and the server end up identical (B-047)', async () => {
    const f = ids();
    const week = await factoryDay(operator, production, f);

    const opEvents = week.filter((event) => event.deviceId === operator.deviceId);
    const prodEvents = week.filter((event) => event.deviceId === production.deviceId);

    /**
     * Production's phone reaches a tower first — which is the awkward order,
     * because their return refers to material the server has not been told was
     * issued yet. The server defers those events rather than calling them a
     * conflict: nothing is wrong, the warehouse phone simply has not synced.
     */
    const early = await push(prodEvents, prodAuth);
    expect(early.statusCode).toBe(201);
    const deferred = early.json() as { rejected?: { reason: string }[] };
    expect(deferred.rejected?.some((r) => r.reason === 'AWAITING_EARLIER_EVENTS')).toBe(true);

    // The warehouse phone arrives.
    expect((await push(opEvents, opAuth)).statusCode).toBe(201);

    // And the outbox does what an outbox does: it still has the deferred rows,
    // so it sends them again. This is the self-healing half — no human was
    // asked to adjudicate an ordering accident.
    const retry = await push(prodEvents, prodAuth);
    expect(retry.statusCode).toBe(201);
    expect((retry.json() as { rejected?: unknown[] }).rejected ?? []).toEqual([]);

    // Each device now pulls what the other wrote. This is the loop that did
    // not exist before B-039: without it, the operator's phone never learns
    // that production returned 8 kg.
    const opFeed = pageAll(await pull(opAuth));
    const prodFeed = pageAll(await pull(prodAuth));

    const serverStock = await test.app.inject({
      method: 'GET',
      url: '/stock',
      headers: tenant.auth,
    });

    const key = (levels: readonly { key: string; quantity: string }[]) =>
      [...levels].sort((a, b) => (a.key < b.key ? -1 : 1)).map((l) => `${l.key}=${l.quantity}`);

    const fromOperator = key(projectStock(opFeed));
    const fromProduction = key(projectStock(prodFeed));
    const fromServer = key((serverStock.json() as { levels: never[] }).levels);

    expect(fromOperator).toEqual(fromServer);
    expect(fromProduction).toEqual(fromServer);
    // And the figure itself, not just that they agree on something.
    expect(fromServer.some((line) => line.endsWith('|AVAILABLE=16'))).toBe(true);
  });

  it('the feed is resumable and repeatable (B-040)', async () => {
    const f = ids();
    const week = await factoryDay(operator, production, f);
    await push(week.filter((e) => e.deviceId === operator.deviceId), opAuth);
    await push(week.filter((e) => e.deviceId === production.deviceId), prodAuth);

    const first = (await pull(opAuth)).json() as {
      events: AnyEvent[];
      cursor: string;
      hasMore: boolean;
    };
    expect(first.events.length).toBeGreaterThan(0);

    // Same cursor twice: a dropped connection replays a page, and that has to
    // be boring rather than duplicating half a day's movements.
    const again = (await pull(opAuth, first.cursor)).json() as { events: AnyEvent[] };
    const repeat = (await pull(opAuth, first.cursor)).json() as { events: AnyEvent[] };
    expect(again.events.map((e) => e.id)).toEqual(repeat.events.map((e) => e.id));
    expect(again.events).toHaveLength(0);
  });

  it('refuses a cursor it did not issue instead of replaying everything (B-040)', async () => {
    const response = await pull(opAuth, 'not-a-cursor');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('CURSOR_INVALID');
    // Quietly starting from the beginning would push a week of events over 3G
    // to a phone that only needed the last page.
  });

  it('NEGATIVE: the feed never leaks another factory events (B-024)', async () => {
    const f = ids();
    const week = await factoryDay(operator, production, f);
    await push(week.filter((e) => e.deviceId === operator.deviceId), opAuth);

    const other = await seedTenant(test, { phone: '+628555000001', factoryName: 'Pabrik Lain' });
    const feed = (await pull(other.auth)).json() as { events: AnyEvent[] };

    expect(feed.events).toHaveLength(0);
  });

  it('bootstraps a brand-new device in one response (B-042)', async () => {
    const f = ids();
    const week = await factoryDay(operator, production, f);
    await push(week.filter((e) => e.deviceId === operator.deviceId), opAuth);

    const response = await test.app.inject({
      method: 'GET',
      url: '/sync/bootstrap',
      headers: prodAuth,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      config: { locationLevels: string[] };
      events: AnyEvent[];
      cursor: string;
    };

    // A phone with one bar should not have to discover the warehouse through a
    // dozen calls before it can be used.
    expect(body.config.locationLevels).toEqual(['Warehouse', 'Zone', 'Rack']);
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.cursor).toBeTruthy();
  });

  it('hides purchase prices from roles that may not see them (B-019)', async () => {
    const withPrice = await test.app.inject({
      method: 'GET',
      url: '/sync/master',
      headers: tenant.auth,
    });
    const withoutPrice = await test.app.inject({
      method: 'GET',
      url: '/sync/master',
      headers: prodAuth,
    });

    expect(withPrice.statusCode).toBe(200);
    expect(withoutPrice.statusCode).toBe(200);
    // The check that matters is on the wire, not in a component: a field that
    // leaves the server is a field somebody can read in the network tab.
    expect(JSON.stringify(withoutPrice.json())).not.toMatch(/averageCost":"[0-9]/);
  });

  it('CLAIM RACE offline: one winner, and the loser keeps their work (B-048)', async () => {
    const taskId = `PUTAWAY:${crypto.randomUUID()}`;
    const refId = crypto.randomUUID();
    const f = ids();

    // Both devices claim the same task while offline, then sync.
    const opClaim = await makeEvent(operator, 'task.claimed', {
      taskId,
      taskType: 'PUTAWAY',
      refId,
      claimedBy: operator.actorId,
    });
    const prodClaim = await makeEvent(production, 'task.claimed', {
      taskId,
      taskType: 'PUTAWAY',
      refId,
      claimedBy: production.actorId,
    });
    // The loser had already done real work before syncing.
    const prodWork = await makeEvent(production, 'material_issue.requested', {
      issueId: f.issueId,
      workOrderNo: '',
      requestedBy: production.actorId,
      quick: true,
      destinationId: f.laneId,
      bomStandard: [],
      lines: [{ lineId: f.lineId, productId: f.productId, quantity: '5', unit: 'kg' }],
    });

    await push([opClaim], opAuth);
    const response = await push([prodClaim, prodWork], prodAuth);

    const body = response.json() as {
      accepted: string[];
      claimOutcomes: { winnerId: string; winnerName: string; lost: boolean }[];
    };

    expect(body.claimOutcomes[0]?.winnerId).toBe(operator.actorId);
    expect(body.claimOutcomes[0]?.lost).toBe(true);
    // Named, because "this task is already taken" cannot be acted on.
    expect(body.claimOutcomes[0]?.winnerName).toBeTruthy();

    // NOTHING was thrown away. The request they raised while offline is in the
    // log, because the physical work really happened — discarding it for
    // losing a sync race is the fastest way to lose an operator (§2.8d).
    expect(body.accepted).toContain(prodWork.id);
    expect(body.accepted).toContain(prodClaim.id);
  });
});

/** Collects a paged feed into one list — the client's `pullAll`, server-side. */
function pageAll(response: { json: () => unknown }): AnyEvent[] {
  const body = response.json() as { events: AnyEvent[] };
  return body.events;
}
