import { z } from 'zod';
import { TaskAssignmentMode } from './enums.js';
import { Decimal } from './primitives.js';

/**
 * Tenant configuration — PRD §9.2, shared by the device and the server.
 *
 * Everything here is DATA, not code. PRD §9.1 is explicit that Fase 1 does not
 * build a template engine: an abstraction drawn from a single example is almost
 * always the wrong one, and the second template would force it to be torn down.
 * What gets built instead is every future template axis as per-tenant
 * configuration with exactly one default value.
 *
 * It moved into `@fv/contracts` for one reason: the server now stores this
 * document and syncs it down (B-058). Two definitions of the same defaults
 * would drift, and the drift would be invisible — a factory whose device thinks
 * inspection is off while the server thinks it is on does not get an error, it
 * gets two different answers to the same question.
 *
 * `terms` is a loose string map here on purpose. The vocabulary belongs to the
 * client, which owns the screens; the server has no business knowing which keys
 * exist and would only become a second place to update when one is added.
 */

const FieldRuleSchema = z.object({
  batchRequired: z.boolean(),
  expiryRequired: z.boolean(),
});
export type FieldRule = z.infer<typeof FieldRuleSchema>;

const perItemClass = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    RAW_MATERIAL: schema,
    PACKAGING: schema,
    AUXILIARY: schema,
    WIP: schema,
    FINISHED_GOODS: schema,
    SPARE_PART: schema,
  });

/** Five is a ceiling, not a target (PRD v1.4) — see `MAX_LOCATION_DEPTH`. */
const LocationLevels = z.array(z.string().min(1)).min(1).max(5);

