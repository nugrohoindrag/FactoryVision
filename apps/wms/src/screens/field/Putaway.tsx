import { formatWithUnit, gt, sub, ZERO, type Qty } from '@fv/domain';
import { Warehouse } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LocationPicker } from '@/components/factoryvision/LocationPicker';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import {
  ActionBar,
  EmptyState,
  ListState,
  OfflineNotice,
  ScreenBody,
  ScreenHeader,
} from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ItemRow } from '@/components/factoryvision/ItemRow';
import { useEventLog, useLocations, useProducts, useStock } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L11 · Putaway (UI Spec §10, PRD F4).
 *
 * Assigns a physical rack to goods that have passed inspection.
 *
 * One batch may be spread across several racks — that is normal, not an
 * exception — so the remainder stays on screen until it reaches zero.
 * **No batch may go missing between inspection and the rack**; leaving a
 * partially placed batch invisible is precisely how stock and reality drift
 * apart (problem M1).
 *
 * The rack this item was last put in is suggested first, because putting the
 * same material back in the same place is right far more often than not.
 */
export function Putaway() {
  const t = useTerm();
  const append = useAppend();
  const config = useTenantConfig();

  const stock = useStock();
  const products = useProducts();
  const locations = useLocations();
  const events = useEventLog();

  const [selectedKey, setSelectedKey] = useState<string>();
  const [locationId, setLocationId] = useState<string>();
  const [quantity, setQuantity] = useState<Qty>(ZERO);
  const [saving, setSaving] = useState(false);

  /** Available stock still sitting in receiving — that is what needs putting away. */
  const pending = useMemo(
    () =>
      stock?.filter(
        (level) =>
          level.status === 'AVAILABLE' && level.locationId === config.receivingLocationId,
      ),
    [stock, config.receivingLocationId],
  );

  const selected = pending?.find((level) => level.key === selectedKey);
  const product = products?.find((p) => p.id === selected?.productId);

  /** Where this product went last time. */
  const suggestedIds = useMemo(() => {
    if (!events || !selected) return [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]!;
      if (event.type === 'putaway.completed' && event.payload.ref.productId === selected.productId) {
        return [event.payload.toLocationId];
      }
    }
    return [];
  }, [events, selected]);

  const remainder = selected ? sub(selected.quantity, quantity) : ZERO;
  const overAllocated = selected ? gt(quantity, selected.quantity) : false;

  const confirm = async () => {
    if (!selected || !locationId || quantity === ZERO || overAllocated) return;
    setSaving(true);
    try {
      await append('putaway.completed', {
        ref: {
          productId: selected.productId,
          batchId: selected.batchId,
          locationId: selected.locationId,
          status: selected.status,
        },
        quantity,
        toLocationId: locationId,
      });
      // Anything left keeps showing until it is placed — nothing goes missing.
      setQuantity(ZERO);
      setLocationId(undefined);
      if (remainder === ZERO) setSelectedKey(undefined);
    } finally {
      setSaving(false);
    }
  };

  if (selected) {
    return (
      <>
        <ScreenHeader title={t('putaway')} />
        <OfflineNotice />

        <ScreenBody className="space-y-6">
          <Card>
            <CardContent className="p-card">
              <h2 className="text-title font-semibold text-text-primary">
                {product?.name ?? 'Unknown item'}
              </h2>
              <p className="pt-1 text-body-sm text-text-secondary">{product?.sku}</p>
              <p className="pt-3 text-h3 font-semibold tabular-nums text-text-primary">
                {formatWithUnit(selected.quantity, product?.baseUnit ?? '')} to place
              </p>
            </CardContent>
          </Card>

          <LocationPicker
            label={t('field_location')}
            required
            locations={locations}
            value={locationId}
            onChange={setLocationId}
            suggestedIds={suggestedIds}
            suggestedLabel="Where it went last time"
          />

          <QuantityInput
            label="Quantity to this location"
            value={quantity}
            onChange={setQuantity}
            unit={product?.baseUnit ?? ''}
            max={selected.quantity}
            error={overAllocated ? 'That is more than is waiting to be placed.' : undefined}
            hint={
              quantity !== ZERO && !overAllocated
                ? `${formatWithUnit(remainder, product?.baseUnit ?? '')} will still need a rack.`
                : 'One batch can be split across several racks.'
            }
          />
        </ScreenBody>

        <ActionBar>
          <Button
            className="flex-1"
            size="lg"
            loading={saving}
            disabled={!locationId || quantity === ZERO || overAllocated}
            onClick={() => void confirm()}
          >
            Confirm putaway
          </Button>
          <Button variant="outline" size="lg" onClick={() => setSelectedKey(undefined)}>
            {t('action_back')}
          </Button>
        </ActionBar>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title={t('putaway')} back={false} />
      <OfflineNotice />

      <ListState
        data={pending}
        empty={
          <EmptyState
            icon={Warehouse}
            title="Nothing waiting for a rack"
            body="Goods appear here once they have passed inspection."
          />
        }
      >
        {(items) => (
          <ul>
            {items.map((level) => {
              const itemProduct = products?.find((p) => p.id === level.productId);
              return (
                <li key={level.key}>
                  <ItemRow
                    name={itemProduct?.name ?? 'Unknown item'}
                    meta={itemProduct?.sku}
                    quantity={level.quantity}
                    unit={itemProduct?.baseUnit ?? ''}
                    onClick={() => {
                      setSelectedKey(level.key);
                      setQuantity(level.quantity);
                    }}
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
