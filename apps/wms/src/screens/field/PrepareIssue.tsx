import { add, formatWithUnit, suggestFefo, toCandidates, todayLocal, ZERO, type FefoCandidate } from '@fv/domain';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BatchPicker } from '@/components/factoryvision/BatchPicker';
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
import { useBatches, useIssues, useLocations, useProducts, useStock } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L15 · Prepare issue, FEFO (UI Spec §11, PRD F5).
 *
 * Three rules with different strengths, and the difference is the design:
 *
 * - **FEFO is suggested.** The earliest-expiring batch is marked and pre-
 *   selected. Choosing differently is allowed — the operator can see the rack
 *   and we cannot — but it demands a reason, which is recorded.
 * - **Expired batches are blocked outright.** Not selectable at all. Owner
 *   approval is the only route past, exactly as PRD F5 requires.
 * - **Quarantined batches never appear.** They are not a choice to be made.
 *
 * The rack is shown on every batch because the operator is about to walk
 * there, and the walk is most of the time this task takes.
 */
export function PrepareIssue() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const { issueId } = useParams<{ issueId: string }>();

  const issues = useIssues();
  const stock = useStock();
  const products = useProducts();
  const batches = useBatches();
  const locations = useLocations();

  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const issue = issueId ? issues?.get(issueId) : undefined;
  const today = todayLocal();

  /** FEFO candidates and the suggestion, per requested line. */
  const perLine = useMemo(() => {
    if (!issue || !stock || !batches) return [];
    return issue.lines.map((line) => {
      const available = stock.filter(
        // QUARANTINE never appears — it is not a choice (UI Spec §11).
        (level) => level.productId === line.productId && level.status === 'AVAILABLE',
      );
      const candidates = toCandidates(available, batches, today);
      const requested = line.issued === ZERO ? line.issued : line.issued;
      const suggestion = suggestFefo(candidates, requested);
      return { line, candidates, suggestion };
    });
  }, [issue, stock, batches, today]);

  const toggle = (lineId: string, candidate: FefoCandidate) => {
    setPicks((current) => {
      const chosen = current[lineId] ?? [];
      return {
        ...current,
        [lineId]: chosen.includes(candidate.level.key)
          ? chosen.filter((key) => key !== candidate.level.key)
          : [...chosen, candidate.level.key],
      };
    });
  };

  const ready = () =>
    perLine.every(({ line, suggestion }) => {
      const chosen = picks[line.lineId] ?? suggestion.allocations.map((a) => a.level.key);
      if (chosen.length === 0) return false;
      const suggested = suggestion.allocations.map((a) => a.level.key);
      const isOverride = chosen.some((key) => !suggested.includes(key));
      return !isOverride || Boolean(overrideReasons[line.lineId]);
    });

  const submit = async () => {
    if (!issue || !issueId || !ready()) return;
    setSaving(true);
    try {
      await append('material_issue.prepared', {
        issueId,
        picks: perLine.flatMap(({ line, suggestion, candidates }) => {
          const chosenKeys = picks[line.lineId] ?? suggestion.allocations.map((a) => a.level.key);
          const suggested = suggestion.allocations.map((a) => a.level.key);
          const isOverride = chosenKeys.some((key) => !suggested.includes(key));

          return chosenKeys.map((key) => {
            const candidate = candidates.find((c) => c.level.key === key)!;
            const allocated = suggestion.allocations.find((a) => a.level.key === key);
            return {
              lineId: line.lineId,
              ref: {
                productId: candidate.level.productId,
                batchId: candidate.level.batchId,
                locationId: candidate.level.locationId,
                status: candidate.level.status,
              },
              quantity: allocated?.quantity ?? candidate.level.quantity,
              fefoOverrideReason: isOverride ? overrideReasons[line.lineId] : undefined,
            };
          });
        }),
      });
      navigate(`/f/issues/${issueId}/handover`);
    } finally {
      setSaving(false);
    }
  };

  if (issues === undefined || stock === undefined || products === undefined) {
    return (
      <>
        <ScreenHeader title={t('picking')} />
        <LoadingRows rows={3} />
      </>
    );
  }

  if (!issue) {
    return (
      <>
        <ScreenHeader title={t('picking')} />
        <ErrorState
          title="That request is not on this device"
          body="It may have been raised on another phone and not synced yet."
          onRetry={() => navigate('/f/tasks')}
        />
      </>
    );
  }

  return (
    <>
      <ScreenHeader title={t('picking')} subtitle={issue.workOrderNo} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        {perLine.map(({ line, candidates, suggestion }) => {
          const product = products.find((p) => p.id === line.productId);
          const suggested = suggestion.allocations.map((a) => a.level.key);
          const chosen = picks[line.lineId] ?? suggested;
          const isOverride = chosen.some((key) => !suggested.includes(key));
          const chosenTotal = chosen.reduce((acc, key) => {
            const candidate = candidates.find((c) => c.level.key === key);
            const allocated = suggestion.allocations.find((a) => a.level.key === key);
            return add(acc, allocated?.quantity ?? candidate?.level.quantity ?? ZERO);
          }, ZERO);

          return (
            <Card key={line.lineId}>
              <CardContent className="space-y-4 pt-card">
                <div>
                  <h2 className="text-title font-semibold text-text-primary">
                    {product?.name ?? 'Unknown item'}
                  </h2>
                  <p className="pt-1 text-body-sm text-text-secondary">
                    {formatWithUnit(chosenTotal, line.unit)} selected
                    {suggestion.shortfall !== ZERO && (
                      <span className="text-st-danger">
                        {' '}
                        · {formatWithUnit(suggestion.shortfall, line.unit)} short
                      </span>
                    )}
                  </p>
                </div>

                <BatchPicker
                  label={t('batch')}
                  candidates={candidates}
                  batches={batches ?? []}
                  locations={locations ?? []}
                  unit={line.unit}
                  selectedKeys={chosen}
                  onToggle={(candidate) => toggle(line.lineId, candidate)}
                  fefoKey={suggested[0]}
                  today={today}
                />

                {/* An override is allowed, but never silent. */}
                {isOverride && (
                  <ReasonPicker
                    label="Why not the FEFO batch?"
                    required
                    reasons={[
                      'Physically blocked in the rack',
                      'Damaged packaging on that batch',
                      'Production asked for this batch',
                      'Quantity not enough in that batch',
                    ]}
                    value={overrideReasons[line.lineId]}
                    onChange={(reason) =>
                      setOverrideReasons((current) => ({ ...current, [line.lineId]: reason }))
                    }
                    error={
                      overrideReasons[line.lineId]
                        ? undefined
                        : 'This is not the batch FEFO suggests. Say why, and it will be recorded.'
                    }
                  />
                )}
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
          disabled={!ready()}
          onClick={() => void submit()}
        >
          Ready for handover
        </Button>
      </ActionBar>
    </>
  );
}