export const TenantConfigSchema = z.object({
  terms: z.record(z.string()).default({}),

  stages: z.object({
    inspection: z.boolean(),
    quarantine: z.boolean(),
    staging: z.boolean(),
    productionQc: z.boolean(),
  }),

  /**
   * What each depth of the warehouse tree is CALLED. The array's LENGTH is the
   * depth limit, so shortening it is how a factory says "we have no zones".
   * Renaming a level is language only; removing one is structural, and K14
   * blocks it while locations still sit at that depth (B-051).
   */
  locationLevels: LocationLevels,

  fieldRules: perItemClass(FieldRuleSchema),
  autoPass: perItemClass(z.boolean()),
  /**
   * Deep inspection per item class. Since PRD v1.3 the DEFAULT path has no
   * inspection gate: the operator marks defect while unloading and good stock
   * lands in AVAILABLE. This switches the old gate back on for a class that
   * genuinely needs it — material waiting on a lab result, say.
   */
  deepInspection: perItemClass(z.boolean()),

  defaults: z.object({
    fefoEnforced: z.boolean(),
    blockExpiredBatches: z.boolean(),
    /** Hours before an open material issue turns red. The product metric (M2). */
    issueOverdueHours: z.number().int().positive(),
    recountThresholdPercent: z.number().nonnegative(),
    /** Adjustments above this rupiah value wait for the owner (F9). */
    approvalThresholdValue: Decimal,
    expiryWarningDays: z.array(z.number().int().positive()),
    deadStockDays: z.number().int().positive(),
    quarantineWarningDays: z.number().int().positive(),
    poPartialStaleDays: z.number().int().positive(),
    taskUnclaimedHours: z.number().int().positive(),
    /**
     * Receiving without a PO stays ALLOWED. It is logged as an exception and
     * reported, never blocked — tidiness is pushed by reporting, not by a
     * barrier at the warehouse door (PRD F24).
     */
    purchaseOrderRequiredOnReceipt: z.boolean(),
    /** The one field `Quick issue` may not skip (PRD F5). */
    destinationRequiredOnRequest: z.boolean(),
  }),

  taskAssignmentMode: TaskAssignmentMode,

  /** Closed lists on purpose: free text cannot be reported on (PRD F9). */
  reasons: z.object({
    adjustment: z.array(z.string()),
    qcRejection: z.array(z.string()),
    shrinkage: z.array(z.string()),
    defect: z.array(z.string()),
    taskRelease: z.array(z.string()),
    poClose: z.array(z.string()),
  }),

  batchNumberPattern: z.string().min(1),

  receivingLocationId: z.string(),
  quarantineLocationId: z.string(),
  rejectLocationId: z.string(),
  productionLocationId: z.string(),
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;

/** The Manufaktur template's defaults — the only template in Fase 1. */
export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  terms: {},

  stages: {
    // v1.3: the routine check moved into L06, so this is no longer the default
    // path. It stays switchable per item class via `deepInspection`.
    inspection: false,
    quarantine: true,
    // v1.3 fix: was `false` while L22 required staging to load a shipment.
    staging: true,
    productionQc: false,
  },

  locationLevels: ['Warehouse', 'Zone', 'Rack'],

  fieldRules: {
    RAW_MATERIAL: { batchRequired: true, expiryRequired: true },
    PACKAGING: { batchRequired: false, expiryRequired: false },
    AUXILIARY: { batchRequired: false, expiryRequired: false },
    WIP: { batchRequired: true, expiryRequired: false },
    FINISHED_GOODS: { batchRequired: true, expiryRequired: true },
    SPARE_PART: { batchRequired: false, expiryRequired: false },
  },

  autoPass: {
    RAW_MATERIAL: true,
    PACKAGING: true,
    AUXILIARY: true,
    WIP: true,
    FINISHED_GOODS: true,
    SPARE_PART: true,
  },

  deepInspection: {
    RAW_MATERIAL: false,
    PACKAGING: false,
    AUXILIARY: false,
    WIP: false,
    FINISHED_GOODS: false,
    SPARE_PART: false,
  },

  defaults: {
    fefoEnforced: false,
    blockExpiredBatches: true,
    issueOverdueHours: 24,
    recountThresholdPercent: 5,
    approvalThresholdValue: '5000000',
    expiryWarningDays: [30, 60, 90],
    deadStockDays: 90,
    quarantineWarningDays: 7,
    poPartialStaleDays: 7,
    taskUnclaimedHours: 4,
    purchaseOrderRequiredOnReceipt: false,
    destinationRequiredOnRequest: true,
  },

  taskAssignmentMode: 'HYBRID',

  reasons: {
    adjustment: ['Lost', 'Damaged', 'Miscount', 'Stock take finding', 'Natural shrinkage'],
    qcRejection: [
      'Wet or mouldy',
      'Damaged packaging',
      'Wrong specification',
      'Expired on arrival',
      'Short quantity',
    ],
    shrinkage: ['Spillage', 'Damaged', 'Unmeasured', 'Natural loss'],
    defect: [
      'Damaged in transit',
      'Wrong item',
      'Wet / contaminated',
      'Short shelf life',
      'Quality below spec',
    ],
    // Letting go of a task is legitimate; letting go silently is not.
    taskRelease: [
      'Shift ended',
      'Reassigned by supervisor',
      'Blocked — waiting on something',
      'Picked up by mistake',
    ],
    // The P0 route for settling a defect remainder while F17 is still P1.
    poClose: [
      'Supplier cannot deliver the rest',
      'Returned to supplier',
      'Cancelled by agreement',
      'Written off',
    ],
  },

  batchNumberPattern: 'YYYYMMDD-Shift-Line',

  receivingLocationId: '20000000-0000-4000-8000-000000000005',
  quarantineLocationId: '20000000-0000-4000-8000-000000000006',
  rejectLocationId: '20000000-0000-4000-8000-000000000008',
  productionLocationId: '20000000-0000-4000-8000-000000000007',
};

/** A patch from K14. Every branch is optional; nothing is required to change one flag. */
export const TenantConfigPatch = TenantConfigSchema.deepPartial();
export type TenantConfigPatch = z.infer<typeof TenantConfigPatch>;
