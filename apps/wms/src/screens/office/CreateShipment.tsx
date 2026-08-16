import { formatWithUnit, gt, todayLocal, totalQuantity, ZERO, type Qty } from '@fv/domain';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DateField } from '@/components/factoryvision/DateField';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePartners, useProducts, useStock } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { useAppend } from '@/db/useAppend';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * K10 · Create shipment (UI Spec §14, PRD F8).
 *
 * **Allocation happens when the order is created, not when it is picked.**
 * That is the whole point of this screen: allocated stock cannot be taken by
 * another order, which is what stops two shipments fighting over the same
 * batch and discovering it at the loading bay.
 *
 * Availability per line is shown live, because promising a customer stock
 * that is already spoken for is a mistake made at exactly this moment.
 */

interface ShipmentLine {
  lineId: string;
  productId?: string;
  quantity: Qty;
  unit: string;
}

const emptyLine = (): ShipmentLine => ({ lineId: uuidv7(), quantity: ZERO, unit: '' });

export function CreateShipment() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();

  const customers = usePartners('CUSTOMER');
  const products = useProducts();
  const stock = useStock();

  const today = todayLocal();

  const [customerId, setCustomerId] = useState<string>();
  const [shipmentDate, setShipmentDate] = useState(today);
  const [lines, setLines] = useState<ShipmentLine[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  const setLine = (lineId: string, patch: Partial<ShipmentLine>) =>
    setLines((current) => current.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));

  const availableFor = (productId?: string): Qty =>
    productId && stock
      ? totalQuantity(stock, { productId, status: 'AVAILABLE' })
      : ZERO;

  const filled = lines.filter((l) => l.productId && l.quantity !== ZERO);
  const anyShort = filled.some((l) => gt(l.quantity, availableFor(l.productId)));
  const canCreate = Boolean(customerId) && filled.length > 0 && !anyShort;

  const create = async () => {
    if (!canCreate || !customerId) return;
    setSaving(true);
    try {
      const shipmentId = uuidv7();
      await append('shipment.created', {
        shipmentId,
        customerId,
        lines: filled.map((line) => {
          const product = products?.find((p) => p.id === line.productId);
          return {
            lineId: line.lineId,
            productId: line.productId!,
            quantity: line.quantity,
            unit: line.unit || product?.baseUnit || '',
          };
        }),
      });
      navigate(`/f/shipments/${shipmentId}/pick`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">{t('shipment')}</h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          Stock is allocated the moment this order is created. Another order cannot take it.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 md:max-w-2xl">
        <SearchPicker
          label={t('customer')}
          required
          options={customers?.map((c) => ({ id: c.id, name: c.name, code: c.code }))}
          value={customerId}
          onChange={setCustomerId}
          placeholder="Search customer"
          emptyMessage="No customer matches. Add them under Master data → Partners."
        />

        <DateField label="Shipment date" value={shipmentDate} onChange={setShipmentDate} min={today} />
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => {
          const product = products?.find((p) => p.id === line.productId);
          const available = availableFor(line.productId);
          const short = line.quantity !== ZERO && gt(line.quantity, available);

          return (
            <Card key={line.lineId}>
              <CardContent className="grid gap-4 pt-card md:grid-cols-[2fr_1fr_auto] md:items-end">
                <SearchPicker
                  label={t('field_item')}
                  options={products
                    ?.filter((p) => p.itemClass === 'FINISHED_GOODS')
                    .map((p) => ({ id: p.id, name: p.name, code: p.sku, meta: p.baseUnit }))}
                  value={line.productId}
                  onChange={(productId) => {
                    const picked = products?.find((p) => p.id === productId);
                    setLine(line.lineId, { productId, unit: picked?.baseUnit ?? '' });
                  }}
                  placeholder="Search finished goods"
                />

                <QuantityInput
                  label={t('field_quantity')}
                  value={line.quantity}
                  onChange={(quantity) => setLine(line.lineId, { quantity })}
                  unit={line.unit || product?.baseUnit || ''}
                  disabled={!line.productId}
                  error={short ? `Only ${formatWithUnit(available, line.unit)} available` : undefined}
                  hint={
                    line.productId && !short
                      ? `${formatWithUnit(available, line.unit)} available`
                      : undefined
                  }
                />

                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('action_remove')} line ${index + 1}`}
                    onClick={() => setLines((c) => c.filter((l) => l.lineId !== line.lineId))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Button variant="outline" onClick={() => setLines((c) => [...c, emptyLine()])}>
          <Plus aria-hidden />
          Add line
        </Button>
      </div>

      <Button size="lg" loading={saving} disabled={!canCreate} onClick={() => void create()}>
        Allocate &amp; create
      </Button>
    </div>
  );
}
