import { computeVariance, projectCounts, ZERO, type Qty } from '@fv/domain';
import { CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '@/app/session';
import { BlindCountInput } from '@/components/factoryvision/BlindCountInput';
import {
  ActionBar,
  EmptyState,
  LoadingRows,
  OfflineNotice,
  ScreenBody,
  ScreenHeader,
} from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { useEventLog, useLocations, useProducts, useStock } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L24 · Recount (UI Spec §16, PRD F10).
 *
 * **Triggered automatically, never chosen.** The counter is not asked whether
 * their count looked wrong — a variance above the tenant's threshold puts the
 * line back in the queue by itself. Letting the person who counted decide
 * whether to recount defeats the control entirely.
 *
 * Still blind. The first count is not shown either: seeing it would turn a
 * recount into a confirmation, and confirmation bias is exactly what a second
 * count is supposed to defeat.
 */
export function Recount() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const config = useTenantConfig();
  const user = useSession((s) => s.user);
  const { sessionId } = useParams<{ sessionId: string }>();

  const events = useEventLog();
  const stock = useStock();
  const products = useProducts();
  const locations = useLocations();

  const [counted, setCounted] = useState<Qty | ''>('');
  const [saving, setSaving] = useState(false);

  /** Lines the threshold flagged, not lines anyone chose. */
  const queue = useMemo(() => {
    if (!events || !stock || !products || !sessionId) return undefined;
    const counts = projectCounts(events, sessionId);
    const costs = Object.fromEntries(products.map((p) => [p.id, p.averageCost]));
    const summary = computeVariance(counts, stock, costs, config.defaults.recountThresholdPercent);
    return summary.lines.filter((line) => line.needsRecount);
  }, [events, stock, products, sessionId, config.defaults.recountThresholdPercent]);

  const current = queue?.[0];

  const save = async () => {
    if (!current || !sessionId) return;
    setSaving(true);
    try {
      await append('stock_take.counted', {
        sessionId,
        ref: current.ref,
        countedQuantity: counted === '' ? ZERO : counted,
        countedBy: user.id,
        // Round 2 supersedes round 1 in the projection.
        round: 2,
      });
      setCounted('');
    } finally {
      setSaving(false);
    }
  };

  if (queue === undefined) {
    return (
      <>
        <ScreenHeader title={t('recount')} />
        <LoadingRows rows={2} />
      </>
    );
  }

  if (!current) {
    return (
      <>
        <ScreenHeader title={t('recount')} />
        <EmptyState
          icon={CheckCircle2}
          title="Nothing needs recounting"
          body={`Every line came in within ${config.defaults.recountThresholdPercent}% of the system figure. The variance report is ready for review.`}
          action={<Button onClick={() => navigate('/f')}>{t('nav_home')}</Button>}
        />
      </>
    );
  }

  const product = products?.find((p) => p.id === current.ref.productId);
  const location = locations?.find((l) => l.id === current.ref.locationId);

  return (
    <>
      <ScreenHeader title={t('recount')} subtitle={`${queue.length} to recount`} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        <div className="rounded-card border border-border bg-card p-card">
          <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
            {location?.code ?? 'Location'} · {location?.name ?? ''}
          </p>
          <h2 className="pt-2 text-h3 font-semibold text-text-primary">
            {product?.name ?? 'Unknown item'}
          </h2>
          <p className="pt-1 text-body-sm text-text-secondary">{product?.sku}</p>
        </div>

        <p className="rounded-sm bg-st-warning-bg px-4 py-3 text-body-sm text-st-warning-fg">
          This line was flagged automatically because the first count differed from the system by
          more than {config.defaults.recountThresholdPercent}%. Count it again from scratch.
        </p>

        <BlindCountInput
          label={t('field_counted_quantity')}
          value={counted}
          onChange={setCounted}
          unit={product?.baseUnit ?? ''}
          autoFocus
        />

        <p className="text-body-sm text-text-secondary">
          Neither the system figure nor your first count is shown. That is deliberate — a recount
          that can see the first count is just a confirmation.
        </p>
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving}
          disabled={counted === ''}
          onClick={() => void save()}
        >
          {t('action_next_item')}
        </Button>
      </ActionBar>
    </>
  );
}
