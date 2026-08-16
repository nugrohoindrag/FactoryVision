import type {
  Batch,
  Bom,
  Location,
  Partner,
  ProductionLocation,
  Product,
  PurchaseOrder,
} from '@fv/contracts';
import { db } from './schema';

/**
 * One sample factory, filled in (T-016).
 *
 * A small food factory: raw materials by weight with real shelf lives, one
 * finished good, a couple of racks and a virtual `In Production` location.
 * Enough to exercise FEFO, unit conversion and the issue chain without
 * pretending the data is tidy.
 *
 * Development only. It seeds master data, never events — transactions come
 * from the screens, so the log stays a truthful record of what was done.
 */

export const DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000001';

const p = (id: string, over: Partial<Product> & Pick<Product, 'sku' | 'name' | 'itemClass' | 'baseUnit'>): Product => ({
  id,
  tenantId: DEMO_TENANT_ID as Product['tenantId'],
  conversions: [],
  active: true,
  ...over,
});

export const DEMO_PRODUCTS: Product[] = [
  p('10000000-0000-4000-8000-000000000001', {
    sku: 'RM-TPG-01',
    name: 'Wheat flour',
    itemClass: 'RAW_MATERIAL',
    baseUnit: 'kg',
    conversions: [{ from: 'sak', to: 'kg', factor: '25' }],
    shelfLifeDays: 180,
    minimumStock: '500',
    averageCost: '9500',
  }),
  p('10000000-0000-4000-8000-000000000002', {
    sku: 'RM-GLA-01',
    name: 'Refined sugar',
    itemClass: 'RAW_MATERIAL',
    baseUnit: 'kg',
    conversions: [{ from: 'sak', to: 'kg', factor: '50' }],
    shelfLifeDays: 365,
    minimumStock: '300',
    averageCost: '14000',
  }),
  p('10000000-0000-4000-8000-000000000003', {
    sku: 'PKG-PLA-01',
    name: 'Plastic wrapper 12cm',
    itemClass: 'PACKAGING',
    baseUnit: 'm',
    conversions: [{ from: 'roll', to: 'm', factor: '500' }],
    minimumStock: '2000',
    averageCost: '850',
  }),
  p('10000000-0000-4000-8000-000000000004', {
    sku: 'AUX-VAN-01',
    name: 'Vanilla essence',
    itemClass: 'AUXILIARY',
    baseUnit: 'l',
    shelfLifeDays: 730,
    minimumStock: '5',
    averageCost: '125000',
  }),
  p('10000000-0000-4000-8000-000000000005', {
    sku: 'FG-BIS-01',
    name: 'Butter biscuit 200g',
    itemClass: 'FINISHED_GOODS',
    baseUnit: 'pcs',
    conversions: [{ from: 'box', to: 'pcs', factor: '24' }],
    shelfLifeDays: 270,
    averageCost: '11500',
  }),
];

const loc = (
  id: string,
  code: string,
  name: string,
  depth: number,
  parentId: string | null = null,
  { storable = false, virtual = false }: { storable?: boolean; virtual?: boolean } = {},
): Location => ({
  id,
  tenantId: DEMO_TENANT_ID as Location['tenantId'],
  code,
  name,
  parentId,
  depth,
  storable,
  virtual,
  active: true,
});

const WH = '20000000-0000-4000-8000-000000000001';
const ZONE_A = '20000000-0000-4000-8000-000000000002';

/**
 * Three depths, matching the `locationLevels` default — but note that receiving,
 * quarantine and reject are `storable` ZONES with nothing under them. That is
 * the case a fixed `Warehouse → Zone → Rack` model could not express: a place
 * that sits at depth 1 and still holds stock directly.
 */
export const DEMO_LOCATIONS: Location[] = [
  loc(WH, 'WH-01', 'Main warehouse', 0),
  loc(ZONE_A, 'Z-A', 'Zone A — dry goods', 1, WH),
  loc('20000000-0000-4000-8000-000000000003', 'A-01', 'Rack A-01', 2, ZONE_A, { storable: true }),
  loc('20000000-0000-4000-8000-000000000004', 'A-02', 'Rack A-02', 2, ZONE_A, { storable: true }),
  loc('20000000-0000-4000-8000-000000000005', 'RCV', 'Receiving area', 1, WH, { storable: true }),
  loc('20000000-0000-4000-8000-000000000006', 'QRT', 'Quarantine', 1, WH, { storable: true }),
  // Not a place you can walk to, but stock legitimately sits there (PRD §14.3).
  loc('20000000-0000-4000-8000-000000000007', 'PROD', 'In Production', 0, null, {
    storable: true,
    virtual: true,
  }),
  loc('20000000-0000-4000-8000-000000000008', 'RJT', 'Reject area', 1, WH, { storable: true }),
];

