import { ZERO, type Qty } from '@fv/domain';
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
import { Progress } from '@/components/ui/progress';
import { useEventLog, useLocations, useProducts, useStock } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L23 · Blind count ⚠️ (UI Spec §16, acceptance §23.6).
 *
 * The counter never sees the system figure. This screen reads stock only to
 * know WHICH lines exist and where — the quantities are used to build the
 * work list and are never rendered, and `BlindCountInput` has no prop that
 * could render them even by mistake.
 *
 * Two operational rules from PRD F10:
 * - **Several counters work the same session in parallel.** Each count is an
 *   event carrying who counted it, so two phones never overwrite each other.
 * - **The session can be paused and resumed.** Progress is local, so closing
 *   the app mid-count loses nothing — a stock take spans hours, and phones
 *   get locked, dropped, and put in pockets.
 */
export function BlindCount() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const { sessionId } = useParams<{ sessionId: string }>();
  const user = useSession((s) => s.user);

  const stock = useStock();
  const products = useProducts();
  const locations = useLocations();
  const events = useEventLog();

  const [index, setIndex] = useState(0);
  const [counted, setCounted] = useState<Qty | ''>('');
  const [saving, setSaving] = useState(false);

  /**
   * The work list: every physical stock line in scope. Quantities travel with
   * it because the projection produces them, but nothing below renders one.
   */
  const worklist = useMemo(
    () =>
      (stock ?? [])
        .filter((level) => level.status === 'AVAILABLE' || level.status === 'QUARANTINE')
        .sort((a, b) => a.locationId.localeCompare(b.locationId) || a.productId.localeCompare(b.productId)),
    [stock],
  );

  /** Lines already counted in this session — supports pause and resume. */
  const alreadyCounted = useMemo(() => {
    const keys = new Set<string>();
    for (const event of events ?? []) {
      if (event.type !== 'stock_take.counted') continue;
      if (event.payload.sessionId !== sessionId) continue;
      const ref = event.payload.ref;
      keys.add([ref.productId, ref.batchId ?? '-', ref.locationId, ref.status].join('|'));
    }
    return keys;
  }, [events, sessionId]);

  const remaining = worklist.filter((level) => !alreadyCounted.has(level.key));
  const current = remaining[index];
  const done = alreadyCounted.size;
  const total = worklist.length;

  const saveCount = async () => {
    if (!current || !sessionId) return;
    setSaving(true);
    try {
      await append('stock_take.counted', {
        sessionId,
        ref: {
          productId: current.productId,
          batchId: current.batchId,
          locationId: current.locationId,
          status: current.status,
        },
        countedQuantity: counted === '' ? ZERO : counted,
        countedBy: user.id,
        round: 1,
      });
      setCounted('');
      setIndex(0); // the counted line drops out of `remaining`
    } finally {
      setSaving(false);
    }
  };

  if (stock === undefined || products === undefined || locations === undefined) {
    return (
      <>
        <ScreenHeader title={t('blind_count')} />
        <LoadingRows rows={3} />
      </>
    );
  }

  if (total === 0) {
    return (
      <>
        <ScreenHeader title={t('blind_count')} />
        <EmptyState
          title="Nothing to count in this scope"
          body="There is no stock recorded in the locations this session covers."
          action={<Button onClick={() => navigate('/f')}>{t('nav_home')}</Button>}
        />
      </>
    );
  }

  if (!current) {
    return (
      <>
        <ScreenHeader title={t('blind_count')} subtitle={`${done} / ${total} counted`} />
        <EmptyState
          icon={CheckCircle2}
          title="Every line in your scope is counted"
          body="The warehouse head can now review the variance report. You can close the app — your counts are saved on this device."
          action={<Button onClick={() => navigate('/f')}>{t('nav_home')}</Button>}
        />
      </>
    );
  }

  const product = products.find((p) => p.id === current.productId);
  const location = locations.find((l) => l.id === current.locationId);

  return (
    <>
      <ScreenHeader title={t('blind_count')} subtitle={`${done} / ${total} counted`} />
      <OfflineNotice />

      <div className="px-4 pt-4">
        <Progress value={total === 0 ? 0 : (done / total) * 100} />
      </div>

      <ScreenBody className="space-y-6">
        {/* What to count and where to stand. No quantity anywhere on screen. */}
        <div className="rounded-card border border-border bg-card p-card">
          <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
            {location?.code ?? 'Location'} · {location?.name ?? ''}
          </p>
          <h2 className="pt-2 text-h3 font-semibold text-text-primary">
            {product?.name ?? 'Unknown item'}
          </h2>
          <p className="pt-1 text-body-sm text-text-secondary">
            {product?.sku}
            {current.batchId && ' · batch on the label'}
          </p>
        </div>

        <BlindCountInput
          label={t('field_counted_quantity')}
          value={counted}
          onChange={setCounted}
          unit={product?.baseUnit ?? ''}
          autoFocus
        />

        <p className="text-body-sm text-text-secondary">
          Count what is physically there. The system figure is deliberately not shown — that is
          what makes this count worth doing.
        </p>
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving}
          disabled={counted === ''}
          onClick={() => void saveCount()}
        >
          {t('action_next_item')}
        </Button>
      </ActionBar>
    </>
  );
}
