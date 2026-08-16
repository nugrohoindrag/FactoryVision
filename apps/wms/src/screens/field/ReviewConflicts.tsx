import { formatTimestamp } from '@fv/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/app/session';
import { EVENT_LABELS } from '@/components/factoryvision/OfflineQueueList';
import { EmptyState, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { db, type StoredEvent } from '@/db/schema';
import { resolveConflict } from '@/db/sync';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * L04 · Review conflicts (UI Spec §15, PRD F14).
 *
 * **Nothing is ever overwritten automatically.** A conflict waits for a human
 * however long that takes. PRD Risk "offline sync produces wrong stock" is
 * rated as permanent loss of trust, and the mitigation is precisely this: the
 * conflict is visible, both versions are shown whole, and a person decides.
 *
 * The two versions sit side by side rather than as a diff, because the
 * question is not "what changed" but "which of these two things actually
 * happened in the warehouse" — and that is answered by reading both.
 */
export function ReviewConflicts() {
  const t = useTerm();
  const tenantId = useSession((s) => s.tenantId);
  const [busy, setBusy] = useState<string>();

  const conflicts = useLiveQuery(
    () =>
      db.conflicts
        .where('tenantId')
        .equals(tenantId)
        .filter((c) => c.resolvedAt === null)
        .toArray(),
    [tenantId],
  );

  const decide = async (conflictId: string, resolution: 'keep-local' | 'keep-server') => {
    setBusy(conflictId);
    try {
      await resolveConflict(conflictId, resolution);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <ScreenHeader title={t('review_conflicts')} />

      <ScreenBody className="space-y-4">
        {conflicts === undefined ? null : conflicts.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No conflicts"
            body="Every transaction from this device agrees with the server. Nothing needs deciding."
          />
        ) : (
          conflicts.map((conflict) => {
            const local = conflict.localVersion as StoredEvent | null;
            const server = conflict.serverVersion as StoredEvent | null;

            return (
              <Card key={conflict.id} level="accented" status="danger">
                <CardContent className="space-y-4 p-card">
                  <div>
                    <p className="text-body font-semibold text-text-primary">
                      {EVENT_LABELS[local?.type ?? ''] ?? 'Transaction'}
                    </p>
                    <p className="text-body-sm text-text-secondary">
                      Detected {formatTimestamp(conflict.detectedAt)}
                    </p>
                  </div>

                  {/* Side by side, both whole. Stacks on a phone. */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <Version
                      title="On this device"
                      who={local?.actorRole}
                      when={local?.occurredAt}
                      payload={local?.payload}
                    />
                    <Version
                      title="On the server"
                      who={server?.actorRole}
                      when={server?.occurredAt}
                      payload={server?.payload}
                      muted
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      loading={busy === conflict.id}
                      onClick={() => void decide(conflict.id, 'keep-local')}
                    >
                      Keep this device's version
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy === conflict.id}
                      onClick={() => void decide(conflict.id, 'keep-server')}
                    >
                      Keep the server's version
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </ScreenBody>
    </>
  );
}

function Version({
  title,
  who,
  when,
  payload,
  muted,
}: {
  title: string;
  who?: string;
  when?: string;
  payload?: unknown;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-sm border border-border p-4',
        muted ? 'bg-secondary' : 'bg-card',
      )}
    >
      <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </p>
      <p className="pt-1 text-body-sm text-text-primary">
        {who ?? 'unknown'} · {when ? formatTimestamp(when) : 'no timestamp'}
      </p>
      <dl className="pt-3 space-y-1">
        {Object.entries((payload ?? {}) as Record<string, unknown>)
          .filter(([, value]) => typeof value !== 'object')
          .slice(0, 6)
          .map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 text-body-sm">
              <dt className="text-text-secondary">{key}</dt>
              <dd className="truncate text-text-primary">{String(value)}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
