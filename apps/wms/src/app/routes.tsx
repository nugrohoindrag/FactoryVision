import { Navigate, type RouteObject } from 'react-router-dom';
import { FieldShell } from '@/components/layout/FieldShell';
import { OfficeShell } from '@/components/layout/OfficeShell';
import { Placeholder } from '@/screens/Placeholder';
import type { TermKey } from '@/lib/terms/useTerm';

/**
 * Route map — all 40 P0 screens (UI Spec §3), navigable and empty.
 *
 * React Router in LIBRARY mode, not framework mode: no loaders, no SSR, no
 * assumption that a server exists during navigation (Tech Stack §2.2). Data
 * comes from Dexie through hooks.
 */

type Stub = {
  path: string;
  screenId: string;
  titleKey: TermKey;
  taskId: string;
  sprint: number;
  note?: string;
  index?: boolean;
  /**
   * The real screen, loaded on demand. Route-level splitting is not a later
   * optimisation here: the entry route has a hard 200KB gzip budget, and a
   * screen an operator never opens must not cost them 3G seconds on launch
   * (Tech Stack §4).
   */
  lazy?: () => Promise<{ Component: React.ComponentType }>;
};

const stub = (s: Stub): RouteObject =>
  s.lazy
    ? { path: s.index ? undefined : s.path, index: s.index, lazy: s.lazy }
    : {
        path: s.index ? undefined : s.path,
        index: s.index,
        element: (
          <Placeholder
            screenId={s.screenId}
            titleKey={s.titleKey}
            taskId={s.taskId}
            sprint={s.sprint}
            note={s.note}
          />
        ),
      };

/** How many P0 screens are actually built, for the progress line in dev. */
export const builtScreenCount = (stubs: Stub[]) => stubs.filter((s) => s.lazy).length;

