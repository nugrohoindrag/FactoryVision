import { formatTimestamp } from '@fv/domain';
import { Badge } from '@/components/ui/badge';
import type { OutboxEntry, StoredEvent } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * OfflineQueueList — L03 sync status, L04 conflict review (UI Spec §5, §15).
 *
 * Shows exactly what has not reached the server yet, in the operator's own
 * terms — "Goods receipt · 2 minutes ago", not an event type and a UUID.
 * PRD §12 asks for an honest sync indicator; honesty means legible, not just
 * accurate.
 *
 * Queued rows are neutral. Only a blocked row — one waiting on a human
 * decision — gets a status colour, because only that row needs anything.
 */

/** Event type → the words the floor uses for it (through the term layer at call site). */
const EVENT_LABELS: Record<string, string> = {
  'goods_receipt.created': 'Goods receipt opened',
  'goods_receipt.item_added': 'Item received',
  'inspection.decided': 'Inspection decision',
  'putaway.completed': 'Putaway',
  'material_issue.requested': 'Material issue requested',
  'material_issue.prepared': 'Material issue prepared',
  'material_issue.handed_over': 'Handover confirmed',
  'material_issue.returned': 'Material returned',
  'material_issue.closed': 'Material issue closed',
  'production.output_submitted': 'Production output',
  'shipment.created': 'Shipment created',
  'shipment.picked': 'Picked',
  'shipment.loaded': 'Loaded',
  'shipment.shipped': 'Shipped',
  'stock.adjusted': 'Stock adjustment',
  'stock_take.session_created': 'Stock take started',
  'stock_take.counted': 'Count recorded',
  'stock_take.approved': 'Stock take approved',
};

export interface QueueRow {
  entry: OutboxEntry;
  event?: StoredEvent;
}

export function OfflineQueueList({ rows, className }: { rows: QueueRow[]; className?: string }) {
  return (
    <ul className={cn('divide-y divide-border overflow-hidden rounded-card border border-border', className)}>
      {rows.map(({ entry, event }) => (
        <li key={entry.eventId} className="flex items-center gap-3 bg-card px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-body text-text-primary">
              {EVENT_LABELS[event?.type ?? ''] ?? 'Transaction'}
            </p>
            <p className="truncate text-body-sm text-text-secondary">
              {formatTimestamp(entry.queuedAt)}
              {entry.attempts > 0 && ` · ${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}`}
            </p>
          </div>

          {entry.state === 'blocked' ? (
            <Badge variant="danger">needs review</Badge>
          ) : entry.state === 'sending' ? (
            <Badge variant="info">sending</Badge>
          ) : (
            <span className="shrink-0 text-body-sm text-text-secondary">waiting</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export { EVENT_LABELS };
