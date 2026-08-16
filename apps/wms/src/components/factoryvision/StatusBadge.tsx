import type {
  MaterialIssueStatus,
  PurchaseOrderStatus,
  ShipmentStatus,
  StockStatus,
  TaskStatus,
} from '@fv/contracts';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * StatusBadge — used on almost every screen (UI Spec §5).
 *
 * The status → colour mapping is LOCKED by UI Spec §6.3. It lives here once so
 * a screen can never invent its own shade of green for "almost done".
 *
 * Note the deliberate asymmetry: an `OPEN` material issue is grey, but the
 * same issue past 24 hours turns red — the single condition allowed to use red
 * on a dashboard (UI Spec D4). Everything else competing for red is what makes
 * that one signal stop working.
 */

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'maintenance' | 'waiting' | 'neutral' | 'default';

const STOCK: Record<StockStatus, Variant> = {
  'AWAITING INSPECTION': 'waiting',
  AVAILABLE: 'success',
  QUARANTINE: 'maintenance',
  ALLOCATED: 'default',
  'IN PRODUCTION': 'info',
  REJECTED: 'danger',
};

const ISSUE: Record<MaterialIssueStatus, Variant> = {
  OPEN: 'neutral',
  'PARTIALLY CLOSED': 'warning',
  CLOSED: 'success',
};

const SHIPMENT: Record<ShipmentStatus, Variant> = {
  DRAFT: 'neutral',
  ALLOCATED: 'default',
  PICKED: 'warning',
  LOADED: 'default',
  SHIPPED: 'success',
};

/**
 * `PARTIALLY RECEIVED` is warning, deliberately NOT danger (UI Spec §6.3).
 * Short delivery is normal trade and often reasonable; painting it red teaches
 * people to stop noticing red — and red belongs to exactly one thing here.
 */
const PURCHASE_ORDER: Record<PurchaseOrderStatus, Variant> = {
  OPEN: 'neutral',
  'PARTIALLY RECEIVED': 'warning',
  RECEIVED: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'maintenance',
};

/** `UNASSIGNED` is grey, not red: hybrid mode expects tasks to wait for a taker. */
const TASK: Record<TaskStatus, Variant> = {
  UNASSIGNED: 'neutral',
  CLAIMED: 'default',
  ASSIGNED: 'default',
  'IN PROGRESS': 'info',
  DONE: 'success',
};

export type StatusBadgeProps =
  | { kind: 'stock'; status: StockStatus; overdue?: never; className?: string }
  | { kind: 'issue'; status: MaterialIssueStatus; overdue?: boolean; className?: string }
  | { kind: 'shipment'; status: ShipmentStatus; overdue?: never; className?: string }
  | { kind: 'po'; status: PurchaseOrderStatus; overdue?: boolean; className?: string }
  | { kind: 'task'; status: TaskStatus; overdue?: boolean; className?: string };

export function StatusBadge(props: StatusBadgeProps) {
  const { kind, status, className } = props;

  let variant: Variant;
  if (kind === 'stock') variant = STOCK[status];
  else if (kind === 'issue') variant = ISSUE[status];
  else if (kind === 'po') variant = PURCHASE_ORDER[status];
  else if (kind === 'task') variant = TASK[status];
  else variant = SHIPMENT[status];

  // An issue open past 24h is the product's defining metric. It overrides the
  // normal grey so it cannot be scanned past.
  if (kind === 'issue' && props.overdue && status === 'OPEN') variant = 'danger';

  // A PO past its ETA is emphasised, but only as far as warning. The
  // single-red rule is not loosened by a feature added later (UI Spec §6.3).
  if (kind === 'po' && props.overdue && status === 'OPEN') variant = 'warning';

  // Overdue tasks escalate to danger in their own screens (L27, K18) — never
  // on K01, where they are not shown at all.
  if (kind === 'task' && props.overdue) variant = 'danger';

  return (
    <Badge variant={variant} className={cn(className)}>
      {status}
    </Badge>
  );
}