/* Field shell — 26 screens (UI Spec §3.1) */
const FIELD_SCREENS: Stub[] = [
  { index: true, path: '', screenId: 'L02', titleKey: 'screen_home', taskId: 'T-069', sprint: 2, lazy: () => import('@/screens/field/Home').then((m) => ({ Component: m.Home })) },
  { path: 'stock', screenId: 'L12', titleKey: 'stock_card', taskId: 'T-056', sprint: 2, lazy: () => import('@/screens/field/StockCard').then((m) => ({ Component: m.StockCard })) },
  // The `Tasks` tab pointed at empty space until PRD v1.3 — the bottom nav
  // advertised a screen that did not exist (UI Spec §6.5 vs §3.1).
  { path: 'tasks', screenId: 'L27', titleKey: 'screen_tasks', taskId: 'T-150', sprint: 5, lazy: () => import('@/screens/field/MyTasks').then((m) => ({ Component: m.MyTasks })) },
  { path: 'issues/queue', screenId: 'L14', titleKey: 'screen_issue_queue', taskId: 'T-058', sprint: 2, lazy: () => import('@/screens/field/IssueQueue').then((m) => ({ Component: m.IssueQueue })) },
  { path: 'sync', screenId: 'L03', titleKey: 'sync_status', taskId: 'T-046', sprint: 2, lazy: () => import('@/screens/field/SyncStatus').then((m) => ({ Component: m.SyncStatus })) },
  { path: 'sync/conflicts', screenId: 'L04', titleKey: 'review_conflicts', taskId: 'T-048', sprint: 2, lazy: () => import('@/screens/field/ReviewConflicts').then((m) => ({ Component: m.ReviewConflicts })) },
  { path: 'receipts/new', screenId: 'L05', titleKey: 'screen_new_receipt', taskId: 'T-049', sprint: 2, lazy: () => import('@/screens/field/NewGoodsReceipt').then((m) => ({ Component: m.NewGoodsReceipt })) },
  { path: 'receipts/:receiptId/items', screenId: 'L06', titleKey: 'goods_receipt', taskId: 'T-024', sprint: 1, lazy: () => import('@/screens/field/AddReceiptItem').then((m) => ({ Component: m.AddReceiptItem })) },
  { path: 'receipts/:receiptId/weigh', screenId: 'L07', titleKey: 'quantity', taskId: 'T-051', sprint: 2, lazy: () => import('@/screens/field/WeighingInput').then((m) => ({ Component: m.WeighingInput })) },
  { path: 'receipts/:receiptId/label', screenId: 'L08', titleKey: 'batch', taskId: 'T-052', sprint: 2, lazy: () => import('@/screens/field/PrintBatchLabel').then((m) => ({ Component: m.PrintBatchLabel })) },
  { path: 'inspection', screenId: 'L09', titleKey: 'screen_inspection_queue', taskId: 'T-053', sprint: 2, lazy: () => import('@/screens/field/InspectionQueue').then((m) => ({ Component: m.InspectionQueue })) },
  { path: 'inspection/:lineId', screenId: 'L10', titleKey: 'inspection', taskId: 'T-054', sprint: 2, lazy: () => import('@/screens/field/InspectionDecision').then((m) => ({ Component: m.InspectionDecision })) },
  { path: 'putaway', screenId: 'L11', titleKey: 'putaway', taskId: 'T-055', sprint: 2, lazy: () => import('@/screens/field/Putaway').then((m) => ({ Component: m.Putaway })) },
  { path: 'issues/request', screenId: 'L13', titleKey: 'material_issue', taskId: 'T-026', sprint: 1, lazy: () => import('@/screens/field/RequestMaterial').then((m) => ({ Component: m.RequestMaterial })) },
  { path: 'issues/:issueId/prepare', screenId: 'L15', titleKey: 'picking', taskId: 'T-059', sprint: 2, lazy: () => import('@/screens/field/PrepareIssue').then((m) => ({ Component: m.PrepareIssue })) },
  { path: 'issues/:issueId/handover', screenId: 'L16', titleKey: 'material_issue', taskId: 'T-060', sprint: 2, lazy: () => import('@/screens/field/HandoverConfirmation').then((m) => ({ Component: m.HandoverConfirmation })) },
  { path: 'issues/mine', screenId: 'L17', titleKey: 'screen_my_open_issues', taskId: 'T-061', sprint: 2, lazy: () => import('@/screens/field/MyOpenIssues').then((m) => ({ Component: m.MyOpenIssues })) },
  { path: 'issues/:issueId/return', screenId: 'L18', titleKey: 'material_return', taskId: 'T-062', sprint: 2, lazy: () => import('@/screens/field/ReturnMaterial').then((m) => ({ Component: m.ReturnMaterial })) },
  { path: 'issues/:issueId/close', screenId: 'L19', titleKey: 'shrinkage', taskId: 'T-034', sprint: 1, lazy: () => import('@/screens/field/CloseIssue').then((m) => ({ Component: m.CloseIssue })) },
  { path: 'production/output', screenId: 'L20', titleKey: 'production_receipt', taskId: 'T-064', sprint: 2, lazy: () => import('@/screens/field/SubmitOutput').then((m) => ({ Component: m.SubmitOutput })) },
  { path: 'shipments/:shipmentId/pick', screenId: 'L21', titleKey: 'pick_list', taskId: 'T-066', sprint: 2, lazy: () => import('@/screens/field/PickList').then((m) => ({ Component: m.PickList })) },
  { path: 'shipments/:shipmentId/load', screenId: 'L22', titleKey: 'loading', taskId: 'T-067', sprint: 2, lazy: () => import('@/screens/field/StagingLoading').then((m) => ({ Component: m.StagingLoading })) },
  { path: 'stock-take/:sessionId/count', screenId: 'L23', titleKey: 'blind_count', taskId: 'T-032', sprint: 1, lazy: () => import('@/screens/field/BlindCount').then((m) => ({ Component: m.BlindCount })) },
  { path: 'stock-take/:sessionId/recount', screenId: 'L24', titleKey: 'recount', taskId: 'T-077', sprint: 3, lazy: () => import('@/screens/field/Recount').then((m) => ({ Component: m.Recount })) },
  { path: 'adjustments/new', screenId: 'L25', titleKey: 'stock_adjustment', taskId: 'T-068', sprint: 2, lazy: () => import('@/screens/field/StockAdjustment').then((m) => ({ Component: m.StockAdjustment })) },
  { path: 'alerts', screenId: 'L26', titleKey: 'screen_alerts', taskId: 'T-082', sprint: 3, lazy: () => import('@/screens/field/Alerts').then((m) => ({ Component: m.Alerts })) },
];

