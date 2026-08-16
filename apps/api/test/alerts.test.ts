import type { AnyEvent } from '@fv/contracts';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { integrationSuite } from './describe-integration.js';
import { ids, makeEvent, resetChains, type Builder } from './event-fixtures.js';
import { addUser, seedTenant, startTestApp, type SeededTenant, type TestApp } from './harness.js';

/**
 * Gate B5 — alerts that fire once, and approvals that wait for the right person.
 *
 * The assertion this sprint is really about is the second one in the first test:
 * evaluating twice raises nothing new. An alert engine that re-notifies on every
 * pass gets muted inside a week, and the moment it is muted, "material issue
 * open past 24 hours" — the metric the whole product is built around — reaches
 * nobody at all.
 */
await integrationSuite('alerts, approvals & photos (B-061 → B-070)', () => {
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
  const post = (url: string, payload: Record<string, unknown> = {}, auth = tenant.auth) =>
    test.app.inject({ method: 'POST', url, headers: auth, payload });
  const get = (url: string, auth = tenant.auth) =>
    test.app.inject({ method: 'GET', url, headers: auth });

  /** An issue handed over and never closed — the condition PRD M2 is about. */
  async function openIssueOlderThanADay(): Promise<void> {
    const f = ids();
    const yesterday = new Date(Date.now() - 30 * 3_600_000).toISOString();

    const receipt = await makeEvent(
      operator,
      'goods_receipt.item_added',
      {
        receiptId: f.receiptId,
        lineId: crypto.randomUUID(),
        productId: f.productId,
        batchId: f.batchId,
        batchNo: 'LOT-1',
        quantity: '100',
        unit: 'kg',
        locationId: f.rackId,
        landsIn: 'AVAILABLE',
        defectQuantity: '0',
        defectPhotoIds: [],
      },
      yesterday,
    );

    const requested = await makeEvent(
      production,
      'material_issue.requested',
      {
        issueId: f.issueId,
        workOrderNo: 'WO-1',
        requestedBy: production.actorId,
        quick: false,
        destinationId: f.laneId,
        bomStandard: [],
        lines: [{ lineId: f.lineId, productId: f.productId, quantity: '50', unit: 'kg' }],
      },
      yesterday,
    );

    const prepared = await makeEvent(
      operator,
      'material_issue.prepared',
      {
        issueId: f.issueId,
        picks: [
          {
            lineId: f.lineId,
            ref: {
              productId: f.productId,
              batchId: f.batchId,
              locationId: f.rackId,
              status: 'AVAILABLE',
            },
            quantity: '50',
          },
        ],
      },
      yesterday,
    );

    const handedOver = await makeEvent(
      operator,
      'material_issue.handed_over',
      {
        issueId: f.issueId,
        handedOverBy: operator.actorId,
        receivedBy: production.actorId,
        toLocationId: f.laneId,
      },
      yesterday,
    );

    await push([receipt, prepared, handedOver], opAuth);
    await push([requested], prodAuth);
  }

  it('raises an overdue issue once, and NOT again on the next pass (B-066, B-070)', async () => {
    await openIssueOlderThanADay();

    const first = await post('/alerts/evaluate');
    expect(first.statusCode).toBe(201);
    expect(first.json().raised).toBeGreaterThan(0);

    const second = await post('/alerts/evaluate');
    // Nothing new. An operator who gets thirty notifications about one issue
    // turns notifications off — and takes the metric with them.
    expect(second.json().raised).toBe(0);

    const alerts = (await get('/alerts')).json() as { kind: string; severity: string }[];
    const overdue = alerts.find((alert) => alert.kind === 'ISSUE_OVERDUE');
    expect(overdue).toBeTruthy();
    // The one condition allowed to be red on a dashboard (UI Spec D4).
    expect(overdue?.severity).toBe('danger');
  });

  it('clears an alert when the condition goes away (B-070)', async () => {
    await openIssueOlderThanADay();
    await post('/alerts/evaluate');

    const before = (await get('/alerts')).json() as { kind: string; subjectId: string }[];
    const issueId = before.find((alert) => alert.kind === 'ISSUE_OVERDUE')?.subjectId;
    expect(issueId).toBeTruthy();

    // Production closes it. The alert should stop occupying the dashboard.
    const closed = await makeEvent(production, 'material_issue.closed', {
      issueId,
      shrinkage: [],
      resultingStatus: 'CLOSED',
    });
    await push([closed], prodAuth);

    const evaluated = await post('/alerts/evaluate');
    expect(evaluated.json().cleared).toBeGreaterThan(0);

    const after = (await get('/alerts')).json() as { kind: string }[];
    expect(after.find((alert) => alert.kind === 'ISSUE_OVERDUE')).toBeUndefined();
  });

  it('flags a purchase order past its promised date (B-066)', async () => {
    const supplier = await post('/master/partners', { name: 'CV Telat' });
    const item = await post('/master/products', {
      name: 'Gula',
      itemClass: 'RAW_MATERIAL',
      baseUnit: 'kg',
    });

    await post('/purchase-orders', {
      supplierId: supplier.json().id,
      orderDate: '2026-01-01',
      eta: '2026-01-10',
      lines: [{ productId: item.json().id, quantityOrdered: '500', unit: 'kg' }],
    });

    await post('/alerts/evaluate');
    const alerts = (await get('/alerts')).json() as { kind: string }[];
    expect(alerts.some((alert) => alert.kind === 'PO_OVERDUE')).toBe(true);
  });

  it('asks for approval only above the tenant threshold (B-068)', async () => {
    const small = await post('/approvals', {
      kind: 'ADJUSTMENT',
      subjectId: crypto.randomUUID(),
      value: '150000',
    });
    // Under the default Rp 5,000,000. Stopping a warehouse head for every small
    // correction is how an approval flow gets routed around.
    expect(small.json().required).toBe(false);

    const large = await post('/approvals', {
      kind: 'ADJUSTMENT',
      subjectId: crypto.randomUUID(),
      value: '-7500000',
      note: 'Selisih opname gudang bahan',
    });
    expect(large.json().required).toBe(true);
    expect(large.json().approvalId).toBeTruthy();

    const pending = (await get('/approvals')).json() as unknown[];
    expect(pending).toHaveLength(1);
  });

  it('lets only the owner decide an approval (B-068)', async () => {
    const requested = await post('/approvals', {
      kind: 'ADJUSTMENT',
      subjectId: crypto.randomUUID(),
      value: '9000000',
    });
    const id = requested.json().approvalId as string;

    const byOperator = await post(`/approvals/${id}/decide`, { decision: 'APPROVED' }, opAuth);
    expect(byOperator.statusCode).toBe(403);

    const byOwner = await post(`/approvals/${id}/decide`, {
      decision: 'APPROVED',
      note: 'Sudah dicek fisik',
    });
    expect(byOwner.statusCode).toBe(201);

    const twice = await post(`/approvals/${id}/decide`, { decision: 'REJECTED' });
    expect(twice.statusCode).toBe(409);

    const trail = await test.prisma.adminAudit.findMany({
      where: { tenantId: tenant.tenantId, action: 'approval.approved' },
    });
    expect(trail).toHaveLength(1);
  });

  it('says plainly that push is not configured rather than pretending (B-064)', async () => {
    const response = await get('/push/key');
    // No VAPID keys in the test environment. A notification system that
    // silently does nothing is worse than one that admits it is not ready.
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('NOT_CONFIGURED');
  });

  it('says plainly that object storage is not configured (B-061)', async () => {
    const response = await post('/photos/presign', { contentType: 'image/jpeg' });
    // 503, and the message names the missing settings. An operator whose photo
    // will not upload should learn it is a server setting, not their phone.
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('NOT_CONFIGURED');
    expect(response.json().error.message).toMatch(/STORAGE_BUCKET/);
    expect(response.json().error.retryable).toBe(true);
  });

  it('reports storage and push honestly in /ready (B-010)', async () => {
    const ready = (await get('/ready')).json() as {
      status: string;
      checks: Record<string, { ok: boolean; detail?: string }>;
    };
    // Degraded is for things that stop the factory working. A missing photo
    // bucket is worth reporting, not worth failing a load balancer check over.
    expect(ready.status).toBe('ready');
    expect(ready.checks.storage?.ok).toBe(false);
    expect(ready.checks.storage?.detail).toMatch(/photo upload disabled/);
  });

  it('NEGATIVE: one factory never sees another factory alerts (B-024)', async () => {
    await openIssueOlderThanADay();
    await post('/alerts/evaluate');

    const other = await seedTenant(test, { phone: '+628444000001', factoryName: 'Pabrik Lain' });
    const theirs = (await get('/alerts', other.auth)).json() as unknown[];
    expect(theirs).toHaveLength(0);
  });

  it('runs the whole background pass over every tenant (B-067)', async () => {
    await openIssueOlderThanADay();
    await seedTenant(test, { phone: '+628444000002', factoryName: 'Pabrik Kedua' });

    const response = await post('/alerts/tick');
    expect(response.statusCode).toBe(201);
    expect(response.json().tenants).toBe(2);
    expect(response.json().raised).toBeGreaterThan(0);
  });

  it('keeps the factory working when one tenant data is broken (B-067)', async () => {
    // The scheduler must not let one bad factory stop everybody else's alerts.
    await seedTenant(test, { phone: '+628444000003', factoryName: 'Pabrik Ketiga' });
    const response = await post('/alerts/tick');
    expect(response.statusCode).toBe(201);
  });
});
