import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DEV_USERS, useSession } from '@/app/session';
import { ItemRow } from '@/components/factoryvision/ItemRow';
import { TwoPartyConfirm } from '@/components/factoryvision/TwoPartyConfirm';
import {
  ActionBar,
  ErrorState,
  LoadingRows,
  OfflineNotice,
  ScreenBody,
  ScreenHeader,
} from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { useIssues, useProducts } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L16 · Handover confirmation (UI Spec §11, PRD F5).
 *
 * The pivotal moment of the whole chain. On confirmation:
 * - stock moves to the virtual location `In Production` — still the factory's
 *   material, still valued in reports, but no longer in the warehouse
 * - the material issue becomes `OPEN` and **its age starts counting**
 *
 * That clock is the product's central metric (≥85% closed within 24 hours),
 * which is why both parties confirm here: an unwitnessed handover is exactly
 * the gap where accountability for the 8 kg disappears (problem M2).
 */
export function HandoverConfirmation() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const config = useTenantConfig();
  const { issueId } = useParams<{ issueId: string }>();

  const issues = useIssues();
  const products = useProducts();
  const user = useSession((s) => s.user);

  const [giverConfirmed, setGiverConfirmed] = useState(false);
  const [receiverConfirmed, setReceiverConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  const issue = issueId ? issues?.get(issueId) : undefined;
  const requester = DEV_USERS.find((u) => u.id === issue?.requestedBy);

  const confirm = async () => {
    if (!issue || !issueId || !giverConfirmed || !receiverConfirmed) return;
    setSaving(true);
    try {
      await append('material_issue.handed_over', {
        issueId,
        handedOverBy: user.id,
        receivedBy: issue.requestedBy ?? user.id,
        // Not a place anyone walks to, but stock genuinely sits there.
        toLocationId: config.productionLocationId,
      });
      navigate('/f/tasks');
    } finally {
      setSaving(false);
    }
  };

  if (issues === undefined || products === undefined) {
    return (
      <>
        <ScreenHeader title={t('material_issue')} />
        <LoadingRows rows={3} />
      </>
    );
  }

  if (!issue) {
    return (
      <>
        <ScreenHeader title={t('material_issue')} />
        <ErrorState
          title="That issue is not on this device"
          body="Open the issue queue to see what is ready to hand over."
          onRetry={() => navigate('/f/tasks')}
        />
      </>
    );
  }

  return (
    <>
      <ScreenHeader title={t('material_issue')} subtitle={issue.workOrderNo} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        <section>
          <h2 className="pb-3 text-title font-semibold text-text-primary">What is being handed over</h2>
          <ul className="overflow-hidden rounded-card border border-border">
            {issue.lines.map((line) => {
              const product = products.find((p) => p.id === line.productId);
              return (
                <li key={line.lineId}>
                  <ItemRow
                    name={product?.name ?? 'Unknown item'}
                    meta={product?.sku}
                    quantity={line.issued}
                    unit={line.unit}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        <TwoPartyConfirm
          giverLabel="Handed over by"
          giverName={user.name}
          receiverLabel="Received by"
          receiverName={requester?.name ?? 'Production'}
          giverConfirmed={giverConfirmed}
          receiverConfirmed={receiverConfirmed}
          onGiverConfirm={() => setGiverConfirmed(true)}
          onReceiverConfirm={() => setReceiverConfirmed(true)}
        />

        <p className="rounded-sm bg-secondary px-4 py-3 text-body-sm text-text-secondary">
          On confirmation this material moves to{' '}
          <span className="font-semibold text-text-primary">{t('in_production')}</span> and the
          issue starts ageing. It stays open until every material is returned or accounted for.
        </p>
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving}
          disabled={!giverConfirmed || !receiverConfirmed}
          onClick={() => void confirm()}
        >
          Confirm handover
        </Button>
      </ActionBar>
    </>
  );
}