/* Office shell — 14 screens (UI Spec §3.2) */
const OFFICE_SCREENS: Stub[] = [
  { index: true, path: '', screenId: 'K01', titleKey: 'screen_owner_dashboard', taskId: 'T-084', sprint: 3, lazy: () => import('@/screens/office/OwnerDashboard').then((m) => ({ Component: m.OwnerDashboard })) },
  { path: 'open-issues', screenId: 'K02', titleKey: 'screen_open_issues_monitor', taskId: 'T-086', sprint: 3, lazy: () => import('@/screens/office/OpenIssuesMonitor').then((m) => ({ Component: m.OpenIssuesMonitor })) },
  { path: 'products', screenId: 'K03', titleKey: 'screen_products', taskId: 'T-070', sprint: 2, lazy: () => import('@/screens/office/Products').then((m) => ({ Component: m.Products })) },
  { path: 'locations', screenId: 'K04', titleKey: 'screen_locations', taskId: 'T-071', sprint: 2, lazy: () => import('@/screens/office/Locations').then((m) => ({ Component: m.Locations })) },
  { path: 'partners', screenId: 'K05', titleKey: 'screen_partners', taskId: 'T-072', sprint: 2, lazy: () => import('@/screens/office/Partners').then((m) => ({ Component: m.Partners })) },
  { path: 'import', screenId: 'K06', titleKey: 'screen_import', taskId: 'T-028', sprint: 1, lazy: () => import('@/screens/office/ExcelImport').then((m) => ({ Component: m.ExcelImport })) },
  { path: 'stock-take', screenId: 'K07', titleKey: 'screen_stock_take', taskId: 'T-074', sprint: 3, lazy: () => import('@/screens/office/CreateStockTake').then((m) => ({ Component: m.CreateStockTake })) },
  { path: 'variance', screenId: 'K08', titleKey: 'screen_variance_report', taskId: 'T-079', sprint: 3, lazy: () => import('@/screens/office/VarianceReport').then((m) => ({ Component: m.VarianceReport })) },
  { path: 'approvals', screenId: 'K09', titleKey: 'screen_approval_queue', taskId: 'T-080', sprint: 3, lazy: () => import('@/screens/office/ApprovalQueue').then((m) => ({ Component: m.ApprovalQueue })) },
  { path: 'shipments', screenId: 'K10', titleKey: 'screen_shipments', taskId: 'T-065', sprint: 2, lazy: () => import('@/screens/office/CreateShipment').then((m) => ({ Component: m.CreateShipment })) },
  { path: 'reports', screenId: 'K11', titleKey: 'screen_report_centre', taskId: 'T-087', sprint: 3, lazy: () => import('@/screens/office/ReportCentre').then((m) => ({ Component: m.ReportCentre })) },
  { path: 'reports/usage-variance', screenId: 'K12', titleKey: 'variance', taskId: 'T-093', sprint: 3, lazy: () => import('@/screens/office/UsageVariance').then((m) => ({ Component: m.UsageVariance })) },
  { path: 'users', screenId: 'K13', titleKey: 'screen_users_roles', taskId: 'T-073', sprint: 2, lazy: () => import('@/screens/office/UsersRoles').then((m) => ({ Component: m.UsersRoles })) },
  { path: 'configuration', screenId: 'K14', titleKey: 'screen_tenant_config', taskId: 'T-094', sprint: 3, lazy: () => import('@/screens/office/TenantConfiguration').then((m) => ({ Component: m.TenantConfiguration })) },
  /* --- added with PRD v1.3 (Sprint 5) ---------------------------------- */
  { path: 'purchase-orders', screenId: 'K15', titleKey: 'screen_purchase_orders', taskId: 'T-134', sprint: 5, lazy: () => import('@/screens/office/PurchaseOrders').then((m) => ({ Component: m.PurchaseOrders })) },
  { path: 'purchase-orders/new', screenId: 'K16', titleKey: 'screen_purchase_orders', taskId: 'T-135', sprint: 5, lazy: () => import('@/screens/office/EditPurchaseOrder').then((m) => ({ Component: m.EditPurchaseOrder })) },
  { path: 'purchase-orders/:poId/edit', screenId: 'K16', titleKey: 'screen_purchase_orders', taskId: 'T-135', sprint: 5, lazy: () => import('@/screens/office/EditPurchaseOrder').then((m) => ({ Component: m.EditPurchaseOrder })) },
  { path: 'bom', screenId: 'K17', titleKey: 'screen_bom', taskId: 'T-131', sprint: 5, lazy: () => import('@/screens/office/BillOfMaterials').then((m) => ({ Component: m.BillOfMaterials })) },
  { path: 'task-board', screenId: 'K18', titleKey: 'screen_task_board', taskId: 'T-152', sprint: 5, lazy: () => import('@/screens/office/TaskBoard').then((m) => ({ Component: m.TaskBoard })) },
];

export const routes: RouteObject[] = [
  // L01 and the registration flow were built last (UI Spec §24). They live
  // outside both shells: there is no navigation to offer someone who is not
  // signed in yet.
  {
    path: '/sign-in',
    lazy: () => import('@/screens/access/SignIn').then((m) => ({ Component: m.SignIn })),
  },
  {
    path: '/register',
    lazy: () => import('@/screens/access/Register').then((m) => ({ Component: m.Register })),
  },
  { path: '/', element: <Navigate to="/f" replace /> },
  { path: '/f', element: <FieldShell />, children: FIELD_SCREENS.map(stub) },
  { path: '/o', element: <OfficeShell />, children: OFFICE_SCREENS.map(stub) },
  { path: '*', element: <Navigate to="/f" replace /> },
];

export const SCREEN_COUNT = FIELD_SCREENS.length + OFFICE_SCREENS.length;
