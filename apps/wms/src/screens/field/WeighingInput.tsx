import { div, formatWithUnit, mul, sub, ZERO, type Qty } from '@fv/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { ActionBar, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useProducts } from '@/db/hooks';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L07 · Weighing input (UI Spec §8, PRD F2).
 *
 * For bulk material that is weighed rather than counted. The whole screen
 * exists because of one ambiguity that silently corrupts stock: **is the tare
 * weight per sack, or the total for the load?**
 *
 * Both conventions are used in real factories. Guessing wrong on 40 sacks of
 * flour at 0.4 kg tare is a 16 kg error that nobody notices until stock take.
 * So the choice is explicit and has no default that could be left unread.
 *
 * All arithmetic goes through big.js — a weighed quantity is exactly where
 * float drift enters a warehouse.
 */
export function WeighingInput() {
  const t = useTerm();
  const navigate = useNavigate();
  const products = useProducts();

  const [productId, setProductId] = useState<string>();
  const [gross, setGross] = useState<Qty>(ZERO);
  const [tare, setTare] = useState<Qty>(ZERO);
  const [sacks, setSacks] = useState<Qty>('1');
  const [tareMode, setTareMode] = useState<'per-sack' | 'total'>('per-sack');

  const product = products?.find((p) => p.id === productId);
  const unit = product?.baseUnit ?? 'kg';

  // Net = gross − (tare × sacks) when tare is per sack, else gross − tare.
  const totalTare = tareMode === 'per-sack' ? mul(tare, sacks || '0') : tare;
  const net = sub(gross, totalTare);
  const negative = net.startsWith('-');
  const perSack =
    sacks && sacks !== ZERO && !negative ? div(net, sacks) : undefined;

  return (
    <>
      <ScreenHeader title={t('field_net_weight')} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        <SearchPicker
          label={t('field_item')}
          required
          options={products?.map((p) => ({ id: p.id, name: p.name, code: p.sku, meta: p.baseUnit }))}
          value={productId}
          onChange={setProductId}
          placeholder="Search item or code"
        />

        <QuantityInput
          label={t('field_gross_weight')}
          required
          value={gross}
          onChange={setGross}
          unit={unit}
          step="0.5"
        />

        <QuantityInput
          label={t('field_sacks')}
          value={sacks}
          onChange={setSacks}
          unit="sak"
          min="1"
        />

        <div>
          <Label className="mb-2 block">{t('field_tare_weight')}</Label>
          {/* No default that can be scrolled past — the operator must choose. */}
          <RadioGroup
            value={tareMode}
            onValueChange={(value) => setTareMode(value as typeof tareMode)}
            className="pb-3"
          >
            <label className="flex min-h-touch items-center gap-3 text-body">
              <RadioGroupItem value="per-sack" />
              Tare is per sack
            </label>
            <label className="flex min-h-touch items-center gap-3 text-body">
              <RadioGroupItem value="total" />
              Tare is the total for this load
            </label>
          </RadioGroup>

          <QuantityInput
            label={tareMode === 'per-sack' ? 'Tare per sack' : 'Total tare'}
            value={tare}
            onChange={setTare}
            unit={unit}
            step="0.1"
          />
        </div>

        {/* Result shown large — this is the number that becomes stock. */}
        <section
          aria-live="polite"
          className="rounded-card border border-border bg-card p-card"
        >
          <p className="text-body-sm text-text-secondary">{t('field_net_weight')}</p>
          <p
            className={
              negative
                ? 'pt-1 text-h1 font-semibold tabular-nums text-st-danger'
                : 'pt-1 text-h1 font-semibold tabular-nums text-text-primary'
            }
          >
            {formatWithUnit(net, unit)}
          </p>
          {perSack && (
            <p className="pt-2 text-body-sm text-text-secondary">
              {formatWithUnit(perSack, unit)} per sack · tare total{' '}
              {formatWithUnit(totalTare, unit)}
            </p>
          )}
          {negative && (
            <p className="pt-2 text-body-sm text-st-danger">
              Tare is larger than the gross weight. Check which figure the scale gave you.
            </p>
          )}
        </section>
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          disabled={!product || negative || net === ZERO}
          onClick={() => navigate(-1)}
        >
          Use this weight
        </Button>
      </ActionBar>
    </>
  );
}
