import { formatWithUnit, gt, ZERO, type Qty } from '@fv/domain';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LocationPicker } from '@/components/factoryvision/LocationPicker';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
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
import { useEventLog, useIssues, useLocations, useProducts } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L18 · Return material (UI Spec §12, PRD F6).
 *
 * Leftover material goes back to a NAMED rack, never to a vague "warehouse".
 * Material that returns without a location is material nobody can find, and
 * that is the same as material that never came back.
 *
 * The issued quantity stays on screen as the reference figure, because "how
 * much did I take?" is the question being answered.
 */
export function ReturnMaterial() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const { issueId } = useParams<{ issueId: string }>();

  const issues = useIssues();
  const products = useProducts();
  const locations = useLocations();
  const events = useEventLog();

  const [quantities, setQuantities] = useState<Record<string, Qty>>({});
  const [locationIds, setLocationIds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const issue = issueId ? issues?.get(issueId) : undefined;

  /** Where each material was picked from — the obvious place to put it back. */
  const originByLine = useMemo(() => {
    const map: Record<string, string> = {};
    for (const event of events ?? []) {
      if (event.type !== 'material_issue.prepared' || event.payload.issueId !== issueId) continue;
      for (const pick of event.payload.picks) map[pick.lineId] = pick.ref.locationId;
    }
    return map;
  }, [events, issueId]);

  const returnable = issue?.lines.filter((line) => gt(line.issued, line.returned)) ?? [];

  const submit = async () => {
    if (!issue || !issueId) return;
    const returns = returnable
      .filter((line) => (quantities[line.lineId] ?? ZERO) !== ZERO)
      .map((line) => ({
        lineId: line.lineId,
        ref: {
          productId: line.productId,
          batchId: null,
          locationId: originByLine[line.lineId] ?? '',
          status: 'IN PRODUCTION' as const,
        },
        quantity: quantities[line.lineId]!,
        toLocationId: locationIds[line.lineId] ?? originByLine[line.lineId] ?? '',
      }))
      .filter((r) => r.toLocationId !== '');

    if (returns.length === 0) return;

    setSaving(true);
    try {
      await append('material_issue.returned', { issueId, returns });
      navigate(`/f/issues/${issueId}/close`);
    } finally {
      setSaving(false);
    }
  };

  if (issues === undefined || products === undefined) {
    return (
      <>
        <ScreenHeader title={t('material_return')} />
        <LoadingRows rows={3} />
      </>
    );
  }

  if (!issue) {
    return (
      <>
        <ScreenHeader title={t('material_return')} />
        <ErrorState
          title="That issue is not on this device"
          body="Open your open issues to find it."
          onRetry={() => navigate('/f/issues/mine')}
        />
      </>
    );
  }

  const anyEntered = returnable.some((line) => (quantities[line.lineId] ?? ZERO) !== ZERO);

  return (
    <>
      <ScreenHeader title={t('material_return')} subtitle={issue.workOrderNo} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        {returnable.map((line) => {
          const product = products.find((p) => p.id === line.productId);
          const entered = quantities[line.lineId] ?? ZERO;
          const tooMuch = gt(entered, line.issued);

          return (
            <Card key={line.lineId}>
              <CardContent className="space-y-4 pt-card">
                <div>
                  <h2 className="text-title font-semibold text-text-primary">
                    {product?.name ?? 'Unknown item'}
                  </h2>
                  <p className="pt-1 text-body-sm text-text-secondary">
                    {t('issued')} {formatWithUnit(line.issued, line.unit)}
                    {line.returned !== ZERO &&
                      ` · already returned ${formatWithUnit(line.returned, line.unit)}`}
                  </p>
                </div>

                <QuantityInput
                  label={t('field_quantity_returned')}
                  value={entered}
                  onChange={(quantity) =>
                    setQuantities((current) => ({ ...current, [line.lineId]: quantity }))
                  }
                  unit={line.unit}
                  step="0.1"
                  max={line.issued}
                  error={tooMuch ? 'That is more than was issued for this material.' : undefined}
                />

                <LocationPicker
                  label={t('field_location')}
                  required
                  locations={locations}
                  value={locationIds[line.lineId] ?? originByLine[line.lineId]}
                  onChange={(locationId) =>
                    setLocationIds((current) => ({ ...current, [line.lineId]: locationId }))
                  }
                  suggestedIds={originByLine[line.lineId] ? [originByLine[line.lineId]!] : []}
                  suggestedLabel="Where it came from"
                />
              </CardContent>
            </Card>
          );
        })}
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving}
          disabled={!anyEntered}
          onClick={() => void submit()}
        >
          {t('action_return_to_stock')}
        </Button>
      </ActionBar>
    </>
  );
}
