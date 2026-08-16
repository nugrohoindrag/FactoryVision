import { splitTasks, type Task } from '@fv/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { ReasonPicker } from '@/components/factoryvision/ReasonPicker';
import { TaskCard } from '@/components/factoryvision/TaskCard';
import { OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useSyncState, useTasks } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';

/**
 * L27 · My tasks 🆕 (UI Spec §18.3).
 *
 * Answers the one question an operator has on arriving: *what should I be
 * doing now?* Before PRD v1.3 nothing in the product answered it — the bottom
 * nav had a `Tasks` tab pointing at empty space, and work was found by
 * whoever happened to be nearest (M12).
 *
 * ## Decisions worth not undoing
 *
 * - **Two section headings, not two tabs.** A tab hides half the content
 *   behind a tap, and the half that gets hidden is `Available` — exactly the
 *   half that causes work to be picked up.
 * - **`Mine` sits above `Available` even when Available is more urgent.** This
 *   screen answers "my work", not "the factory's work". Someone else's urgent
 *   task is K18's problem, not this operator's.
 * - **One action per card, no bulk select.** Claiming five tasks at once with
 *   gloves on is how accidental claims happen. Bulk lives in K18, used with a
 *   mouse at a desk.
 * - **`Start` and `Claim` are different words.** Start means it is already
 *   mine; Claim means taking it from a pool other people may be looking at.
 * - **Nothing is ticked off manually.** A task closes because its transaction
 *   was saved. A checkbox would create a second truth to disagree with.
 */

/** Where each task type actually sends the operator. */
function routeFor(task: Task): string {
  switch (task.type) {
    case 'RECEIVE_DELIVERY':
      return '/f/receipts/new';
    case 'PUTAWAY':
      return '/f/putaway';
    case 'PREPARE_ISSUE':
      return `/f/issues/${task.refId}/prepare`;
    case 'PICK_SHIP':
      return `/f/shipments/${task.refId}/pick`;
    case 'COUNT_STOCK':
      return `/f/stock-take/${task.refId}/count`;
    case 'RECOUNT':
      return `/f/stock-take/${task.refId}/recount`;
    default:
      return '/f';
  }
}

/** Age in hours. The domain never reads a clock, so the screen supplies it. */
function ageHours(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 3_600_000));
}

export function MyTasks() {
  const navigate = useNavigate();
  const append = useAppend();
  const user = useSession((s) => s.user);
  const tasks = useTasks();
  const sync = useSyncState();
  const config = useTenantConfig();

  const [releasing, setReleasing] = useState<Task | null>(null);
  const [releaseReason, setReleaseReason] = useState<string>();

  if (!tasks) {
    return (
      <>
        <ScreenHeader title="Tasks" />
        <ScreenBody className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </ScreenBody>
      </>
    );
  }

  const { mine, available } = splitTasks(tasks, user.id);
  // Claims made offline are provisional until the server picks a winner.
  const pendingSync = (sync?.pending ?? 0) > 0;

  const claim = async (task: Task) => {
    await append('task.claimed', {
      taskId: task.id,
      taskType: task.type,
      refId: task.refId,
      claimedBy: user.id,
    });
  };

  const release = async () => {
    if (!releasing || !releaseReason) return;
    await append('task.released', {
      taskId: releasing.id,
      releasedBy: user.id,
      reasonCode: releaseReason,
    });
    setReleasing(null);
    setReleaseReason(undefined);
  };

  const empty = mine.length === 0 && available.length === 0;

  return (
    <>
      <ScreenHeader title="Tasks" />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        {empty && (
          <p className="py-10 text-center text-body text-text-secondary">
            All caught up. Nothing waiting anywhere.
          </p>
        )}

        {/* `md` and up shows both columns at once — a warehouse head on a
            tablet sees their own work and the queue without scrolling. */}
        <div className="grid gap-6 md:grid-cols-2">
          {(mine.length > 0 || !empty) && (
            <section aria-labelledby="tasks-mine">
              <h2
                id="tasks-mine"
                className="pb-3 text-caption font-semibold uppercase tracking-wide text-text-secondary"
              >
                Mine · {mine.length}
              </h2>

              {mine.length === 0 ? (
                <p className="text-body-sm text-text-secondary">
                  Nothing assigned to you. Tap Claim below to pick up work.
                </p>
              ) : (
                <ul className="space-y-3">
                  {mine.map((task) => (
                    <li key={task.id}>
                      <TaskCard
                        task={task}
                        ageHours={ageHours(task.createdAt)}
                        action="start"
                        pendingSync={pendingSync}
                        onAction={() => navigate(routeFor(task))}
                        onRelease={() => setReleasing(task)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {available.length > 0 && (
            <section aria-labelledby="tasks-available">
              <h2
                id="tasks-available"
                className="pb-3 text-caption font-semibold uppercase tracking-wide text-text-secondary"
              >
                Available · {available.length}
              </h2>
              <ul className="space-y-3">
                {available.map((task) => (
                  <li key={task.id}>
                    <TaskCard
                      task={task}
                      ageHours={ageHours(task.createdAt)}
                      // CLAIM_ONLY and HYBRID both allow self-service; under
                      // ASSIGN_ONLY the queue is visible but not takeable.
                      action={config.taskAssignmentMode === 'ASSIGN_ONLY' ? 'none' : 'claim'}
                      onAction={() => void claim(task)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ScreenBody>

      {/* Releasing is legitimate. Releasing silently is not — hence a reason. */}
      <Dialog open={Boolean(releasing)} onOpenChange={(open) => !open && setReleasing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release this task?</DialogTitle>
          </DialogHeader>
          <p className="text-body-sm text-text-secondary">
            It goes back to the open queue for anyone to pick up. The reason is recorded.
          </p>
          <ReasonPicker
            label="Why are you releasing it?"
            required
            reasons={config.reasons.taskRelease}
            value={releaseReason}
            onChange={setReleaseReason}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleasing(null)}>
              Cancel
            </Button>
            <Button disabled={!releaseReason} onClick={() => void release()}>
              Release task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
