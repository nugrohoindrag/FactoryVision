/**
 * Default terminology dictionary — English, warehouse English (DS §13, D1).
 *
 * These are DEFAULT VALUES, not constants. A tenant can override any key
 * (PRD §9.2, K14) to switch the product to Indonesian, or to whatever a
 * particular factory actually calls the thing, without touching code.
 *
 * The recognition test for every entry: would a warehouse supervisor
 * recognise it without training? If not, the term is wrong — however
 * correct it is in ERP literature.
 */

export const DEFAULT_TERMS = {
  /* Goods flow — DS §13 */
  goods_receipt: 'Goods Receipt',
  delivery_note: 'Delivery Note',
  inspection: 'Inspection',
  pass: 'Pass',
  hold: 'Hold',
  reject: 'Reject',
  quarantine: 'Quarantine',
  putaway: 'Putaway',
  warehouse: 'Warehouse',
  zone: 'Zone',
  rack: 'Rack',
  material_issue: 'Material Issue',
  material_return: 'Material Return',
  shrinkage: 'Shrinkage',
  consumed: 'Consumed',
  issued: 'Issued',
  returned: 'Returned',
  production_receipt: 'Production Receipt',
  picking: 'Picking',
  pick_list: 'Pick List',
  staging: 'Staging',
  loading: 'Loading',
  shipment: 'Shipment',
  scrap: 'Scrap',

  /* Counting & accuracy */
  stock_take: 'Stock Take',
  cycle_count: 'Cycle Count',
  blind_count: 'Blind Count',
  recount: 'Recount',
  variance: 'Variance',
  stock_adjustment: 'Stock Adjustment',
  stock_card: 'Stock Card',
  dead_stock: 'Dead Stock',
  stock_age: 'Stock Age',

  /* Objects & states */
  batch: 'Batch',
  expiry: 'Expiry',
  shelf_life: 'Shelf Life',
  supplier: 'Supplier',
  customer: 'Customer',
  minimum_stock: 'Minimum Stock',
  unit_conversion: 'Unit Conversion',
  raw_material: 'Raw Material',
  packaging: 'Packaging',
  auxiliary_material: 'Auxiliary Material',
  wip: 'WIP',
  finished_goods: 'Finished Goods',
  spare_part: 'Spare Part',
  in_production: 'In Production',
  product: 'Product',
  location: 'Location',
  partner: 'Partner',
  quantity: 'Quantity',
  work_order: 'Work order',

  /* Navigation — Field shell bottom nav (UI Spec §6.5) */
  nav_home: 'Home',
  nav_stock: 'Stock',
  nav_tasks: 'Tasks',
  nav_sync: 'Sync',

  /* Navigation — Office shell sidebar groups (UI Spec §6.5) */
  nav_dashboard: 'Dashboard',
  nav_inventory: 'Inventory',
  nav_operations: 'Operations',
  nav_reports: 'Reports',
  nav_master_data: 'Master Data',
  nav_settings: 'Settings',

  /* Sync states — D3. Queueing is normal, and must not read as an error. */
  sync_synced: 'Synced',
  sync_pending: 'pending',
  sync_conflict: 'needs review',
  sync_status: 'Sync status',
  review_conflicts: 'Review conflicts',

  /* Screen titles */
  screen_home: 'Home',
  screen_alerts: 'Alerts',
  screen_new_receipt: 'New goods receipt',
  screen_inspection_queue: 'Inspection queue',
  screen_issue_queue: 'Issue queue',
  screen_my_open_issues: 'My open issues',
  screen_owner_dashboard: 'Owner dashboard',
  screen_open_issues_monitor: 'Open issues monitor',
  screen_products: 'Products',
  screen_locations: 'Locations',
  screen_partners: 'Partners',
  screen_import: 'Excel import',
  screen_stock_take: 'Stock take',
  screen_variance_report: 'Variance report',
  screen_approval_queue: 'Approval queue',
  screen_shipments: 'Shipments',
  screen_report_centre: 'Report centre',
  screen_users_roles: 'Users & roles',
  screen_tenant_config: 'Tenant configuration',
  /* Added with PRD v1.3 (DS §13 v3.3) */
  screen_tasks: 'Tasks',
  screen_task_board: 'Task board',
  screen_purchase_orders: 'Purchase orders',
  screen_bom: 'Bill of materials',

  /**
   * The v1.3 terminology split. `bon_bahan` is DELETED, not aliased: an alias
   * would make the two look interchangeable, which is exactly the confusion
   * the split exists to end. A request can exist without an issue; an issue
   * never exists without a request (DS §13).
   */
  material_request: 'Material Request',
  purchase_order: 'Purchase Order',
  defect: 'Defect',
  bill_of_materials: 'Bill of Materials',
  production_line: 'Line',
  task: 'Task',

  /* Field labels — L05 · L06 · L07 (UI Spec §8) */
  field_supplier: 'Supplier',
  field_delivery_note_no: 'Delivery note no.',
  field_delivery_note_photo: 'Photo of delivery note',
  field_date_received: 'Date received',
  field_item: 'Item',
  field_quantity: 'Quantity',
  field_unit: 'Unit',
  field_batch_no: 'Batch / lot no.',
  field_expiry_date: 'Expiry date',
  field_purchase_price: 'Purchase price',
  field_photo: 'Photo',
  field_gross_weight: 'Gross weight',
  field_tare_weight: 'Tare weight',
  field_net_weight: 'Net weight',
  field_sacks: 'Number of sacks',
  field_location: 'Location',
  field_note: 'Note',
  field_reason: 'Reason',
  field_work_order: 'Work order no.',
  field_production_batch: 'Production batch',
  field_quantity_requested: 'Quantity requested',
  field_quantity_returned: 'Quantity returned',
  field_shrinkage_quantity: 'Shrinkage quantity',
  field_counted_quantity: 'Counted quantity',
  field_new_quantity: 'New quantity',
  field_current_quantity: 'Current quantity',

  /* Actions — verb first, naming the outcome (DS §13) */
  action_add_items: 'Add items',
  action_save_add_next: 'Save & add next',
  action_save_finish: 'Save & finish',
  action_weigh_instead: 'Weigh instead',
  action_send_request: 'Send request',
  action_quick_issue: 'Quick issue',
  action_close_issue: 'Close issue',
  action_return_to_stock: 'Return to stock',
  action_confirm: 'Confirm',
  action_next_item: 'Next item',
  action_add_material: 'Add material',
  action_remove: 'Remove',
  action_skip_printing: 'Skip printing',

  /* Shared empty / error / offline copy (UI Spec §6.2, DS §13) */
  empty_generic_title: 'Nothing here yet',
  empty_generic_body: 'This screen fills up as work happens on the floor.',
  offline_working: 'Working offline. Your work is saved on this device.',
  error_generic_title: "Couldn't load this screen",
  error_generic_body: 'The data on this device could not be read. Try again.',
  action_retry: 'Try again',
  action_back: 'Go back',

  /* Development-only affordances (removed with T-104) */
  dev_role: 'Role',
  dev_tenant: 'Factory',
  dev_density: 'Density',
} as const;

export type TermKey = keyof typeof DEFAULT_TERMS;

/** A tenant's overrides — a partial map, merged over the defaults. */
export type TermOverrides = Partial<Record<TermKey, string>>;
