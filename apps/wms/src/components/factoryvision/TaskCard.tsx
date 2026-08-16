import type { TaskType } from '@fv/contracts';
import { formatAge, type Task } from '@fv/domain';
import { Boxes, ClipboardList, PackageCheck, Repeat, Truck, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';

/**
 * TaskCard — L02, L27, K18 (UI Spec §5, added v2.1).
 *
 * Shows `Unassigned` as a STATE, not as an absence. A blank owner column reads
 * as data that failed to load; hybrid mode deliberately leaves tasks waiting to
 * be taken, and that has to look intentional (UI Spec K18).
 *
 * `Start` and `Claim` are two different words and must not be merged: `Start`
 * means it is already mine, `Claim` means taking it from a pool other people
 * may be looking at right now.
 *
 * Level 2 colouring for overdue (§6.4), never level 3. Five solid cards in a
 * list are unreadable and the most urgent one vanishes among them.
 */

const ICONS: Record<TaskType, typeof Truck> = {
  RECEIVE_DELIVERY: Truck,
  PUTAWAY: Warehouse,
  PREPARE_ISSUE: ClipboardList,
  PICK_SHIP: PackageCheck,
  COUNT_STOCK: Boxes,
  RECOUNT: Repeat,
};

const LABELS: Record<TaskType, string> = {
  RECEIVE_DELIVERY: 'Receive delivery',
  PUTAWAY: 'Putaway',
  PREPARE_ISSUE: 'Prepare material issue',
  PICK_SHIP: 'Pick & ship',
  COUNT_STOCK: 'Count stock',
  RECOUNT: 'Recount',
};

export interface TaskCardProps {
  task: Task;
  /** Age in hours, computed by the screen — the domain never reads a clock. */
  ageHours: number;
  /** Who holds it, resolved to a name by the screen. */
  ownerName?: string;
  /** `Start` when it is mine, `Claim` when it is in the open queue. */
  action?: 'start' | 'claim' | 'assign' | 'none';
  onAction?: () => void;
  onRelease?: () => void;
  /** Claimed while offline — true until the server confirms who won. */
  pendingSync?: boolean;
  className?: string;
}

export function TaskCard({
  task,
  ageHours,
  ownerName,
  action = 'none',
  onAction,
  onRelease,
  pendingSync,
  className,
}: TaskCardProps) {
  const Icon = ICONS[task.type];

  return (
    <Card
      level={task.overdue ? 'accented' : 'neutral'}
      status={task.overdue ? 'danger' : 'none'}
      className={className}
    >
      <CardContent className="p-card">
        <div className="flex items-start gap-3">
          <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />

          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold text-text-primary">
              {LABELS[task.type]}
            </p>
            <p className="truncate pt-0.5 text-body-sm text-text-secondary">
              {task.label} · {task.detail}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <StatusBadge kind="task" status={task.status} overdue={task.overdue} />
              <span
                className={cn(
                  'text-body-sm tabular-nums',
                  task.overdue ? 'font-semibold text-st-danger' : 'text-text-secondary',
                )}
              >
                {task.overdue ? `Overdue ${formatAge(ageHours)}` : formatAge(ageHours)}
              </span>
              {ownerName && (
                <span className="text-body-sm text-text-secondary">· {ownerName}</span>
              )}
              {pendingSync && (
                // A chip inside the card, not a page banner: it is true of this
                // one task, not of the whole list (UI Spec L27).
                <span className="rounded-full bg-secondary px-2 py-0.5 text-caption text-text-secondary">
                  Claimed — not yet synced
                </span>
              )}
            </div>
          </div>
        </div>

        {action !== 'none' && (
          <div className="flex gap-2 pt-3">
            <Button type="button" onClick={onAction} className="flex-1">
              {action === 'start' ? 'Start' : action === 'claim' ? 'Claim' : 'Assign'}
            </Button>
            {onRelease && (
              <Button type="button" variant="outline" onClick={onRelease}>
                Release
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const TASK_LABELS = LABELS;
