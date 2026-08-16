import { formatAge } from '@fv/domain';
import { PackageCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ItemRow } from '@/components/factoryvision/ItemRow';
import { EmptyState, ListState, OfflineNotice, ScreenHeader } from '@/components/layout/Screen';
import { useEventLog, useProducts, useStock } from '@/db/hooks';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L09 · Inspection queue (UI Spec §9).
 *
 * QC sees what is waiting, **oldest first, and the order cannot be changed**.
 * Sorting by anything else lets easy items be cherry-picked while a pallet
 * sits in receiving for a fortnight — which is problem M4 (PRD §3) wearing a
 * different hat.
 *
 * Waiting time is the prominent number, and turns red past the tenant's
 * quarantine warning threshold (7 days by default).
 */
export function InspectionQueue() {
  const t = useTerm();
  const navigate = useNavigate();
  const stock = useStock();
  const products = useProducts();
  const events = useEventLog();
  const config = useTenantConfig();

  /** When each awaiting-inspection line arrived, from the receipt event. */
  const arrivedAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events ?? []) {
      if (event.type !== 'goods_receipt.item_added') continue;
      const key = [event.payload.productId, event.payload.batchId, event.payload.locationId].join('|');
      if (!map.has(key)) map.set(key, event.occurredAt);
    }
    return map;
  }, [events]);

  const queue = useMemo(() => {
    if (!stock) return undefined;
    const now = Date.now();
    return stock
      .filter((level) => level.status === 'AWAITING INSPECTION')
      .map((level) => {
        const key = [level.productId, level.batchId ?? '-', level.locationId].join('|');
        const arrived = arrivedAt.get(key);
        const ageHours = arrived
          ? Math.max(0, Math.floor((now - new Date(arrived).getTime()) / 3_600_000))
          : 0;
        return { level, ageHours };
      })
      // Oldest first. Not sortable — that is the point.
      .sort((a, b) => b.ageHours - a.ageHours);
  }, [stock, arrivedAt]);

  const overdueHours = config.defaults.quarantineWarningDays * 24;

  return (
    <>
      <ScreenHeader title={t('screen_inspection_queue')} back={false} />
      <OfflineNotice />

      <ListState
        data={queue}
        empty={
          <EmptyState
            icon={PackageCheck}
            title="No items waiting for inspection"
            body="Deliveries appear here as soon as the warehouse records them."
          />
        }
      >
        {(items) => (
          <ul>
            {items.map(({ level, ageHours }) => {
              const product = products?.find((p) => p.id === level.productId);
              const overdue = ageHours >= overdueHours;
              return (
                <li key={level.key}>
                  <ItemRow
                    name={product?.name ?? 'Unknown item'}
                    meta={product?.sku}
                    quantity={level.quantity}
                    unit={product?.baseUnit ?? ''}
                    quantityNote={`waiting ${formatAge(ageHours)}`}
                    accent={overdue ? 'danger' : 'none'}
                    onClick={() => navigate(`/f/inspection/${encodeURIComponent(level.key)}`)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </ListState>
    </>
  );
}
