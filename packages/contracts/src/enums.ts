import { z } from 'zod';

/**
 * Status value sets are LOCKED by DS §13 / UI Spec §6.3.
 * Adding a value needs the same review as adding a token.
 */

export const StockStatus = z.enum([
  'AWAITING INSPECTION',
  'AVAILABLE',
  'QUARANTINE',
  'ALLOCATED',
  'IN PRODUCTION',
  'REJECTED',
]);
export type StockStatus = z.infer<typeof StockStatus>;

export const MaterialIssueStatus = z.enum(['OPEN', 'PARTIALLY CLOSED', 'CLOSED']);
export type MaterialIssueStatus = z.infer<typeof MaterialIssueStatus>;

export const ShipmentStatus = z.enum(['DRAFT', 'ALLOCATED', 'PICKED', 'LOADED', 'SHIPPED']);
export type ShipmentStatus = z.infer<typeof ShipmentStatus>;

/**
 * PO status is DERIVED from accumulated receipts, never written (PRD §8).
 * `PARTIALLY RECEIVED` is deliberately not a red state (UI Spec §6.3): short
 * delivery is normal trade, and colouring it red teaches people to ignore red.
 */
export const PurchaseOrderStatus = z.enum([
  'OPEN',
  'PARTIALLY RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatus>;

/** Task ownership (F25). `UNASSIGNED` is not a failure — hybrid mode expects it. */
export const TaskStatus = z.enum([
  'UNASSIGNED',
  'CLAIMED',
  'ASSIGNED',
  'IN PROGRESS',
  'DONE',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** The six task kinds in P0 (UI Spec §18.3). */
export const TaskType = z.enum([
  'RECEIVE_DELIVERY',
  'PUTAWAY',
  'PREPARE_ISSUE',
  'PICK_SHIP',
  'COUNT_STOCK',
  'RECOUNT',
]);
export type TaskType = z.infer<typeof TaskType>;

/** Defect reasons at inbound (F2). Tenant-configurable in K14; these are defaults. */
export const DefectReason = z.enum([
  'DAMAGED_IN_TRANSIT',
  'WRONG_ITEM',
  'WET_CONTAMINATED',
  'SHORT_SHELF_LIFE',
  'BELOW_SPEC',
]);
export type DefectReason = z.infer<typeof DefectReason>;

/** K14 `Task assignment mode`. Manufaktur default is HYBRID. */
export const TaskAssignmentMode = z.enum(['HYBRID', 'ASSIGN_ONLY', 'CLAIM_ONLY']);
export type TaskAssignmentMode = z.infer<typeof TaskAssignmentMode>;

/** DS §13 "Objects & states" — item classes drive per-class inspection rules. */
export const ItemClass = z.enum([
  'RAW_MATERIAL',
  'PACKAGING',
  'AUXILIARY',
  'WIP',
  'FINISHED_GOODS',
  'SPARE_PART',
]);
export type ItemClass = z.infer<typeof ItemClass>;

export const InspectionDecision = z.enum(['PASS', 'HOLD', 'REJECT']);
export type InspectionDecision = z.infer<typeof InspectionDecision>;

/**
 * Roles. Permission checks live on the ACTION, not the screen (UI Spec §24) —
 * so they survive when L01 Sign in finally replaces the temporary role picker.
 */
export const Role = z.enum([
  'OPERATOR',
  'PRODUCTION',
  'QC',
  'WAREHOUSE_HEAD',
  'OWNER',
]);
export type Role = z.infer<typeof Role>;

/** Reason lists are tenant-configurable (K14); these are the defaults. */
export const ShrinkageReason = z.enum([
  'SPILLAGE',
  'DAMAGED',
  'UNMEASURED',
  'NATURAL_LOSS',
]);
export type ShrinkageReason = z.infer<typeof ShrinkageReason>;
