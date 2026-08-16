import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/app/session';
import { NotificationSettings } from '@/components/factoryvision/NotificationSettings';
import { OfflineQueueList, type QueueRow } from '@/components/factoryvision/OfflineQueueList';
import { SyncStatusIndicator } from '@/components/factoryvision/SyncStatusIndicator';
import { EmptyState, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { db } from '@/db/schema';
import { drainOutbox } from '@/db/sync';
import { requestPersistentStorage, storageEstimate, type StorageState } from '@/db/persist';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L03 · Sync status (UI Spec §15).
 *
 * Answers one question honestly: what has not reached the server yet?
 *
 * Pending work is grey, never red (D3) — a queue is the normal state of a
 * warehouse with no signal, and a red screen would make an operator stop
 * working while everything is fine.
 *
 * Two things here are not cosmetic:
 * - **Storage permission** (T-047). Without persistent storage the browser may
 *   evict the queue, and an operator's whole day disappears. If permission is
 *   denied this screen says so loudly, because it is the only place the
 *   problem is visible before the data is already gone (Tech Stack §2.7a).
 * - **Storage-loss detection.** A device that once held events and now holds
 *   none has been cleared. Showing an empty screen as if that were normal is
 *   the failure mode PRD §10 explicitly forbids.
 */
export function SyncStatus() {
  const t = useTerm();
  const navigate = useNavigate();
  const tenantId = useSession((s) => s.tenantId);

  const [storage, setStorage] = useState<StorageState>();
  const [syncing, setSyncing] = useState(false);

  const queue = useLiveQuery(async (): Promise<QueueRow[]> => {
    const entries = await db.outbox.where('tenantId').equals(tenantId).sortBy('queuedAt');
    const events = await db.events.bulkGet(entries.map((e) => e.eventId));
    return entries.map((entry, index) => ({ entry, event: events[index] ?? undefined }));
  }, [tenantId]);

  const totals = useLiveQuery(async () => {
    const pending = await db.outbox.where('[tenantId+state]').equals([tenantId, 'queued']).count();
    const conflicts = await db.conflicts
      .where('tenantId')
      .equals(tenantId)
      .filter((c) => c.resolvedAt === null)
      .count();
    const events = await db.events.where('tenantId').equals(tenantId).count();
    return { pending, conflicts, events };
  }, [tenantId]);

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, []);

  /** Once this device has written events, having none means storage was cleared. */
  const everHadEvents = useLiveQuery(async () => {
    const marker = await db.meta.get('hadEvents');
    return marker?.value === true;
  }, []);

  useEffect(() => {
    if ((totals?.events ?? 0) > 0) void db.meta.put({ key: 'hadEvents', value: true });
  }, [totals?.events]);

  const storageLost = everHadEvents === true && totals?.events === 0;

  const sync = async () => {
    setSyncing(true);
    try {
      await drainOutbox(tenantId);
      setStorage(await storageEstimate());
    } finally {
      setSyncing(false);
    }
  };

  const usedPercent =
    storage?.ratio !== undefined ? Math.min(100, Math.round(storage.ratio * 100)) : undefined;

  return (
    <>
      <ScreenHeader title={t('sync_status')} back={false} />

      <ScreenBody className="space-y-6">
        {/* The headline state, in the size it deserves. */}
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-card">
            <SyncStatusIndicator
              pending={totals?.pending ?? 0}
              conflicts={totals?.conflicts ?? 0}
              size="large"
            />
            <Button loading={syncing} onClick={() => void sync()}>
              <RefreshCw aria-hidden />
              Sync now
            </Button>
          </CardContent>
        </Card>

        {storageLost && (
          <Alert variant="destructive">
            <AlertTitle>This device's records were cleared</AlertTitle>
            <AlertDescription>
              Transactions saved on this phone are gone — the browser removed them to free space.
              Anything already synced is safe on the server. Tell your warehouse head before
              recording anything else.
            </AlertDescription>
          </Alert>
        )}

        {(totals?.conflicts ?? 0) > 0 && (
          <Alert>
            <AlertTitle>{totals?.conflicts} transactions need a decision</AlertTitle>
            <AlertDescription>
              The server has a different version of these. Nothing is overwritten until someone
              chooses.
              <Button
                variant="ghost"
                className="mt-2 block px-0"
                onClick={() => navigate('/f/sync/conflicts')}
              >
                {t('review_conflicts')}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Storage — the section that prevents silent data loss. */}
        <Card>
          <CardContent className="space-y-3 p-card">
            <div className="flex items-baseline justify-between">
              <h2 className="text-title font-semibold text-text-primary">Storage</h2>
              {usedPercent !== undefined && (
                <span className="text-body-sm tabular-nums text-text-secondary">
                  {usedPercent}% used
                </span>
              )}
            </div>

            {usedPercent !== undefined && <Progress value={usedPercent} />}

            {storage?.persisted ? (
              <p className="text-body-sm text-text-secondary">
                This device is allowed to keep your work permanently. Offline transactions are
                safe here for the full seven days.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-body-sm text-st-danger">
                  This browser has not granted permanent storage. If the phone runs low on space,
                  transactions waiting to sync can be deleted without warning.
                </p>
                <Button variant="outline" onClick={() => void requestPersistentStorage().then(setStorage)}>
                  Allow permanent storage
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <NotificationSettings />

        {/* The queue itself. */}
        <div>
          <h2 className="pb-3 text-title font-semibold text-text-primary">Waiting to send</h2>
          {queue === undefined ? null : queue.length === 0 ? (
            <EmptyState
              title="Everything is sent"
              body="Nothing is waiting on this device. Keep working — new transactions queue here automatically when there is no signal."
            />
          ) : (
            <OfflineQueueList rows={queue} />
          )}
        </div>
      </ScreenBody>
    </>
  );
}
