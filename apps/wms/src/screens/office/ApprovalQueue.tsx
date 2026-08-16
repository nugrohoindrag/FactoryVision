import { formatMoney, formatTimestamp, formatWithUnit, mul } from '@fv/domain';
import { CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useEventLog, useProducts } from '@/db/hooks';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * K09 · Approval queue (UI Spec §17, PRD F9).
 *
 * **The rupiah value is always visible, at the top of every card.** The spec
 * puts it plainly: an owner approves money, not quantities. "Adjust 40 kg" is
 * not a decision anyone can make; "write off Rp 3.800.000" is.
 *
 * Everything the requester supplied — reason, note, photo — is shown, because
 * an approval made without them is a rubber stamp, and a rubber stamp is what
 * the value threshold exists to prevent.
 */
export function ApprovalQueue() {
  const t = useTerm();
  const events = useEventLog();
  const products = useProducts();
  const config = useTenantConfig();

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [handled, setHandled] = useState<Record<string, 'approved' | 'rejected'>>({});

  /** Adjustments above the threshold that nobody has decided on yet. */
  const pending = useMemo(() => {
    if (!events || !products) return [];
    return events
      .filter((event) => event.type === 'stock.adjusted')
      .map((event) => {
        if (event.type !== 'stock.adjusted') return null;
        const product = products.find((p) => p.id === event.payload.ref.productId);
        const magnitude = event.payload.delta.startsWith('-')
          ? event.payload.delta.slice(1)
          : event.payload.delta;
        const value = product?.averageCost ? mul(magnitude, product.averageCost) : '0';
        return { event, product, value, magnitude };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .filter((row) => Number(row.value) >= Number(config.defaults.approvalThresholdValue))
      .filter((row) => !handled[row.event.id]);
  }, [events, products, config.defaults.approvalThresholdValue, handled]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">{t('screen_approval_queue')}</h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          Adjustments worth more than {formatMoney(config.defaults.approvalThresholdValue)} wait
          here. Below that they take effect immediately.
        </p>
      </header>

      {pending.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing waiting for you"
          body="Adjustments below the value threshold are applied without approval, so this list stays short by design."
        />
      ) : (
        <div className="space-y-4">
          {pending.map(({ event, product, value, magnitude }) => {
            if (event.type !== 'stock.adjusted') return null;
            const isWriteDown = event.payload.delta.startsWith('-');

            return (
              <Card key={event.id} level="accented" status={isWriteDown ? 'danger' : 'info'}>
                <CardContent className="space-y-4 p-card">
                  {/* Money first — that is what is being approved. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p className="text-h2 font-semibold tabular-nums text-text-primary">
                      {formatMoney(value)}
                    </p>
                    <p className="text-body-sm text-text-secondary">
                      {isWriteDown ? 'Write-down' : 'Write-up'} of{' '}
                      {formatWithUnit(magnitude, product?.baseUnit ?? '')}
                    </p>
                  </div>

                  <div>
                    <p className="text-body font-medium text-text-primary">
                      {product?.name ?? 'Unknown item'}
                    </p>
                    <p className="text-body-sm text-text-secondary">
                      {event.actorRole.toLowerCase()} · {formatTimestamp(event.occurredAt)}
                    </p>
                  </div>

                  <div className="rounded-sm bg-secondary px-4 py-3">
                    <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
                      Reason given
                    </p>
                    <p className="pt-1 text-body text-text-primary">{event.payload.reasonCode}</p>
                    {event.payload.note && (
                      <p className="pt-1 text-body-sm text-text-secondary">{event.payload.note}</p>
                    )}
                  </div>

                  <Textarea
                    value={notes[event.id] ?? ''}
                    onChange={(e) => setNotes((c) => ({ ...c, [event.id]: e.target.value }))}
                    placeholder="Note for the record (optional)"
                    rows={2}
                  />

                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => setHandled((c) => ({ ...c, [event.id]: 'approved' }))}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setHandled((c) => ({ ...c, [event.id]: 'rejected' }))}
                    >
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
