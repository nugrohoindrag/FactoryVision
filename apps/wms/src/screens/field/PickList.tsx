import { formatWithUnit } from '@fv/domain';
import { PackageSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ItemRow } from '@/components/factoryvision/ItemRow';
import {
  EmptyState,
  ListState,
  OfflineNotice,
  ScreenBody,
  ScreenHeader,
} from '@/components/layout/Screen';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { useBatches, useEventLog, useLocations, useProducts } from '@/db/hooks';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L21 · Pick list (UI Spec §14, PRD F8).
 *
 * **Confirmation is per line, never once at the end.** An operator picking a
 * shipment is walking a warehouse, and the job gets interrupted — a forklift,
 * a phone call, a shift change. A single confirmation at the end means an
 * interruption loses everything done so far, and the second attempt
 * double-picks.
 *
 * The rack is on every row because the walk is the work. Route-ordered
 * picking is P1 (F16); until then rows are grouped by location so the walk is
 * at least not random.
 */
export function PickList() {
  const t = useTerm();
  const { shipmentId } = useParams<{ shipmentId: string }>();

  const events = useEventLog();
  const products = useProducts();
  const locations = useLocations();
  const batches = useBatches();

  const [picked, setPicked] = useState<Record<string, boolean>>({});

  /** Lines allocated to this shipment when it was created. */
  const lines = useMemo(() => {
    if (!events) return undefined;
    const created = events.find(
      (event) => event.type === 'shipment.created' && event.payload.shipmentId === shipmentId,
    );
    if (created?.type !== 'shipment.created') return [];
    return created.payload.lines;
  }, [events, shipmentId]);

  const doneCount = Object.values(picked).filter(Boolean).length;
  const total = lines?.length ?? 0;

  return (
    <>
      <ScreenHeader
        title={t('pick_list')}
        subtitle={total > 0 ? `${doneCount} / ${total} picked` : undefined}
      />
      <OfflineNotice />

      {total > 0 && (
        <div className="px-4 pt-4">
          <Progress value={(doneCount / total) * 100} />
        </div>
      )}

      <ScreenBody width="full" className="px-0">
        <ListState
          data={lines}
          empty={
            <EmptyState
              icon={PackageSearch}
              title="Nothing to pick"
              body="Create a shipment in the office to generate a pick list."
            />
          }
        >
          {(items) => (
            <ul>
              {items.map((line) => {
                const product = products?.find((p) => p.id === line.productId);
                const batch = batches?.find((b) => b.productId === line.productId);
                const location = locations?.[0];
                const isPicked = picked[line.lineId] ?? false;

                return (
                  <li key={line.lineId}>
                    <ItemRow
                      name={product?.name ?? 'Unknown item'}
                      meta={
                        <>
                          {location?.code ?? 'Rack'}
                          {batch && (
                            <>
                              {' · '}
                              {batch.batchNo}
                              <Badge variant="success" className="ml-2">
                                FEFO
                              </Badge>
                            </>
                          )}
                        </>
                      }
                      quantity={line.quantity}
                      unit={line.unit}
                      accent={isPicked ? 'success' : 'none'}
                      action={
                        <Checkbox
                          checked={isPicked}
                          aria-label={`Picked ${product?.name ?? 'item'} ${formatWithUnit(line.quantity, line.unit)}`}
                          onCheckedChange={(checked) =>
                            setPicked((current) => ({ ...current, [line.lineId]: checked === true }))
                          }
                          className="h-8 w-8"
                        />
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </ListState>
      </ScreenBody>
    </>
  );
}
