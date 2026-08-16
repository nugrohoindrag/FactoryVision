import type { InspectionDecision as Decision } from '@fv/contracts';
import { formatWithUnit, gt, ZERO, type Qty } from '@fv/domain';
import { Ban, Check, PauseCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { ReasonPicker } from '@/components/factoryvision/ReasonPicker';
import {
  ActionBar,
  ErrorState,
  LoadingRows,
  OfflineNotice,
  ScreenBody,
  ScreenHeader,
} from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useProducts, useStock } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * L10 · Inspection decision ⚠️ (UI Spec §9, acceptance §23.3).
 *
 * **A full pass is two taps, total: `Pass`, then `Confirm`.** Nothing may be
 * added to that path — no reason, no quantity, no confirmation dialog. QC
 * passes far more than it holds, and every extra tap on the common path is
 * paid hundreds of times a week.
 *
 * A reason is mandatory only where it earns its cost: `Hold` and `Reject`.
 * Those are the decisions somebody will be asked to justify later.
 *
 * Partial pass exists because 80 good sacks out of 100 is the normal case,
 * not an exception — and the remaining 20 must land in quarantine rather than
 * quietly disappearing.
 */
export function InspectionDecision() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const config = useTenantConfig();
  const { lineId } = useParams<{ lineId: string }>();

  const stock = useStock();
  const products = useProducts();

  const [decision, setDecision] = useState<Decision>();
  const [partial, setPartial] = useState(false);
  const [passQuantity, setPassQuantity] = useState<Qty>(ZERO);
  const [reason, setReason] = useState<string>();
  const [note, setNote] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const level = stock?.find((l) => l.key === decodeURIComponent(lineId ?? ''));
  const product = products?.find((p) => p.id === level?.productId);

  const needsReason = decision === 'HOLD' || decision === 'REJECT';
  const quantity = partial && decision === 'PASS' ? passQuantity : (level?.quantity ?? ZERO);
  const remainder =
    partial && level && gt(level.quantity, passQuantity)
      ? formatWithUnit(
          (Number(level.quantity) - Number(passQuantity)).toString(),
          product?.baseUnit ?? '',
        )
      : undefined;

  const confirm = async () => {
    setTouched(true);
    if (!decision || !level || (needsReason && !reason)) return;

    setSaving(true);
    try {
      const ref = {
        productId: level.productId,
        batchId: level.batchId,
        locationId: level.locationId,
        status: level.status,
      };

      await append('inspection.decided', {
        receiptLineId: level.key,
        ref,
        decision,
        quantity,
        reasonCode: reason,
        note: note.trim() || undefined,
        photoIds,
      });

      // The remainder of a partial pass goes to quarantine — never lost.
      if (partial && decision === 'PASS' && gt(level.quantity, passQuantity)) {
        await append('inspection.decided', {
          receiptLineId: level.key,
          ref,
          decision: 'HOLD',
          quantity: (Number(level.quantity) - Number(passQuantity)).toString(),
          reasonCode: 'Remainder of a partial pass',
          photoIds: [],
        });
      }

      navigate('/f/inspection');
    } finally {
      setSaving(false);
    }
  };

  if (stock === undefined || products === undefined) {
    return (
      <>
        <ScreenHeader title={t('inspection')} />
        <LoadingRows rows={2} />
      </>
    );
  }

  if (!level) {
    return (
      <>
        <ScreenHeader title={t('inspection')} />
        <ErrorState
          title="That line is no longer waiting"
          body="Someone may have inspected it already. Open the queue to see what is left."
          onRetry={() => navigate('/f/inspection')}
        />
      </>
    );
  }

  const CHOICES: { value: Decision; label: string; icon: typeof Check; classes: string }[] = [
    // The foreground comes from the palette's `-on` token, not a blanket
    // `text-white`: the v5.0 fills are vivid, and white on `st-success` is
    // 3.30:1 — below AA, in the exact glare this screen is used in.
    { value: 'PASS', label: t('pass'), icon: Check, classes: 'bg-st-success text-st-success-on' },
    {
      value: 'HOLD',
      label: t('hold'),
      icon: PauseCircle,
      classes: 'bg-st-maintenance text-st-maintenance-on',
    },
    { value: 'REJECT', label: t('reject'), icon: Ban, classes: 'bg-st-danger text-st-danger-on' },
  ];

  return (
    <>
      <ScreenHeader title={t('inspection')} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        <Card>
          <CardContent className="p-card">
            <h2 className="text-title font-semibold text-text-primary">
              {product?.name ?? 'Unknown item'}
            </h2>
            <p className="pt-1 text-body-sm text-text-secondary">{product?.sku}</p>
            <p className="pt-3 text-h3 font-semibold tabular-nums text-text-primary">
              {formatWithUnit(level.quantity, product?.baseUnit ?? '')}
            </p>
          </CardContent>
        </Card>

        {/* Three large targets, side by side. Tap one — that is the first tap. */}
        <div className="grid grid-cols-3 gap-3">
          {CHOICES.map((choice) => {
            const active = decision === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setDecision(choice.value);
                  setPartial(false);
                  setReason(undefined);
                }}
                className={cn(
                  'flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-card border-2 text-body font-semibold',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? `${choice.classes} border-transparent`
                    : 'border-border bg-card text-text-primary',
                )}
              >
                <choice.icon size={28} aria-hidden />
                {choice.label}
              </button>
            );
          })}
        </div>

        {/* Partial pass is offered, never imposed — it would cost the fast path. */}
        {decision === 'PASS' && (
          <div className="space-y-4">
            <Button
              type="button"
              variant={partial ? 'default' : 'outline'}
              className="w-full"
              aria-pressed={partial}
              onClick={() => {
                setPartial((on) => !on);
                setPassQuantity(level.quantity);
              }}
            >
              Only part of it passed
            </Button>

            {partial && (
              <>
                <QuantityInput
                  label="Quantity that passed"
                  value={passQuantity}
                  onChange={setPassQuantity}
                  unit={product?.baseUnit ?? ''}
                  max={level.quantity}
                />
                {remainder && (
                  <p className="rounded-sm bg-st-maintenance-bg px-4 py-3 text-body-sm text-st-maintenance-fg">
                    {remainder} goes to {t('quarantine')}. It stays visible in reports and cannot be
                    issued to production.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {needsReason && (
          <ReasonPicker
            label={t('field_reason')}
            required
            reasons={config.reasons.qcRejection}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            photoIds={photoIds}
            onPhotosChange={setPhotoIds}
            error={
              touched && !reason
                ? 'Choose a reason. This is what the supplier will be shown.'
                : undefined
            }
          />
        )}
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          disabled={!decision}
          loading={saving}
          onClick={() => void confirm()}
        >
          {t('action_confirm')}
        </Button>
      </ActionBar>
    </>
  );
}
