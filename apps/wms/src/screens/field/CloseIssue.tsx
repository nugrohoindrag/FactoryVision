import type { ShrinkageReason } from '@fv/contracts';
import { computeLineBalance, decideIssueStatus, summariseIssue, ZERO, type Qty } from '@fv/domain';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IssueCalculationPanel } from '@/components/factoryvision/IssueCalculationPanel';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { ReasonPicker } from '@/components/factoryvision/ReasonPicker';
import {
  ActionBar,
  EmptyState,
  ErrorState,
  LoadingRows,
  OfflineNotice,
  ScreenBody,
  ScreenHeader,
} from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useIssues, useProducts } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L19 · Record shrinkage & close ⚠️ (UI Spec §12, acceptance §23.5).
 *
 * This is the screen that actually closes the chain. If the arithmetic is not
 * clean, issues never close, and the metric the whole product is judged on —
 * ≥85% of issues closed within 24 hours — is unreachable (PRD §11).
 *
 * Three rules, none of them negotiable:
 *
 * 1. **Every figure goes through big.js** (`@fv/domain`). A float remainder of
 *    0.0000000001 kg means the issue can never be closed cleanly.
 * 2. **A shrinkage reason is mandatory.** Without it the variance report — the
 *    report owners actually want — is noise.
 * 3. **Never force a close.** A line with no reason leaves the issue
 *    `PARTIALLY CLOSED`, and it keeps appearing in L17 and K02 until someone
 *    deals with it. That nagging is the only social pressure that works.
 *
 * The panel sits above the inputs and recalculates on every keystroke.
 */

const REASON_CODES: Record<string, ShrinkageReason> = {
  Spillage: 'SPILLAGE',
  Damaged: 'DAMAGED',
  Unmeasured: 'UNMEASURED',
  'Natural loss': 'NATURAL_LOSS',
};

interface LineDraft {
  shrinkage: Qty;
  reason?: string;
  note?: string;
  photoIds: string[];
}

export function CloseIssue() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const config = useTenantConfig();
  const { issueId } = useParams<{ issueId: string }>();

  const issues = useIssues();
  const products = useProducts();
  const balance = issueId ? issues?.get(issueId) : undefined;

  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const draftFor = (lineId: string): LineDraft =>
    drafts[lineId] ?? { shrinkage: ZERO, photoIds: [] };

  const setDraft = (lineId: string, patch: Partial<LineDraft>) =>
    setDrafts((current) => ({ ...current, [lineId]: { ...draftFor(lineId), ...patch } }));

  /**
   * Live recomputation. A line counts as accounted for only once a reason is
   * chosen — including a deliberate zero-shrinkage line, which is itself an
   * answer ("nothing was lost") rather than an omission.
   */
  const preview = useMemo(() => {
    if (!balance) return undefined;
    const lines = balance.lines.map((line) => {
      const draft = drafts[line.lineId];
      return computeLineBalance({
        lineId: line.lineId,
        productId: line.productId,
        unit: line.unit,
        issued: line.issued,
        returned: line.returned,
        shrinkage: draft?.shrinkage ?? ZERO,
        accounted: Boolean(draft?.reason),
      });
    });
    return summariseIssue(balance.issueId, lines);
  }, [balance, drafts]);

  const resultingStatus = preview ? decideIssueStatus(preview) : 'OPEN';
  const blocked = preview?.invalid ?? false;

  const close = async () => {
    setTouched(true);
    if (!preview || !issueId || blocked) return;

    setSaving(true);
    try {
      await append('material_issue.closed', {
        issueId,
        shrinkage: preview.lines
          .filter((line) => drafts[line.lineId]?.reason)
          .map((line) => {
            const draft = draftFor(line.lineId);
            return {
              lineId: line.lineId,
              quantity: line.shrinkage,
              reason: REASON_CODES[draft.reason!] ?? 'UNMEASURED',
              note: draft.note?.trim() || undefined,
              photoIds: draft.photoIds,
            };
          }),
        // Never forced: an unexplained line yields PARTIALLY CLOSED, and the
        // issue stays visible until it is dealt with.
        resultingStatus,
      });
      navigate('/f/issues/mine');
    } finally {
      setSaving(false);
    }
  };

  if (issues === undefined || products === undefined) {
    return (
      <>
        <ScreenHeader title={t('shrinkage')} />
        <LoadingRows rows={3} />
      </>
    );
  }

  if (!balance) {
    return (
      <>
        <ScreenHeader title={t('shrinkage')} />
        <ErrorState
          title="That material issue is not on this device"
          body="It may have been created on another phone and not synced yet. Open it from My open issues."
          onRetry={() => navigate('/f/issues/mine')}
        />
      </>
    );
  }

  if (balance.lines.length === 0) {
    return (
      <>
        <ScreenHeader title={t('shrinkage')} />
        <EmptyState
          title="Nothing was issued against this request"
          body="There is nothing to close until the warehouse has prepared and handed over the materials."
        />
      </>
    );
  }

  return (
    <>
      <ScreenHeader title={t('shrinkage')} subtitle={`${balance.lines.length} materials`} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        {preview?.lines.map((line, index) => {
          const product = products.find((p) => p.id === line.productId);
          const draft = draftFor(line.lineId);
          const missingReason = touched && !draft.reason;

          return (
            <Card key={line.lineId}>
              <CardContent className="space-y-5 pt-card">
                <div>
                  <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
                    Material {index + 1}
                  </p>
                  <h2 className="pt-1 text-title font-semibold text-text-primary">
                    {product?.name ?? 'Unknown item'}
                  </h2>
                </div>

                {/* The panel is above the input, and updates as it is typed. */}
                <IssueCalculationPanel line={line} />

                <QuantityInput
                  label={t('field_shrinkage_quantity')}
                  value={draft.shrinkage}
                  onChange={(shrinkage) => setDraft(line.lineId, { shrinkage })}
                  unit={line.unit}
                  step="0.1"
                  max={line.issued}
                  hint="What was spilled, damaged, or could not be measured."
                />

                <ReasonPicker
                  label={t('field_reason')}
                  required
                  reasons={config.reasons.shrinkage}
                  value={draft.reason}
                  onChange={(reason) => setDraft(line.lineId, { reason })}
                  note={draft.note}
                  onNoteChange={(note) => setDraft(line.lineId, { note })}
                  photoIds={draft.photoIds}
                  onPhotosChange={(photoIds) => setDraft(line.lineId, { photoIds })}
                  error={
                    missingReason
                      ? 'Choose a reason. Without it this line cannot be closed — and the variance report cannot use it.'
                      : undefined
                  }
                />
              </CardContent>
            </Card>
          );
        })}

        {/* States the outcome before it is committed, in plain words. */}
        <p
          className={cnStatus(resultingStatus)}
          aria-live="polite"
        >
          {resultingStatus === 'CLOSED'
            ? 'Every material is accounted for. This issue will close.'
            : `${preview?.unaccountedLineIds.length ?? 0} material(s) still need a reason. The issue will stay partially closed and keep appearing in your open list.`}
        </p>
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving}
          disabled={blocked}
          onClick={() => void close()}
        >
          {t('action_close_issue')}
        </Button>
      </ActionBar>
    </>
  );
}

/** Green when it will close, amber when it will not. Never red — this is a state, not a fault. */
function cnStatus(status: string): string {
  return status === 'CLOSED'
    ? 'rounded-sm bg-st-success-bg px-4 py-3 text-body-sm text-st-success-fg'
    : 'rounded-sm bg-st-warning-bg px-4 py-3 text-body-sm text-st-warning-fg';
}
