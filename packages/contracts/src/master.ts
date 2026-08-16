import { z } from 'zod';
import { ItemClass } from './enums.js';
import { DateOnly, Decimal, Quantity, TenantId, UnitCode, Uuid } from './primitives.js';

/**
 * Master data. Every record carries `tenantId` — retrofitting multi-tenancy
 * after 40 screens exist means touching all 40 (UI Spec §24).
 */

/** `1 sak = 25 kg` — conversion factors are decimal strings too (Tech Stack §2.4). */
export const UnitConversion = z.object({
  from: UnitCode,
  to: UnitCode,
  factor: Decimal,
});
export type UnitConversion = z.infer<typeof UnitConversion>;

export const Product = z.object({
  id: Uuid,
  tenantId: TenantId,
  sku: z.string().min(1),
  name: z.string().min(1),
  itemClass: ItemClass,
  baseUnit: UnitCode,
  /** Alternate units the floor actually uses, converted to `baseUnit`. */
  conversions: z.array(UnitConversion).default([]),
  /** Days. Drives the L20 expiry default and FEFO ordering. */
  shelfLifeDays: z.number().int().nonnegative().optional(),
  minimumStock: Quantity.optional(),
  /** Weighted-average cost per base unit — powers the value-ordered reports. */
  averageCost: Decimal.optional(),
  active: z.boolean().default(true),
});
export type Product = z.infer<typeof Product>;

/**
 * How deep a warehouse tree may go. Five is a limit, not a target — past it
 * an operator is naming more places than they can remember, which is how
 * putaway accuracy dies.
 */
export const MAX_LOCATION_DEPTH = 5;

/**
 * A place in the warehouse.
 *
 * ## Depth is a number, and its NAME is tenant configuration
 *
 * Earlier versions hard-coded `WAREHOUSE → ZONE → RACK`. That fitted exactly
 * one shape of factory. A single shed with shelves has no zones and was forced
 * to invent one; a cold store that genuinely picks by bin had nowhere to put
 * it; a two-site factory wanted a site level above the warehouse.
 *
 * So the hierarchy is now a plain tree with a `depth`, and what each depth is
 * CALLED lives in tenant configuration (`locationLevels`) — the same rule the
 * rest of the product already follows: if a difference between factories
 * touches only language and behaviour, it is configuration, not schema
 * (PRD §9.2).
 *
 * `depth` is derived from the parent chain and stored so queries do not have
 * to walk it. `parentId === null` means `depth === 0`.
 */
