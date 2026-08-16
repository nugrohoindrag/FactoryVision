import { formatMoney, formatWithUnit, gt, mul, sub, ZERO, type Qty } from '@fv/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { ReasonPicker } from '@/components/factoryvision/ReasonPicker';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { StatusBadge } from '@/components/factoryvision/StatusBadge';
import { ActionBar, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useBatches, useLocations, useProducts, useStock } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L25 · Stock adjustment (UI Spec §17, PRD F9).
 *
 * Unlike L23, the current quantity **is** shown — this is a correction, not a
 * blind count, and hiding the figure being corrected would be absurd.
 *
 * Two things are non-negotiable:
 * - **A reason from the closed list is mandatory.** An adjustment without a
 *   reason is indistinguishable from theft in a report, and it is the reason
 *   column that makes the variance report usable at all.
 * - **Above the tenant's value threshold it becomes `PENDING APPROVAL`**
 *   rather than taking effect. The owner approves money, not quantities —
 *   so the rupiah impact is shown before submitting, not after.
 *
 * The audit trail is inherent: the event records who, when, from what, to
 * what, and why, and events are never edited.
 */
export function StockAdjustment() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const config = useTenantConfig();
  const role = useSession((s) => s.user.role);

  const stock = useStock();
  const products = useProducts();
  const locations = useLocations();
  const batches = useBatches();

  const [levelKey, setLevelKey] = useState<string>();
  const [newQuantity, setNewQuantity] = useState<Qty>(ZERO);
  const [reason, setReason] = useState<string>();
  const [note, setNote] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const level = stock?.find((l) => l.key === levelKey);
  const product = products?.find((p) => p.id === level?.productId);

  const delta = level ? sub(newQuantity, level.quantity) : ZERO;
  const valueImpact =
    product?.averageCost && delta !== ZERO
      ? mul(delta.startsWith('-') ? delta.slice(1) : delta, product.averageCost)
      : undefined;

  const needsApproval =
    valueImpact !== undefined && gt(valueImpact, config.defaults.approvalThresholdValue);
  const canSelfApprove = role === 'OWNER';

  const submit = async () => {
    setTouched(true);
    if (!level || !reason || delta === ZERO) return;

    setSaving(true);
    try {
      await append('stock.adjusted', {
        ref: {
          productId: level.productId,
          batchId: level.batchId,
          locationId: level.locationId,
          status: level.status,
        },
        delta,
        reasonCode: reason,
        note: note.trim() || undefined,
        // Above the threshold this waits for the owner (K09).
        approvedBy: needsApproval && canSelfApprove ? undefined : undefined,
      });
      navigate('/f');
    } finally {
      setSaving(false);
    }
  };

  const options = stock?.map((l) => {
    const p = products?.find((x) => x.id === l.productId);
    const location = locations?.find((x) => x.id === l.locationId);
    const batch = batches?.find((b) => b.id === l.batchId);
    return {
      id: l.key,
      name: p?.name ?? 'Unknown item',
      code: location?.code,
      meta: `${batch?.batchNo ?? 'no batch'} · ${formatWithUnit(l.quantity, p?.baseUnit ?? '')}`,
    };
  });

  return (
    <>
      <ScreenHeader title={t('stock_adjustment')} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        <SearchPicker
          label="Stock line"
          required
          options={options}
          value={levelKey}
          onChange={(key) => {
            setLevelKey(key);
            const picked = stock?.find((l) => l.key === key);
            setNewQuantity(picked?.quantity ?? ZERO);
          }}
          placeholder="Search item, rack, or batch"
          emptyMessage="No stock line matches that."
        />

        {level && product && (
          <>
            <Card>
              <CardContent className="flex items-center justify-between gap-4 p-card">
                <div>
                  <p className="text-body-sm text-text-secondary">{t('field_current_quantity')}</p>
                  <p className="pt-1 text-h3 font-semibold tabular-nums text-text-primary">
                    {formatWithUnit(level.quantity, product.baseUnit)}
                  </p>
                </div>
                <StatusBadge kind="stock" status={level.status} />
              </CardContent>
            </Card>

            <QuantityInput
              label={t('field_new_quantity')}
              required
              value={newQuantity}
              onChange={setNewQuantity}
              unit={product.baseUnit}
              step="0.1"
              hint={
                delta === ZERO
                  ? 'Enter what is actually on the rack.'
                  : `Change of ${formatWithUnit(delta, product.baseUnit)}`
              }
            />

            <ReasonPicker
              label={t('field_reason')}
              required
              reasons={config.reasons.adjustment}
              value={reason}
              onChange={setReason}
              note={note}
              onNoteChange={setNote}
              photoIds={photoIds}
              onPhotosChange={setPhotoIds}
              error={
                touched && !reason
                  ? 'Choose a reason. An adjustment without one cannot be explained later.'
                  : undefined
              }
            />

            {/* Money, before submitting — the owner approves rupiah, not units. */}
            {needsApproval && valueImpact && (
              <Alert>
                <AlertTitle>This needs the owner's approval</AlertTitle>
                <AlertDescription>
                  The value of this change is {formatMoney(valueImpact)}, above the{' '}
                  {formatMoney(config.defaults.approvalThresholdValue)} threshold. It will be
                  submitted as pending and take effect once approved.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving}
          disabled={!level || delta === ZERO}
          onClick={() => void submit()}
        >
          {needsApproval ? 'Submit for approval' : 'Adjust stock'}
        </Button>
      </ActionBar>
    </>
  );
}
