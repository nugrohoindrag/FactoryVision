import type { EventType, Role } from '@fv/contracts';

/**
 * B-018 — permission sits on the ACTION, never on the screen.
 *
 * UI Spec §24 makes the reason explicit: screens get renamed, merged and split,
 * and a permission model pinned to screen names has to be re-derived every time
 * the navigation changes. Actions are stable — "close a material issue" means
 * the same thing whether it happens on L19, from the task board, or from a
 * script five years from now.
 *
 * The role table is PRD F13, unchanged:
 *
 * | Role            | Shape                                                   |
 * |-----------------|---------------------------------------------------------|
 * | OWNER           | everything + approvals + sees purchase prices            |
 * | WAREHOUSE_HEAD  | every transaction + task assignment, no deletion         |
 * | OPERATOR        | transactions + defect marking + claiming, no prices      |
 * | PRODUCTION      | request material, return remainder, submit output        |
 * | QC              | pass / hold / reject — only when deep inspection is on   |
 */

export type Permission =
  | 'event.append'
  | 'price.view'
  | 'master.write'
  | 'master.deactivate'
  | 'po.write'
  | 'po.close'
  | 'bom.write'
  | 'task.assign'
  | 'task.claim'
  | 'report.view'
  | 'dashboard.view'
  | 'user.manage'
  | 'config.write'
  | 'approval.decide'
  | 'conflict.resolve'
  | 'import.run';

const OWNER_ALL: Permission[] = [
  'event.append',
  'price.view',
  'master.write',
  'master.deactivate',
  'po.write',
  'po.close',
  'bom.write',
  'task.assign',
  'task.claim',
  'report.view',
  'dashboard.view',
  'user.manage',
  'config.write',
  'approval.decide',
  'conflict.resolve',
  'import.run',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER_ALL),
  WAREHOUSE_HEAD: new Set<Permission>([
    'event.append',
    'price.view',
    'master.write',
    'master.deactivate',
    'po.write',
    'po.close',
    'bom.write',
    'task.assign',
    'task.claim',
    'report.view',
    'dashboard.view',
    'config.write',
    'conflict.resolve',
    'import.run',
  ]),
  OPERATOR: new Set<Permission>(['event.append', 'task.claim']),
  PRODUCTION: new Set<Permission>(['event.append', 'task.claim']),
  QC: new Set<Permission>(['event.append', 'task.claim']),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Which roles may write which event type.
 *
 * `event.append` alone is too coarse: an operator appending
 * `stock_take.approved` would post adjustments the owner never saw, and a
 * production user appending `goods_receipt.item_added` would be receiving
 * goods from the shop floor. The permission is the action, and these ARE the
 * actions — the rest of the API is reporting.
 */
export const EVENT_ROLES: Record<EventType, ReadonlySet<Role>> = {
  'goods_receipt.created': new Set<Role>(['OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  'goods_receipt.item_added': new Set<Role>(['OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  'inspection.decided': new Set<Role>(['QC', 'WAREHOUSE_HEAD', 'OWNER']),
  'putaway.completed': new Set<Role>(['OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  'material_issue.requested': new Set<Role>(['PRODUCTION', 'WAREHOUSE_HEAD', 'OWNER']),
  'material_issue.prepared': new Set<Role>(['OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  /** Two-party handover: either side may record it, both must confirm (L16). */
  'material_issue.handed_over': new Set<Role>([
    'OPERATOR',
    'PRODUCTION',
    'WAREHOUSE_HEAD',
    'OWNER',
  ]),
  'material_issue.returned': new Set<Role>(['PRODUCTION', 'OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  'material_issue.closed': new Set<Role>(['PRODUCTION', 'OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  'production.output_submitted': new Set<Role>(['PRODUCTION', 'WAREHOUSE_HEAD', 'OWNER']),
  'shipment.created': new Set<Role>(['WAREHOUSE_HEAD', 'OWNER']),
  'shipment.picked': new Set<Role>(['OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  'shipment.loaded': new Set<Role>(['OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  'shipment.shipped': new Set<Role>(['OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  'stock.adjusted': new Set<Role>(['WAREHOUSE_HEAD', 'OWNER']),
  'stock_take.session_created': new Set<Role>(['WAREHOUSE_HEAD', 'OWNER']),
  'stock_take.counted': new Set<Role>(['OPERATOR', 'WAREHOUSE_HEAD', 'OWNER']),
  /** Approving a count posts the adjustments, so it stops at the owner. */
  'stock_take.approved': new Set<Role>(['OWNER']),
  'purchase_order.closed': new Set<Role>(['WAREHOUSE_HEAD', 'OWNER']),
  'task.claimed': new Set<Role>(['OPERATOR', 'PRODUCTION', 'QC', 'WAREHOUSE_HEAD', 'OWNER']),
  'task.assigned': new Set<Role>(['WAREHOUSE_HEAD', 'OWNER']),
  'task.released': new Set<Role>(['OPERATOR', 'PRODUCTION', 'QC', 'WAREHOUSE_HEAD', 'OWNER']),
};

export function canAppend(role: Role, type: EventType): boolean {
  return EVENT_ROLES[type]?.has(role) ?? false;
}