export const Location = z.object({
  id: Uuid,
  tenantId: TenantId,
  code: z.string().min(1),
  name: z.string().min(1),
  parentId: Uuid.nullable().default(null),
  /** 0 = top of the tree. Its label comes from `locationLevels[depth]`. */
  depth: z.number().int().min(0).max(MAX_LOCATION_DEPTH - 1).default(0),
  /**
   * Can stock physically sit here?
   *
   * Not inferred from being a leaf: plenty of factories keep bulk material on
   * the floor of a zone that also contains racks. Guessing it would silently
   * offer the wrong places at putaway, so it is asked once and stored.
   */
  storable: z.boolean().default(false),
  /** Non-physical, e.g. a legacy `In Production` holder. Never offered at putaway. */
  virtual: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type Location = z.infer<typeof Location>;

/** Pre-v1.4 fixed levels, kept only to migrate existing local databases. */
export type LegacyLocationLevel = 'WAREHOUSE' | 'ZONE' | 'RACK' | 'VIRTUAL';

/**
 * Maps a legacy row onto the flexible model.
 *
 * `VIRTUAL` carried two meanings at once — "not a real place" and "sits at the
 * top" — so it becomes `depth 0` plus the `virtual` flag, which were always
 * two different facts.
 */
export function fromLegacyLevel(level: LegacyLocationLevel): {
  depth: number;
  storable: boolean;
  virtual: boolean;
} {
  switch (level) {
    case 'WAREHOUSE':
      return { depth: 0, storable: false, virtual: false };
    case 'ZONE':
      return { depth: 1, storable: false, virtual: false };
    case 'RACK':
      return { depth: 2, storable: true, virtual: false };
    case 'VIRTUAL':
      return { depth: 0, storable: true, virtual: true };
  }
}

export const Partner = z.object({
  id: Uuid,
  tenantId: TenantId,
  code: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['SUPPLIER', 'CUSTOMER', 'BOTH']),
  phone: z.string().optional(),
  active: z.boolean().default(true),
});
export type Partner = z.infer<typeof Partner>;

/**
 * A batch is the traceability unit. Expiry drives FEFO; a batch without an
 * expiry sorts last, never first.
 */
export const Batch = z.object({
  id: Uuid,
  tenantId: TenantId,
  productId: Uuid,
  batchNo: z.string().min(1),
  producedOn: DateOnly.optional(),
  expiryDate: DateOnly.optional(),
  supplierId: Uuid.optional(),
  /** Which delivery this batch arrived on — first question when quality is queried. */
  purchaseOrderId: Uuid.optional(),
});
export type Batch = z.infer<typeof Batch>;

/**
 * Line → Machine / Area (PRD F1, added v1.3).
 *
 * Kept SEPARATE from `Location` on purpose: production locations hold no
 * permanent stock and never join a warehouse stock take, but they are the
 * mandatory destination of every material request and the holder of
 * `IN PRODUCTION`. Storing them as free text would make per-lane variance
 * impossible to compute without cleaning data by hand (PRD §9.3).
 */
export const ProductionLocation = z.object({
  id: Uuid,
  tenantId: TenantId,
  code: z.string().min(1),
  name: z.string().min(1),
  /** `null` for a LINE; a machine/area points at its line. */
  parentId: Uuid.nullable().default(null),
  level: z.enum(['LINE', 'MACHINE', 'AREA']),
  /** Never deleted once it has held stock — only deactivated (UI Spec K04). */
  active: z.boolean().default(true),
});
export type ProductionLocation = z.infer<typeof ProductionLocation>;

/* --- F24 Purchase Order ------------------------------------------------- */

export const PurchaseOrderLine = z.object({
  id: Uuid,
  productId: Uuid,
  quantityOrdered: Quantity,
  unit: UnitCode,
  unitPrice: Decimal.optional(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLine>;

/**
 * A delivery plan, not a procurement control. Approval stays in Fase 3
 * (PRD §2.3) — what P0 needs is "what are we waiting for, and how much of it
 * has actually turned up".
 *
 * `status` is NOT stored here. It is projected from receipt events by
 * `projectPurchaseOrder` in @fv/domain, for the same reason stock is: a stored
 * status drifts from its own receipts after an offline sync.
 */
export const PurchaseOrder = z.object({
  id: Uuid,
  tenantId: TenantId,
  poNo: z.string().min(1),
  supplierId: Uuid,
  orderDate: DateOnly,
  /** Mandatory: without an ETA there is no arrival task, and F25 loses its main source. */
  eta: DateOnly,
  lines: z.array(PurchaseOrderLine).min(1),
  note: z.string().optional(),
  cancelled: z.boolean().default(false),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;

/* --- F21 Bill of Materials ---------------------------------------------- */

export const BomLine = z.object({
  id: Uuid,
  productId: Uuid,
  /** Standard consumption per `outputQuantity` of the parent product. */
  standardQuantity: Quantity,
  unit: UnitCode,
  /** Optional allowance, percent as a decimal string (`"2"` = 2%). */
  standardShrinkagePct: Decimal.optional(),
});
export type BomLine = z.infer<typeof BomLine>;

/**
 * One active BOM per product, no versioning in P0 (PRD F21).
 *
 * `outputQuantity` + `outputUnit` is what lets a per-batch recipe
 * (`1000 g` of dough) and a per-unit recipe (`1 pcs`) share one structure —
 * the factory fills in its own basis, which is not a decision anyone can make
 * from an office.
 */
export const Bom = z.object({
  id: Uuid,
  tenantId: TenantId,
  productId: Uuid,
  outputQuantity: Quantity,
  outputUnit: UnitCode,
  lines: z.array(BomLine).default([]),
  /**
   * A recipe no human has checked yet. The flag travels with the variance
   * report (K12): variance against an unverified recipe is not yet actionable,
   * and that has to be visible.
   */
  verified: z.boolean().default(false),
});
export type Bom = z.infer<typeof Bom>;
