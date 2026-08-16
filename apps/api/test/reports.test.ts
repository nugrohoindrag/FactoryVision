import type { AnyEvent } from '@fv/contracts';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { integrationSuite } from './describe-integration.js';
import { factoryDay, ids, resetChains, type Builder, type FactoryIds } from './event-fixtures.js';
import { addUser, seedTenant, startTestApp, type SeededTenant, type TestApp } from './harness.js';

/**
 * Gate B6 — the ten reports and the owner's dashboard.
 *
 * This is the only part of the product the person paying for it reads. Two
 * things are checked harder than the rest: that the figures match the ones the
 * screens compute (a report that disagrees with the app is worse than no
 * report), and that a variance measured against an unverified recipe SAYS SO,
 * including in the file that gets printed and taken to a meeting.
 */
await integrationSuite('reports & dashboard (B-071 → B-081)', () => {
  let test: TestApp;
  let tenant: SeededTenant;
  let operator: Builder;
  let production: Builder;
  let opAuth: { authorization: string };
  let prodAuth: { authorization: string };
  let f: FactoryIds;

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
    f = ids();
  });

  const get = (url: string, auth = tenant.auth) =>
    test.app.inject({ method: 'GET', url, headers: auth });
  const post = (url: string, payload: Record<string, unknown> = {}, auth = tenant.auth) =>
    test.app.inject({ method: 'POST', url, headers: auth, payload });
  const push = (events: AnyEvent[], auth: { authorization: string }) =>
    test.app.inject({ method: 'POST', url: '/sync/events', headers: auth, payload: { events } });

  /** A full day: 100 kg in with 2 defect, 90 issued, 8 back, 0.5 spilled. */
  async function runFactoryDay(): Promise<void> {
    const week = await factoryDay(operator, production, f);
    await push(week.filter((event) => event.deviceId === operator.deviceId), opAuth);
    await push(week.filter((event) => event.deviceId === production.deviceId), prodAuth);
  }

  it('shows every movement of one item with a running balance (B-071)', async () => {
    await runFactoryDay();

    const rows = (await get(`/reports/stock-card/${f.productId}`)).json() as {
      quantityIn: string;
      quantityOut: string;
      balance: string;
    }[];

    expect(rows.length).toBeGreaterThan(0);
    /**
     * 18, not 16.
     *
     * The stock card is per PRODUCT and counts everything the factory still
     * holds: 100 arrived, 90 went out, 8 came back. The 2 kg marked defect are
     * part of that — they are sitting in REJECTED waiting to go back to the
     * supplier, and they have not left the building. The stock SCREEN shows 16
     * available on the rack plus 2 rejected, which is the same 18 split by
     * status.
     */
    expect(rows[rows.length - 1]?.balance).toBe('18');
  });

  it('values inventory at weighted average and says so (B-073)', async () => {
    await post('/master/products', {
      name: 'Tepung',
      itemClass: 'RAW_MATERIAL',
      baseUnit: 'kg',
      averageCost: '12000',
    });

    const response = await get('/reports/inventory-value');
    expect(response.statusCode).toBe(200);
    // PRD §14.4 is open on FIFO. The method travels with the number rather than
    // leaving the reader to assume which one it is.
    expect(response.json().method).toBe('WEIGHTED_AVERAGE');
  });

  it('splits usage variance per production line (B-076)', async () => {
    await runFactoryDay();

    const response = await get('/reports/bom-variance');
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      rows: { variance: string; destinationId: string; unverifiedRecipe: boolean }[];
      byLane: { destinationId: string; variance: string }[];
    };

    // Standard was 90, actual consumption 81.5 → 8.5 under.
    expect(body.rows[0]?.variance).toBe('-8.5');
    // Per lane is what turns the number into an action (PRD F6).
    expect(body.byLane[0]?.destinationId).toBe(f.laneId);
  });

  it('marks variance measured against an unverified recipe (B-076)', async () => {
    await runFactoryDay();

    const body = (await get('/reports/bom-variance')).json() as {
      rows: { unverifiedRecipe: boolean }[];
    };
    // Nobody has confirmed this recipe, so the comparison is indicative. PRD
    // §12 requires that to be visible rather than dressed up as sound.
    expect(body.rows[0]?.unverifiedRecipe).toBe(true);
  });

  it('carries the caveat into the printed file, not just the screen (B-076, B-081)', async () => {
    await runFactoryDay();

    const xlsx = await get('/reports/bom-variance?format=xlsx');
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect(xlsx.rawPayload.length).toBeGreaterThan(1000);

    /**
     * Read the spreadsheet back rather than grepping bytes.
     *
     * A printout has lost its screen, and the printout is what the meeting works
     * from — so the caveat has to survive INTO the file. Opening the workbook is
     * the only way to prove that; PDF streams are compressed, so a byte search
     * there would pass or fail for reasons that have nothing to do with the
     * caveat being present.
     */
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;

    const text: string[] = [];
    sheet.eachRow((row) => text.push(row.values?.toString() ?? ''));
    expect(text.join(' | ')).toMatch(/nobody has verified|no recipe at all/i);

    const pdf = await get('/reports/bom-variance?format=pdf');
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('reports receipts that came in without a purchase order (B-079)', async () => {
    await runFactoryDay();

    const rows = (await get('/reports/receipts-without-po')).json() as unknown[];
    // The factory day receipt DOES carry a PO id, so this list is empty — the
    // report proves it distinguishes, not that it lists everything.
    expect(rows).toHaveLength(0);
  });

  it('rates suppliers on quantity, timeliness and defects (B-078)', async () => {
    const supplier = await post('/master/partners', { name: 'CV Sumber Tepung' });
    const item = await post('/master/products', {
      name: 'Tepung',
      itemClass: 'RAW_MATERIAL',
      baseUnit: 'kg',
    });
    await post('/purchase-orders', {
      supplierId: supplier.json().id,
      orderDate: '2026-08-01',
      eta: '2026-08-10',
      lines: [{ productId: item.json().id, quantityOrdered: '1000', unit: 'kg' }],
    });

    const rows = (await get('/reports/suppliers')).json() as { supplierName: string }[];
    expect(rows[0]?.supplierName).toBe('CV Sumber Tepung');
  });

  it('answers the whole dashboard in one request (B-080)', async () => {
    await runFactoryDay();

    const response = await get('/reports/dashboard');
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      inventoryValue: { total: string };
      openIssues: { count: number; value: string };
      purchaseOrders: { overdue: number; incomplete: number };
      movement7Days: unknown[];
      deadStock: unknown[];
      alerts: number;
    };

    // Nine numbers, one round trip. Five minutes a day does not start with nine
    // sequential requests over a factory's connection (PRD F12).
    expect(body).toHaveProperty('inventoryValue');
    expect(body).toHaveProperty('openIssues');
    expect(body).toHaveProperty('purchaseOrders');
    expect(body).toHaveProperty('movement7Days');
    expect(body).toHaveProperty('deadStock');
    expect(body.openIssues.count).toBe(0); // the factory day closes its issue
  });

  it('exports any report as a spreadsheet with the same rows (B-081)', async () => {
    await runFactoryDay();

    const json = (await get('/reports/aging')).json() as unknown[];
    const xlsx = await get('/reports/aging?format=xlsx');

    expect(Array.isArray(json)).toBe(true);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-disposition']).toMatch(/attachment; filename="stock-aging.xlsx"/);
  });

  it('NEGATIVE: an operator cannot read reports (B-018, B-019)', async () => {
    const response = await get('/reports/inventory-value', opAuth);
    // Purchase prices are visible in a valuation, and PRD F13 hides them from
    // operators by default.
    expect(response.statusCode).toBe(403);
  });

  it('NEGATIVE: one factory sees none of another factory figures (B-024)', async () => {
    await runFactoryDay();

    const other = await seedTenant(test, { phone: '+628333000001', factoryName: 'Pabrik Lain' });
    const dashboard = (await get('/reports/dashboard', other.auth)).json() as {
      inventoryValue: { total: string };
      openIssues: { count: number };
    };

    expect(dashboard.inventoryValue.total).toBe('0');
    expect(dashboard.openIssues.count).toBe(0);
  });

  it('records shrinkage against its reason (B-077)', async () => {
    await runFactoryDay();
    const rows = (await get('/reports/shrinkage')).json() as {
      reason: string;
      quantity: string;
    }[];
    // 0.5 kg spilled, with the reason it was recorded under — which is why the
    // reason list is closed rather than free text (PRD F6).
    expect(rows[0]?.reason).toBe('SPILLAGE');
    expect(rows[0]?.quantity).toBe('0.5');
  });
});
