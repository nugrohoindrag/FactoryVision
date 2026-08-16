import { computeVariance, formatMoney, projectCounts, adjustmentsFromVariance } from '@fv/domain';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { VarianceTable } from '@/components/factoryvision/VarianceTable';
import { EmptyState } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useEventLog, useProducts, useStock } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useSession } from '@/app/session';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * K08 · Variance report (UI Spec §16, PRD F10).
 *
 * The reconciliation, and the first screen in this flow that may show the
 * system figure — the blind count is over by the time anyone gets here.
 *
 * **Ordered by rupiah impact, descending.** That ordering is the report's
 * entire value: it tells an owner which three lines to investigate, out of
 * five hundred counted.
 *
 * Approving does not silently correct stock. It posts adjustments as events,
 * each with the stock take as its reason — so the correction is as auditable
 * as the movement that caused it.
 */
export function VarianceReport() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const config = useTenantConfig();
  const user = useSession((s) => s.user);
  const { sessionId } = useParams<{ sessionId: string }>();

  const events = useEventLog();
  const stock = useStock();
  const products = useProducts();
  const [submitting, setSubmitting] = useState(false);

  /** The most recent session, when the route does not name one. */
  const activeSessionId = useMemo(() => {
    if (sessionId) return sessionId;
    for (let i = (events?.length ?? 0) - 1; i >= 0; i -= 1) {
      const event = events![i]!;
      if (event.type === 'stock_take.session_created') return event.payload.sessionId;
    }
    return undefined;
  }, [events, sessionId]);

  const summary = useMemo(() => {
    if (!events || !stock || !products || !activeSessionId) return undefined;
    const counts = projectCounts(events, activeSessionId);
    const costs = Object.fromEntries(products.map((p) => [p.id, p.averageCost]));
    return computeVariance(counts, stock, costs, config.defaults.recountThresholdPercent);
  }, [events, stock, products, activeSessionId, config.defaults.recountThresholdPercent]);

  const submit = async () => {
    if (!summary || !activeSessionId) return;
    setSubmitting(true);
    try {
      await append('stock_take.approved', {
        sessionId: activeSessionId,
        approvedBy: user.id,
        adjustments: adjustmentsFromVariance(summary),
      });
      navigate('/o/approvals');
    } finally {
      setSubmitting(false);
    }
  };

  if (!summary || summary.countedLines === 0) {
    return (
      <EmptyState
        title="No counts recorded yet"
        body="Start a stock take session and have someone count. The variance appears here as counts arrive."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">{t('screen_variance_report')}</h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          Ordered by rupiah impact. The biggest number is the one worth investigating, not the
          biggest quantity.
        </p>
      </header>

      {/* Three numbers an owner reads before the table. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-card">
            <p className="text-body-sm text-text-secondary">Total value at stake</p>
            <p className="pt-1 text-h3 font-semibold tabular-nums text-text-primary">
              {formatMoney(summary.totalValueImpact)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-card">
            <p className="text-body-sm text-text-secondary">Items with a variance</p>
            <p className="pt-1 text-h3 font-semibold tabular-nums text-text-primary">
              {summary.itemsWithVariance} of {summary.countedLines}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-card">
            <p className="text-body-sm text-text-secondary">Accuracy</p>
            <p className="pt-1 text-h3 font-semibold tabular-nums text-text-primary">
              {summary.accuracyPercent}%
            </p>
          </CardContent>
        </Card>
      </div>

      {summary.recountRequired > 0 && (
        <p className="rounded-sm bg-st-warning-bg px-4 py-3 text-body-sm text-st-warning-fg">
          {summary.recountRequired} line(s) are above the {config.defaults.recountThresholdPercent}%
          threshold and have been queued for an automatic recount. Approving now would post figures
          that have only been counted once.
        </p>
      )}

      <VarianceTable lines={summary.lines} products={products ?? []} />

      <Button
        size="lg"
        loading={submitting}
        disabled={summary.itemsWithVariance === 0}
        onClick={() => void submit()}
      >
        Submit for approval
      </Button>
    </div>
  );
}
