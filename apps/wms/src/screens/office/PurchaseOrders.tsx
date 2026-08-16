import { formatDate, isPoOverdue, poCompletion, type PoProgress } from '@fv/domain';
import { PackageSearch, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PoLineRow } from '@/components/factoryvision/PoLineRow';
import { ReasonPicker } from '@/components/factoryvision/ReasonPicker';
import { StatusBadge } from '@/components/factoryvision/StatusBadge';
import { EmptyState, LoadingRows } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePartners, usePoProgress, useProducts } from '@/db/hooks';
import { useTerm } from '@/lib/terms/useTerm';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { cn } from '@/lib/utils';

/**
 * K15 · Purchase orders 🆕 (UI Spec §7.5).
 *
 * Answers "what are we waiting for from suppliers".
 *
 * ## Decisions
 *
 * - **The list always shows a progress bar, not just a badge.** "How much has
 *   actually turned up" is the first question about a PO, and a status word
 *   never answers it.
 * - **Sorted by ETA ascending**, nearest arrival first. Not by creation date,
 *   not alphabetically — the list is a queue of things about to happen.
 * - **Overdue uses level 2 warning, never red** (UI Spec §6.3). Red belongs to
 *   one thing in this product, and it is not a late delivery.
 * - **`Close PO` with a mandatory reason** is the P0 route for settling a
 *   defect remainder while supplier returns (F17) are still P1 (PRD §14.9).
 */

