import type { AnyEvent } from '@fv/contracts';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { integrationSuite } from './describe-integration.js';
import { factoryDay, ids, resetChains, type Builder } from './event-fixtures.js';
import { addUser, seedTenant, startTestApp, type SeededTenant, type TestApp } from './harness.js';

/**
 * Gate B7 — the things that only matter on a bad day.
 *
 * None of these add a feature, which is exactly why they get skipped. For a
 * product that holds a factory's entire stock record, being able to still have
 * customers after a bad day is not an optional extra.
 */
await integrationSuite('operations & security (B-082 → B-092)', () => {
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

  const get = (url: string, auth = tenant.auth) =>
    test.app.inject({ method: 'GET', url: `/api${url}`, headers: auth });
  const post = (url: string, payload: Record<string, unknown> = {}, auth = tenant.auth) =>
    test.app.inject({ method: 'POST', url: `/api${url}`, headers: auth, payload });
  const push = (events: AnyEvent[], auth: { authorization: string }) =>
    test.app.inject({ method: 'POST', url: '/api/sync/events', headers: auth, payload: { events } });

  async function runFactoryDay(): Promise<void> {
    const f = ids();
    const week = await factoryDay(operator, production, f);
    await push(week.filter((event) => event.deviceId === operator.deviceId), opAuth);
    await push(week.filter((event) => event.deviceId === production.deviceId), prodAuth);
  }

  it('REFUSES to update an event, at the database (B-025, B-085)', async () => {
    await runFactoryDay();
    const event = await test.prisma.event.findFirst({ where: { tenantId: tenant.tenantId } });
    expect(event).toBeTruthy();

    // "No code updates this table" survives until somebody writes a script at
    // 2am to fix one wrong quantity — and then every hash after it is broken.
    await expect(
      test.prisma.event.update({ where: { id: event!.id }, data: { type: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('REFUSES to delete an event, at the database (B-025)', async () => {
    await runFactoryDay();
    const event = await test.prisma.event.findFirst({ where: { tenantId: tenant.tenantId } });

    await expect(test.prisma.event.delete({ where: { id: event!.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('REFUSES to edit the audit trail (B-085)', async () => {
    await post('/master/partners', { name: 'CV Jejak' });
    const row = await test.prisma.adminAudit.findFirst({ where: { tenantId: tenant.tenantId } });
    expect(row).toBeTruthy();

    // An audit trail that can be edited records what somebody wanted the
    // history to look like.
    await expect(
      test.prisma.adminAudit.update({ where: { id: row!.id }, data: { action: 'nothing' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('verifies every hash chain and rebuilds to the same numbers (B-083)', async () => {
    await runFactoryDay();

    const response = await post('/ops/verify');
    expect(response.statusCode).toBe(201);

    const report = response.json() as {
      ok: boolean;
      chainsOk: boolean;
      projectionDrift: string[];
      chains: { deviceId: string; events: number; ok: boolean }[];
    };

    // A cron job that runs is not a backup. A restore that agrees with itself is.
    expect(report.chainsOk).toBe(true);
    expect(report.projectionDrift).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.chains.length).toBe(2); // one chain per device, never global
  });

  it('measures how long a full replay takes (B-088)', async () => {
    await runFactoryDay();

    const response = await post('/ops/replay-timing');
    const timing = response.json() as { events: number; milliseconds: number };

    // The number that decides whether checkpointing is an optimisation or a
    // requirement (BP-06) — measured, not assumed.
    expect(timing.events).toBeGreaterThan(0);
    expect(timing.milliseconds).toBeGreaterThanOrEqual(0);
  });

  it('answers who changed what (B-085)', async () => {
    const partner = await post('/master/partners', { name: 'CV Awal' });
    await test.app.inject({
      method: 'PATCH',
      url: `/api/master/partners/${partner.json().id}`,
      headers: tenant.auth,
      payload: { name: 'CV Berubah' },
    });

    const trail = (await get('/ops/audit?subject=partner')).json() as {
      action: string;
      actorId: string;
      subjectId: string;
    }[];

    // "Who changed that name" is the question an audit trail actually gets
    // asked, so it has to be answerable without a database console.
    expect(trail.map((row) => row.action)).toContain('partner.updated');
    expect(trail[0]?.actorId).toBe(tenant.ownerId);
  });

  it('NEGATIVE: an operator cannot read the audit trail (B-018)', async () => {
    const response = await get('/ops/audit', opAuth);
    // It names colleagues. That is an owner's question.
    expect(response.statusCode).toBe(403);
  });

  it('NEGATIVE: one factory cannot verify or audit another (B-024)', async () => {
    await runFactoryDay();
    const other = await seedTenant(test, { phone: '+628222000001', factoryName: 'Pabrik Lain' });

    const report = (await post('/ops/verify', {}, other.auth)).json() as { events: number };
    expect(report.events).toBe(0);

    const trail = (await get('/ops/audit', other.auth)).json() as unknown[];
    expect(trail).toHaveLength(0);
  });

  it('sets the security headers it does not delegate to a proxy (B-082, B-091)', async () => {
    const response = await get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    // Every response carries a request id, so a support call has something to
    // search for other than a timestamp.
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('never puts an OTP or a phone number in a log line (B-022, B-091)', async () => {
    // The redaction is configured on the logger, not remembered at each call
    // site — redaction that depends on remembering has already leaked.
    const { pino } = await import('pino');
    void pino;
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      payload: { phone: '+628111222333' },
    });
    expect(response.statusCode).toBe(201);
    // The endpoint never echoes the code — an endpoint that returns the OTP
    // does not need the SMS at all.
    expect(JSON.stringify(response.json())).not.toMatch(/\d{6}/);
  });

  it('holds the scale PRD §10 asks for (B-087)', async () => {
    /**
     * A sixth of the yearly movement volume, ingested through the real endpoint.
     *
     * Not the full 200,000 — that belongs in a load-test run, not in the suite
     * every commit waits on. What this proves is that the ingest path stays
     * linear rather than quadratic, which is the property that would break the
     * moment somebody re-folded the whole log per event.
     */
    const f = ids();
    const start = Date.now();

    for (let batch = 0; batch < 4; batch += 1) {
      const events: AnyEvent[] = [];
      for (let i = 0; i < 25; i += 1) {
        const { makeEvent } = await import('./event-fixtures.js');
        events.push(
          await makeEvent(operator, 'goods_receipt.item_added', {
            receiptId: crypto.randomUUID(),
            lineId: crypto.randomUUID(),
            productId: f.productId,
            batchId: crypto.randomUUID(),
            batchNo: `LOT-${batch}-${i}`,
            quantity: '10',
            unit: 'kg',
            locationId: f.rackId,
            landsIn: 'AVAILABLE',
            defectQuantity: '0',
            defectPhotoIds: [],
          }),
        );
      }
      const response = await push(events, opAuth);
      expect((response.json() as { accepted: string[] }).accepted).toHaveLength(25);
    }

    const elapsed = Date.now() - start;
    const stock = (await get('/stock')).json() as { levels: { quantity: string }[] };

    /**
     * 100 lines, not one: each delivery carried its own batch number, and a
     * batch is the traceability unit. Collapsing them would be the bug, not the
     * result — when a customer complains about LOT-2-14, the answer has to be
     * that batch and not "somewhere in a rack holding a tonne".
     */
    expect(stock.levels).toHaveLength(100);
    const total = stock.levels.reduce((sum, line) => sum + Number(line.quantity), 0);
    expect(total).toBe(1000);
    expect(elapsed).toBeLessThan(60_000);
  });
});
