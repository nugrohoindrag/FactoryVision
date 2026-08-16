import type { StockStatus } from '@fv/contracts';
import { formatDate, formatTimestamp, formatWithUnit, totalQuantity } from '@fv/domain';
import { Boxes, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/app/session';
import { ItemRow } from '@/components/factoryvision/ItemRow';
import { StatusBadge } from '@/components/factoryvision/StatusBadge';
import { EmptyState, ListState, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useBatches, useEventLog, useLocations, useProducts, useStock } from '@/db/hooks';
import { EVENT_LABELS } from '@/components/factoryvision/OfflineQueueList';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L12 · Stock & batch card (UI Spec §10, PRD F4).
 *
 * Answers "how much of this is there, where, and in which batch" — and then,
 * for one batch, the whole story of how it got there.
 *
 * The movement history is **read from the event log**, not from a separate
 * history table. That is the dividend of the event-sourced decision (PRD §8):
 * the audit trail is not a feature that had to be built, it is what the data
 * already is.
 *
 * Purchase price is hidden from Operator and Production (PRD F13). This screen
 * shows quantities to everyone and money to nobody who may not see it.
 *
 * Open question P-06 (is WIP warehouse stock, or only `IN PRODUCTION`?) does
 * not block this screen: `IN PRODUCTION` is shown as one status among the
 * others, which is true under either answer.
 */
export function StockCard() {
  const t = useTerm();
  const role = useSession((s) => s.user.role);

  const stock = useStock();
  const products = useProducts();
  const locations = useLocations();
  const batches = useBatches();
  const events = useEventLog();

  const [query, setQuery] = useState('');
  const [openProductId, setOpenProductId] = useState<string>();

  const canSeeValue = role === 'WAREHOUSE_HEAD' || role === 'OWNER';

  /** One row per product, with the split by status kept for the detail view. */
  const rows = useMemo(() => {
    if (!stock || !products) return undefined;
    const needle = query.trim().toLowerCase();

    return products
      .map((product) => {
        const levels = stock.filter((l) => l.productId === product.id);
        return {
          product,
          levels,
          total: totalQuantity(levels, { productId: product.id }),
        };
      })
      .filter((row) => row.levels.length > 0)
      .filter(
        (row) =>
          needle === '' ||
          row.product.name.toLowerCase().includes(needle) ||
          row.product.sku.toLowerCase().includes(needle),
      );
  }, [stock, products, query]);

  const openRow = rows?.find((row) => row.product.id === openProductId);

  /** Every movement that touched this product, newest first. */
  const history = useMemo(() => {
    if (!events || !openProductId) return [];
    return events
      .filter((event) => JSON.stringify(event.payload).includes(openProductId))
      .slice(-50)
      .reverse();
  }, [events, openProductId]);

  if (openRow) {
    const { product, levels, total } = openRow;

    return (
      <>
        <ScreenHeader
          title={product.name}
          subtitle={product.sku}
          action={
            <Button variant="ghost" onClick={() => setOpenProductId(undefined)}>
              Close
            </Button>
          }
        />
        <OfflineNotice />

        <ScreenBody className="space-y-6">
          <Card>
            <CardContent className="p-card">
              <p className="text-body-sm text-text-secondary">Total on hand</p>
              <p className="pt-1 text-h1 font-semibold tabular-nums text-text-primary">
                {formatWithUnit(total, product.baseUnit)}
              </p>
              {canSeeValue && product.averageCost && (
                <p className="pt-1 text-body-sm text-text-secondary">
                  at {formatWithUnit(product.averageCost, 'per ' + product.baseUnit)}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Split by status, then by batch and rack — the three questions. */}
          <section>
            <h2 className="pb-3 text-title font-semibold text-text-primary">Where it is</h2>
            <ul className="overflow-hidden rounded-card border border-border">
              {levels.map((level) => {
                const batch = batches?.find((b) => b.id === level.batchId);
                const location = locations?.find((l) => l.id === level.locationId);
                return (
                  <li key={level.key}>
                    <ItemRow
                      name={location?.name ?? 'Unknown location'}
                      meta={
                        <>
                          {location?.code}
                          {batch && ` · ${batch.batchNo}`}
                          {batch?.expiryDate && ` · exp ${formatDate(batch.expiryDate)}`}
                        </>
                      }
                      quantity={level.quantity}
                      unit={product.baseUnit}
                      status={<StatusBadge kind="stock" status={level.status as StockStatus} />}
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h2 className="pb-3 text-title font-semibold text-text-primary">Movement history</h2>
            {history.length === 0 ? (
              <p className="text-body-sm text-text-secondary">
                No movements recorded on this device yet.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
                {history.map((event) => (
                  <li key={event.id} className="bg-card px-4 py-3">
                    <p className="text-body text-text-primary">
                      {EVENT_LABELS[event.type] ?? event.type}
                    </p>
                    <p className="text-body-sm text-text-secondary">
                      {formatTimestamp(event.occurredAt)} · {event.actorRole.toLowerCase()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </ScreenBody>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title={t('stock_card')} back={false} />
      <OfflineNotice />

      <div className="border-b border-border bg-card p-4">
        <div className="relative">
          <Search
            size={20}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item or code"
            className="pl-12"
            aria-label={t('field_item')}
          />
        </div>
      </div>

      <ListState
        data={rows}
        empty={
          <EmptyState
            icon={Boxes}
            title={query ? 'Nothing matches that' : 'No stock recorded yet'}
            body={
              query
                ? 'Check the code on the sack, or clear the search.'
                : 'Stock appears here once a delivery has been received and put away.'
            }
          />
        }
      >
        {(items) => (
          <ul>
            {items.map(({ product, total, levels }) => (
              <li key={product.id}>
                <ItemRow
                  name={product.name}
                  meta={`${product.sku} · ${levels.length} location${levels.length === 1 ? '' : 's'}`}
                  quantity={total}
                  unit={product.baseUnit}
                  onClick={() => setOpenProductId(product.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </ListState>
    </>
  );
}