type Filter = 'open' | 'partial' | 'overdue' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'partial', label: 'Partially received' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'all', label: 'All' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PurchaseOrders() {
  const orders = usePoProgress();
  const partners = usePartners('SUPPLIER');
  const products = useProducts();
  const append = useAppend();
  const config = useTenantConfig();
  const t = useTerm();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<Filter>('open');
  const [selectedId, setSelectedId] = useState<string>();
  const [closing, setClosing] = useState<PoProgress | null>(null);
  const [closeReason, setCloseReason] = useState<string>();

  const now = today();

  const visible = useMemo(() => {
    if (!orders) return undefined;
    const rows = orders.filter((po) => {
      switch (filter) {
        case 'open':
          return po.status === 'OPEN' || po.status === 'PARTIALLY RECEIVED';
        case 'partial':
          return po.status === 'PARTIALLY RECEIVED';
        case 'overdue':
          return isPoOverdue(po, now);
        default:
          return true;
      }
    });
    // Nearest ETA first: this list is a queue of what is about to arrive.
    return [...rows].sort((a, b) => a.eta.localeCompare(b.eta));
  }, [orders, filter, now]);

  const selected = visible?.find((po) => po.purchaseOrderId === selectedId) ?? visible?.[0];

  const supplierName = (supplierId: string) =>
    partners?.find((p) => p.id === supplierId)?.name ?? supplierId;
  const productName = (productId: string) =>
    products?.find((p) => p.id === productId)?.name ?? productId;

  const closePo = async () => {
    if (!closing || !closeReason) return;
    await append('purchase_order.closed', {
      purchaseOrderId: closing.purchaseOrderId,
      reasonCode: closeReason,
    });
    setClosing(null);
    setCloseReason(undefined);
  };

  const overdueCount = orders?.filter((po) => isPoOverdue(po, now)).length ?? 0;

  if (!visible) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-h2 font-semibold text-text-primary">{t('screen_purchase_orders')}</h1>
        </header>
        <LoadingRows rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">{t('screen_purchase_orders')}</h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          {visible.length} shown
          {/* Warning, never danger — a late delivery is not what red is for. */}
          {overdueCount > 0 && (
            <span className="font-semibold text-st-warning"> · {overdueCount} past ETA</span>
          )}
        </p>
      </header>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => navigate('/o/purchase-orders/new')}>
            <Plus aria-hidden />
            New purchase order
          </Button>
          <span className="flex-1" />
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              type="button"
              size="sm"
              variant={filter === f.id ? 'default' : 'outline'}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {visible.length === 0 ? (
          // The second sentence matters: a factory that is not yet tidy about
          // POs must never feel locked out (PRD F24).
          <EmptyState
            icon={PackageSearch}
            title="No purchase orders here"
            body="Create one, or simply receive goods without a PO — nothing stops an operator at the warehouse door because the paperwork has not been raised yet."
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
            {/* List */}
            <ul className="space-y-2" aria-label="Purchase orders">
              {visible.map((po) => {
                const overdue = isPoOverdue(po, now);
                const active = po.purchaseOrderId === selected?.purchaseOrderId;
                return (
                  <li key={po.purchaseOrderId}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(po.purchaseOrderId)}
                      aria-current={active}
                      className={cn(
                        'w-full rounded-card border bg-card p-card text-left',
                        // Level 2 accent, warning not danger.
                        overdue && 'border-l-[3px] border-l-st-warning',
                        active ? 'border-primary' : 'border-border hover:bg-secondary',
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-body font-semibold text-text-primary">
                          {po.poNo}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-body-sm',
                            overdue ? 'font-semibold text-st-warning' : 'text-text-secondary',
                          )}
                        >
                          ETA {formatDate(po.eta)}
                        </span>
                      </div>
                      <p className="truncate pt-0.5 text-body-sm text-text-secondary">
                        {supplierName(po.supplierId)}
                      </p>

                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${poCompletion(po)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <StatusBadge kind="po" status={po.status} overdue={overdue} />
                        <span className="text-body-sm tabular-nums text-text-secondary">
                          {po.lines.filter((l) => l.outstanding === '0').length}/{po.lines.length}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Detail — lines first, receipt history below. People open a PO to
                see what is still owed, not to read its past. */}
            {selected && (
              <section aria-label={`Detail ${selected.poNo}`} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-h3 font-semibold text-text-primary">{selected.poNo}</h2>
                    <p className="text-body-sm text-text-secondary">
                      {supplierName(selected.supplierId)} · ETA {formatDate(selected.eta)}
                    </p>
                  </div>
                  <StatusBadge kind="po" status={selected.status} />
                </div>

                <div className="divide-y divide-border rounded-card border border-border bg-card px-card">
                  {selected.lines.map((line) => (
                    <PoLineRow
                      key={line.lineId}
                      line={line}
                      productName={productName(line.productId)}
                    />
                  ))}
                </div>

                <p className="text-body-sm text-text-secondary">
                  {selected.receiptCount} receipt{selected.receiptCount === 1 ? '' : 's'} recorded
                  {selected.lastReceiptDate && ` · last ${formatDate(selected.lastReceiptDate)}`}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/o/purchase-orders/${selected.purchaseOrderId}/edit`)}
                  >
                    Edit
                  </Button>
                </div>

                {selected.closedReason ? (
                  <p className="rounded-sm bg-secondary px-4 py-3 text-body-sm text-text-secondary">
                    Closed — {selected.closedReason}
                  </p>
                ) : (
                  selected.totalOutstanding !== '0' && (
                    <Button variant="outline" onClick={() => setClosing(selected)}>
                      Close PO
                    </Button>
                  )
                )}
              </section>
            )}
          </div>
        )}
      </div>

      <Dialog open={Boolean(closing)} onOpenChange={(open) => !open && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {closing?.poNo} with quantity outstanding?</DialogTitle>
          </DialogHeader>
          <p className="text-body-sm text-text-secondary">
            {closing?.totalOutstanding} still owed, {closing?.totalDefect} of it marked defective.
            The reason is recorded and cannot be edited afterwards.
          </p>
          <ReasonPicker
            label="Why is it being closed?"
            required
            reasons={config.reasons.poClose}
            value={closeReason}
            onChange={setCloseReason}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <Button disabled={!closeReason} onClick={() => void closePo()}>
              Close purchase order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