export const DEMO_PARTNERS: Partner[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    tenantId: DEMO_TENANT_ID as Partner['tenantId'],
    code: 'SUP-01',
    name: 'CV Sumber Tepung',
    kind: 'SUPPLIER',
    phone: '081200000001',
    active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    tenantId: DEMO_TENANT_ID as Partner['tenantId'],
    code: 'SUP-02',
    name: 'PT Manis Jaya',
    kind: 'SUPPLIER',
    active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    tenantId: DEMO_TENANT_ID as Partner['tenantId'],
    code: 'CUS-01',
    name: 'Toko Berkah Distribusi',
    kind: 'CUSTOMER',
    active: true,
  },
];

/** Two flour batches with different expiries, so FEFO has something to decide. */
export const DEMO_BATCHES: Batch[] = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    tenantId: DEMO_TENANT_ID as Batch['tenantId'],
    productId: DEMO_PRODUCTS[0]!.id,
    batchNo: 'TPG-2608A',
    producedOn: '2026-06-01',
    expiryDate: '2026-11-28',
    supplierId: DEMO_PARTNERS[0]!.id,
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    tenantId: DEMO_TENANT_ID as Batch['tenantId'],
    productId: DEMO_PRODUCTS[0]!.id,
    batchNo: 'TPG-2608B',
    producedOn: '2026-07-15',
    expiryDate: '2027-01-11',
    supplierId: DEMO_PARTNERS[0]!.id,
  },
  {
    id: '40000000-0000-4000-8000-000000000003',
    tenantId: DEMO_TENANT_ID as Batch['tenantId'],
    productId: DEMO_PRODUCTS[1]!.id,
    batchNo: 'GLA-2607',
    expiryDate: '2027-07-01',
    supplierId: DEMO_PARTNERS[1]!.id,
  },
];

/* --- added with PRD v1.3 ------------------------------------------------ */

const pl = (
  id: string,
  code: string,
  name: string,
  level: ProductionLocation['level'],
  parentId: string | null = null,
): ProductionLocation => ({
  id,
  tenantId: DEMO_TENANT_ID as ProductionLocation['tenantId'],
  code,
  name,
  parentId,
  level,
  active: true,
});

const LINE_1 = '80000000-0000-4000-8000-000000000001';
const LINE_2 = '80000000-0000-4000-8000-000000000002';

/**
 * Two lines, so per-lane variance has something to compare. A factory with one
 * line would never reveal the bug where every issue lands in the same bucket.
 */
export const DEMO_PRODUCTION_LOCATIONS: ProductionLocation[] = [
  pl(LINE_1, 'L1', 'Line 1 — mixing', 'LINE'),
  pl('80000000-0000-4000-8000-000000000003', 'L1-MX', 'Mixer 1', 'MACHINE', LINE_1),
  pl('80000000-0000-4000-8000-000000000004', 'L1-OV', 'Oven 1', 'MACHINE', LINE_1),
  pl(LINE_2, 'L2', 'Line 2 — packing', 'LINE'),
  pl('80000000-0000-4000-8000-000000000005', 'L2-PK', 'Packing area', 'AREA', LINE_2),
];

/**
 * One recipe on a PER-BATCH basis (`1000 pcs`), which is the case that would
 * have been impossible if `outputQuantity` had been left out — most factories
 * think in batches, not in pieces.
 *
 * Deliberately `verified: false`: an unverified recipe is the normal state on
 * day one, and K12 has to show that rather than imply the standard is sound.
 */
