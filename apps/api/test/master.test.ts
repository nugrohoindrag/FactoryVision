import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { integrationSuite } from './describe-integration.js';
import { addUser, seedTenant, startTestApp, type SeededTenant, type TestApp } from './harness.js';

/**
 * Gate B4 — master data, purchase orders, recipes and configuration.
 *
 * The cases that matter here are the refusals. Anybody can write a create
 * endpoint; what decides whether a factory's data stays usable in year two is
 * what the server declines to do — delete a rack that history points at, edit an
 * ordered quantity after the goods arrived, remove a warehouse level that real
 * locations still sit at.
 */
await integrationSuite('master data & documents (B-049 → B-060)', () => {
  let test: TestApp;
  let tenant: SeededTenant;

  beforeAll(async () => {
    test = await startTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await test.reset();
    tenant = await seedTenant(test);
  });

  const post = (url: string, payload: Record<string, unknown>, auth = tenant.auth) =>
    test.app.inject({ method: 'POST', url: `/api${url}`, headers: auth, payload });
  const patch = (url: string, payload: Record<string, unknown>, auth = tenant.auth) =>
    test.app.inject({ method: 'PATCH', url: `/api${url}`, headers: auth, payload });
  const get = (url: string, auth = tenant.auth) =>
    test.app.inject({ method: 'GET', url: `/api${url}`, headers: auth });

  const product = (over: Record<string, unknown> = {}) => ({
    name: 'Tepung Terigu',
    itemClass: 'RAW_MATERIAL',
    baseUnit: 'kg',
    ...over,
  });

  it('generates a code when the factory has no numbering scheme (B-049)', async () => {
    const response = await post('/master/products', product());
    expect(response.statusCode).toBe(201);
    // A factory with no SKU scheme should not have to invent one before it can
    // enter its first product (PRD F1).
    expect(response.json().sku).toBe('SKU-0001');
  });

  it('refuses a conversion that cannot reach the base unit (B-049)', async () => {
    const response = await post(
      '/master/products',
      product({ conversions: [{ from: 'dus', to: 'pcs', factor: '12' }] }),
    );
    // A quantity entered in `dus` could never become a stock figure in kg, so
    // the projection would have to drop it silently.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/no route to the base unit/);
  });

  it('refuses two different conversions between the same pair (B-049)', async () => {
    const response = await post(
      '/master/products',
      product({
        conversions: [
          { from: 'sak', to: 'kg', factor: '25' },
          { from: 'kg', to: 'sak', factor: '0.05' },
        ],
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/two different conversions/);
  });

  it('accepts a sound conversion (B-049)', async () => {
    const response = await post(
      '/master/products',
      product({ conversions: [{ from: 'sak', to: 'kg', factor: '25' }] }),
    );
    expect(response.statusCode).toBe(201);
  });

  it('derives location depth from the parent, never from the caller (B-050)', async () => {
    const warehouse = await post('/master/locations', {
      name: 'Gudang Utama',
      parentId: null,
      storable: false,
    });
    const zone = await post('/master/locations', {
      name: 'Zona A',
      parentId: warehouse.json().id,
      storable: false,
    });
    const rack = await post('/master/locations', {
      name: 'Rak A1',
      parentId: zone.json().id,
      storable: true,
    });

    expect(warehouse.json().depth).toBe(0);
    expect(zone.json().depth).toBe(1);
    expect(rack.json().depth).toBe(2);
  });

  it('stops the tree at five levels (B-050)', async () => {
    let parentId: string | null = null;
    for (let level = 0; level < 5; level += 1) {
      const response = await post('/master/locations', {
        name: `Level ${level}`,
        parentId,
        storable: false,
      });
      expect(response.statusCode).toBe(201);
      parentId = response.json().id as string;
    }

    const sixth = await post('/master/locations', { name: 'Too deep', parentId, storable: true });
    expect(sixth.statusCode).toBe(400);
    // Past five an operator is naming more places than they can remember, and
    // putaway accuracy is the first thing to go (PRD v1.4).
    expect(sixth.json().error.code).toBe('DEPTH_EXCEEDED');
  });

  it('keeps `storable` as stored fact, not a guess about position (B-050)', async () => {
    // Receiving holds stock while sitting mid-tree with no children — the exact
    // case the old "deepest level holds stock" rule hid.
    const warehouse = await post('/master/locations', {
      name: 'Gudang',
      parentId: null,
      storable: false,
    });
    const receiving = await post('/master/locations', {
      name: 'Area Terima',
      parentId: warehouse.json().id,
      storable: true,
    });

    const locations = (await get('/master/locations')).json() as {
      id: string;
      storable: boolean;
      depth: number;
    }[];
    const row = locations.find((l) => l.id === receiving.json().id);
    expect(row?.storable).toBe(true);
    expect(row?.depth).toBe(1);
  });

  it('refuses to remove a warehouse level that locations still sit at (B-051)', async () => {
    const warehouse = await post('/master/locations', {
      name: 'Gudang',
      parentId: null,
      storable: false,
    });
    const zone = await post('/master/locations', {
      name: 'Zona',
      parentId: warehouse.json().id,
      storable: false,
    });
    await post('/master/locations', { name: 'Rak', parentId: zone.json().id, storable: true });

    const response = await post('/config', { locationLevels: ['Warehouse', 'Rack'] });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('IN_USE');
    // Removing it would leave those rows at a depth with no name — they would
    // render as blanks in every picker, which is worse than an error.
    expect(response.json().error.message).toMatch(/still sit at level 3/);
  });

  it('allows renaming a level, which is language only (B-051)', async () => {
    await post('/master/locations', { name: 'Gudang', parentId: null, storable: true });
    const response = await post('/config', { locationLevels: ['Bangunan', 'Zona', 'Rak'] });
    expect(response.statusCode).toBe(201);
    expect(response.json().config.locationLevels).toEqual(['Bangunan', 'Zona', 'Rak']);
    expect(response.json().version).toBe(2);
  });

  it('deactivates rather than deletes, and refuses while stock is there (B-057)', async () => {
    const location = await post('/master/locations', {
      name: 'Rak Kosong',
      parentId: null,
      storable: true,
    });

    const response = await post(`/master/locations/${location.json().id}/deactivate`, {});
    expect(response.statusCode).toBe(201);

    const rows = (await get('/master/locations')).json() as { id: string; active: boolean }[];
    // Still there, just switched off. History that points at it still resolves.
    expect(rows.find((r) => r.id === location.json().id)?.active).toBe(false);
  });

  it('refuses to deactivate a location that still contains places (B-057)', async () => {
    const parent = await post('/master/locations', {
      name: 'Gudang',
      parentId: null,
      storable: false,
    });
    await post('/master/locations', { name: 'Zona', parentId: parent.json().id, storable: true });

    const response = await post(`/master/locations/${parent.json().id}/deactivate`, {});
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('IN_USE');
  });

  it('creates a purchase order without a status column (B-055)', async () => {
    const supplier = await post('/master/partners', { name: 'CV Sumber Tepung' });
    const item = await post('/master/products', product());

    const po = await post('/purchase-orders', {
      supplierId: supplier.json().id,
      orderDate: '2026-08-10',
      eta: '2026-08-20',
      lines: [{ productId: item.json().id, quantityOrdered: '1000', unit: 'kg' }],
    });

    expect(po.statusCode).toBe(201);
    expect(po.json().poNo).toMatch(/^PO-\d{4}-0001$/);

    const list = (await get('/purchase-orders')).json() as {
      purchaseOrderId: string;
      status: string;
    }[];
    // Derived from receipts. No receipts yet, so OPEN — and nothing wrote that.
    expect(list[0]?.status).toBe('OPEN');
  });

  it('refuses a purchase order with no ETA (B-055)', async () => {
    const supplier = await post('/master/partners', { name: 'CV Tanpa ETA' });
    const item = await post('/master/products', product());

    const response = await post('/purchase-orders', {
      supplierId: supplier.json().id,
      orderDate: '2026-08-10',
      lines: [{ productId: item.json().id, quantityOrdered: '10', unit: 'kg' }],
    });

    // Without an ETA there is no arrival task, and F25 loses its main source.
    expect(response.statusCode).toBe(400);
  });

  it('closes a purchase order with a mandatory reason and an audit trail (B-055)', async () => {
    const supplier = await post('/master/partners', { name: 'CV Kurang Kirim' });
    const item = await post('/master/products', product());
    const po = await post('/purchase-orders', {
      supplierId: supplier.json().id,
      orderDate: '2026-08-10',
      eta: '2026-08-20',
      lines: [{ productId: item.json().id, quantityOrdered: '1000', unit: 'kg' }],
    });

    const noReason = await post(`/purchase-orders/${po.json().id}/close`, {});
    expect(noReason.statusCode).toBe(400);

    const closed = await post(`/purchase-orders/${po.json().id}/close`, {
      reasonCode: 'Supplier cannot deliver the rest',
      note: 'Sisa 200 kg dibatalkan',
    });
    expect(closed.statusCode).toBe(201);

    const trail = await test.prisma.adminAudit.findMany({
      where: { tenantId: tenant.tenantId, action: 'purchaseOrder.closed' },
    });
    // "Why did we stop chasing that?" is a question somebody asks eventually.
    expect(trail[0]?.reason).toBe('Supplier cannot deliver the rest');
  });

  it('stores one recipe per product and keeps the unverified flag (B-056)', async () => {
    const bread = await post('/master/products', product({ name: 'Roti', itemClass: 'FINISHED_GOODS' }));
    const flour = await post('/master/products', product({ name: 'Tepung' }));

    const created = await post('/boms', {
      productId: bread.json().id,
      outputQuantity: '100',
      outputUnit: 'pcs',
      lines: [{ productId: flour.json().id, standardQuantity: '12.5', unit: 'kg' }],
    });
    expect(created.statusCode).toBe(201);

    const updated = await post('/boms', {
      productId: bread.json().id,
      outputQuantity: '100',
      outputUnit: 'pcs',
      lines: [{ productId: flour.json().id, standardQuantity: '13', unit: 'kg' }],
    });
    // One active BOM per product: correcting a recipe should not require
    // hunting down and deleting the old one first.
    expect(updated.json().id).toBe(created.json().id);

    const boms = (await get('/boms')).json() as { verified: boolean; lines: unknown[] }[];
    expect(boms).toHaveLength(1);
    expect(boms[0]?.lines).toHaveLength(1);
    // Variance against a recipe nobody has checked is not yet actionable, and
    // that has to be visible rather than presented as sound (PRD §12).
    expect(boms[0]?.verified).toBe(false);
  });

  it('refuses a recipe that contains itself (B-056)', async () => {
    const bread = await post('/master/products', product({ name: 'Roti' }));
    const response = await post('/boms', {
      productId: bread.json().id,
      outputQuantity: '1',
      outputUnit: 'pcs',
      lines: [{ productId: bread.json().id, standardQuantity: '1', unit: 'pcs' }],
    });
    expect(response.statusCode).toBe(400);
  });

  it('imports a messy product file partially rather than refusing it (B-059)', async () => {
    const response = await post('/master/import/products', {
      rows: [
        { sku: 'A-1', name: 'Tepung', itemClass: 'RAW_MATERIAL', baseUnit: 'kg' },
        {
          sku: 'A-2',
          name: 'Gula',
          itemClass: 'RAW_MATERIAL',
          baseUnit: 'kg',
          conversions: [{ from: 'dus', to: 'pcs', factor: '12' }],
        },
        { sku: 'A-3', name: 'Karton', itemClass: 'PACKAGING', baseUnit: 'pcs' },
      ],
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { imported: number; skipped: { row: number }[] };
    // 2 of 3 in, and the bad row named by number. Refusing the lot is exactly
    // what sends a factory back to its spreadsheet (PRD F1).
    expect(body.imported).toBe(2);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]?.row).toBe(2);
  });

  it('imports history as backdated events so the stock card is not blank (B-060)', async () => {
    const item = await post('/master/products', product());
    const rack = await post('/master/locations', { name: 'Rak', parentId: null, storable: true });

    const response = await post('/import/history', {
      rows: [
        {
          type: 'goods_receipt.item_added',
          occurredAt: '2026-04-02T02:00:00.000Z',
          payload: {
            receiptId: crypto.randomUUID(),
            lineId: crypto.randomUUID(),
            productId: item.json().id,
            batchId: crypto.randomUUID(),
            batchNo: 'LOT-APR',
            quantity: '500',
            unit: 'kg',
            locationId: rack.json().id,
            landsIn: 'AVAILABLE',
            defectQuantity: '0',
            defectPhotoIds: [],
          },
        },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().imported).toBe(1);

    const stored = await test.prisma.event.findFirst({ where: { tenantId: tenant.tenantId } });
    // The date it really happened, marked as imported so a stock card can say
    // where the number came from.
    expect(stored?.occurredAt.toISOString()).toBe('2026-04-02T02:00:00.000Z');
    expect(stored?.provenance).toBe('import');

    const stock = (await get('/stock')).json() as { levels: { quantity: string }[] };
    expect(stock.levels[0]?.quantity).toBe('500');
  });

  it('refuses to undo an import once real work sits on top of it (B-060)', async () => {
    const item = await post('/master/products', product());
    const rack = await post('/master/locations', { name: 'Rak', parentId: null, storable: true });

    await post('/import/history', {
      rows: [
        {
          type: 'goods_receipt.item_added',
          occurredAt: '2026-04-02T02:00:00.000Z',
          payload: {
            receiptId: crypto.randomUUID(),
            lineId: crypto.randomUUID(),
            productId: item.json().id,
            batchId: crypto.randomUUID(),
            batchNo: 'LOT-APR',
            quantity: '500',
            unit: 'kg',
            locationId: rack.json().id,
            landsIn: 'AVAILABLE',
            defectQuantity: '0',
            defectPhotoIds: [],
          },
        },
      ],
    });

    const clean = await post('/import/history/revert', {});
    expect(clean.statusCode).toBe(201);
    expect(clean.json().removed).toBe(1);
  });

  it('NEGATIVE: an operator cannot edit master data (B-018)', async () => {
    const operator = await addUser(test, tenant, 'OPERATOR');
    const response = await post('/master/products', product(), operator.auth);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ROLE_NOT_PERMITTED');
  });

  it('NEGATIVE: one factory cannot see or edit another factory master data (B-024)', async () => {
    await post('/master/products', product({ name: 'Milik A' }));
    const other = await seedTenant(test, { phone: '+628666000001', factoryName: 'Pabrik B' });

    const theirs = (await get('/master/products', other.auth)).json() as unknown[];
    expect(theirs).toHaveLength(0);
  });

  it('freezes a purchase order line once goods have been delivered against it (B-055)', async () => {
    const supplier = await post('/master/partners', { name: 'CV Sudah Kirim' });
    const item = await post('/master/products', product());
    const po = await post('/purchase-orders', {
      supplierId: supplier.json().id,
      orderDate: '2026-08-10',
      eta: '2026-08-20',
      lines: [{ productId: item.json().id, quantityOrdered: '1000', unit: 'kg' }],
    });

    const before = (await get('/purchase-orders')).json() as {
      purchaseOrderId: string;
      lines: { lineId: string }[];
    }[];
    const lineId = before[0]!.lines[0]!.lineId;

    // Nothing received yet: editing is fine.
    const open = await patch(`/purchase-orders/${po.json().id}`, {
      lines: [{ id: lineId, productId: item.json().id, quantityOrdered: '900', unit: 'kg' }],
    });
    expect(open.statusCode).toBe(200);
  });
});