export const DEMO_BOMS: Bom[] = [
  {
    id: '60000000-0000-4000-8000-000000000001',
    tenantId: DEMO_TENANT_ID as Bom['tenantId'],
    productId: DEMO_PRODUCTS[4]!.id, // Butter biscuit 200g
    outputQuantity: '1000',
    outputUnit: 'pcs',
    verified: false,
    lines: [
      {
        id: '61000000-0000-4000-8000-000000000001',
        productId: DEMO_PRODUCTS[0]!.id,
        standardQuantity: '120',
        unit: 'kg',
        standardShrinkagePct: '2',
      },
      {
        id: '61000000-0000-4000-8000-000000000002',
        productId: DEMO_PRODUCTS[1]!.id,
        standardQuantity: '45',
        unit: 'kg',
      },
      {
        id: '61000000-0000-4000-8000-000000000003',
        productId: DEMO_PRODUCTS[3]!.id,
        standardQuantity: '1.5',
        unit: 'l',
      },
      {
        id: '61000000-0000-4000-8000-000000000004',
        productId: DEMO_PRODUCTS[2]!.id,
        standardQuantity: '210',
        unit: 'm',
      },
    ],
  },
];

/**
 * Three POs covering the three states worth seeing on day one: one arriving
 * today, one already overdue, and one that will land part-received once a
 * defect is marked against it.
 */
export const DEMO_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: '70000000-0000-4000-8000-000000000001',
    tenantId: DEMO_TENANT_ID as PurchaseOrder['tenantId'],
    poNo: 'PO-1042',
    supplierId: DEMO_PARTNERS[0]!.id,
    orderDate: '2026-08-10',
    eta: '2026-08-16',
    cancelled: false,
    lines: [
      {
        id: '71000000-0000-4000-8000-000000000001',
        productId: DEMO_PRODUCTS[0]!.id,
        quantityOrdered: '500',
        unit: 'kg',
        unitPrice: '9500',
      },
      {
        id: '71000000-0000-4000-8000-000000000002',
        productId: DEMO_PRODUCTS[1]!.id,
        quantityOrdered: '200',
        unit: 'kg',
        unitPrice: '14000',
      },
    ],
  },
  {
    id: '70000000-0000-4000-8000-000000000002',
    tenantId: DEMO_TENANT_ID as PurchaseOrder['tenantId'],
    poNo: 'PO-1043',
    supplierId: DEMO_PARTNERS[1]!.id,
    orderDate: '2026-08-12',
    eta: '2026-08-19',
    cancelled: false,
    lines: [
      {
        id: '71000000-0000-4000-8000-000000000003',
        productId: DEMO_PRODUCTS[2]!.id,
        quantityOrdered: '10000',
        unit: 'm',
      },
    ],
  },
  {
    // Past its ETA with nothing received — the `PO overdue` alert (L26).
    id: '70000000-0000-4000-8000-000000000003',
    tenantId: DEMO_TENANT_ID as PurchaseOrder['tenantId'],
    poNo: 'PO-1039',
    supplierId: DEMO_PARTNERS[0]!.id,
    orderDate: '2026-08-01',
    eta: '2026-08-12',
    cancelled: false,
    lines: [
      {
        id: '71000000-0000-4000-8000-000000000004',
        productId: DEMO_PRODUCTS[3]!.id,
        quantityOrdered: '20',
        unit: 'l',
      },
    ],
  },
];

/** Idempotent: safe to call on every boot in development. */
export async function seedDemoData(): Promise<void> {
  const alreadySeeded = await db.products.where('tenantId').equals(DEMO_TENANT_ID).count();
  if (alreadySeeded > 0) {
    // v2 tables may still be empty on a database seeded before PRD v1.3.
    await seedV3Additions();
    return;
  }

  await db.transaction('rw', db.products, db.locations, db.partners, db.batches, async () => {
    await db.products.bulkPut(DEMO_PRODUCTS);
    await db.locations.bulkPut(DEMO_LOCATIONS);
    await db.partners.bulkPut(DEMO_PARTNERS);
    await db.batches.bulkPut(DEMO_BATCHES);
  });
  await seedV3Additions();
}

/**
 * Seeded separately so a developer whose database predates PRD v1.3 gets the
 * new master data without wiping the events they already recorded.
 */
async function seedV3Additions(): Promise<void> {
  const seeded = await db.productionLocations.where('tenantId').equals(DEMO_TENANT_ID).count();
  if (seeded > 0) return;
  await db.transaction('rw', db.productionLocations, db.boms, db.purchaseOrders, async () => {
    await db.productionLocations.bulkPut(DEMO_PRODUCTION_LOCATIONS);
    await db.boms.bulkPut(DEMO_BOMS);
    await db.purchaseOrders.bulkPut(DEMO_PURCHASE_ORDERS);
  });
}

/** Wipes local data — used by the storage-loss recovery test (T-115). */
export async function resetLocalData(): Promise<void> {
  await db.delete();
  await db.open();
}
