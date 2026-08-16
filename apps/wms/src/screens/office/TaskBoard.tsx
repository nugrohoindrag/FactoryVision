import { workload, type Task } from '@fv/domain';
import { Activity, AlertTriangle, ClipboardCheck, Inbox } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEV_USERS, useSession } from '@/app/session';
import { StatCard } from '@/components/factoryvision/StatCard';
import { StatusBadge } from '@/components/factoryvision/StatusBadge';
import { TASK_LABELS } from '@/components/factoryvision/TaskCard';
import { EmptyState, LoadingRows } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTasks } from '@/db/hooks';
import { useAppend } from '@/db/useAppend';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * K18 · Task board 🆕 (UI Spec §18.3).
 *
 * The warehouse head's view of every open task and who holds it.
 *
 * ## The decision that shapes this screen
 *
 * **The workload panel sits beside the `Assign` button, and it shows the
 * projection.** Lopsided assignment has to be visible *before* it happens, and
 * that only works if the number is next to the button rather than one click
 * away in a report. `Budi will have 7` changes a decision; `Budi has 6` is
 * trivia.
 *
 * ## Two things that are easy to get wrong
 *
 * - **`Unassigned` is never red.** Hybrid mode deliberately lets tasks wait to
 *   be claimed; what is monitored is how LONG one waits, not that it exists
 *   (PRD F25). Colouring it red would demand the head assign something that was
 *   designed to be picked up.
 * - **Bulk selection lives here and only here.** K18 is used with a mouse at a
 *   desk; L27 is used with gloves while standing. The same action must not have
 *   the same ergonomics in both.
 */

function ageHours(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 3_600_000));
}

export function TaskBoard() {
  const t = useTerm();
  const tasks = useTasks();
  const append = useAppend();
  const currentUser = useSession((s) => s.user);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState<string>();

  // Only people who actually do warehouse work can hold a warehouse task.
  const operators = useMemo(
    () => DEV_USERS.filter((u) => u.role === 'OPERATOR' || u.role === 'WAREHOUSE_HEAD'),
    [],
  );

  const load = useMemo(
    () => (tasks ? workload(tasks, operators.map((u) => u.id)) : new Map<string, number>()),
    [tasks, operators],
  );

  const unassigned = tasks?.filter((task) => task.ownerId === null).length ?? 0;
  const overdue = tasks?.filter((task) => task.overdue).length ?? 0;
  const inProgress = tasks?.filter((task) => task.status === 'IN PROGRESS').length ?? 0;

  const toggle = (taskId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const assign = async () => {
    if (!assignee || selected.size === 0 || !tasks) return;
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const taskId of selected) {
      const task = byId.get(taskId);
      if (!task) continue;
      await append('task.assigned', {
        taskId: task.id,
        taskType: task.type,
        refId: task.refId,
        assignedTo: assignee,
        assignedBy: currentUser.id,
      });
    }
    setSelected(new Set());
  };

  /** What the chosen person will hold once this assignment lands. */
  const projected = assignee ? (load.get(assignee) ?? 0) + selected.size : null;
  const nameOf = (userId: string | null) =>
    userId ? (operators.find((u) => u.id === userId)?.name ?? userId) : '—';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">{t('screen_task_board')}</h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          {tasks?.length ?? 0} open
          {overdue > 0 && (
            <span className="font-semibold text-st-danger"> · {overdue} overdue</span>
          )}
        </p>
      </header>

      {/**
       * Data accents, not statuses. `Unassigned` is brand-toned because it is a
       * normal quantity in hybrid mode; only `Overdue` earns `danger`, and it
       * is the only tile on this screen allowed to.
       */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          index={0}
          label="Unassigned"
          value={String(unassigned)}
          icon={Inbox}
          tone="brand"
          hint="Waiting for someone to claim — normal, not a failure"
        />
        <StatCard
          index={1}
          label="Overdue"
          value={String(overdue)}
          icon={AlertTriangle}
          tone={overdue > 0 ? 'danger' : 'neutral'}
          hint="Past the day they were raised"
        />
        <StatCard
          index={2}
          label="In progress"
          value={String(inProgress)}
          icon={Activity}
          tone="teal"
          hint="Started, not yet finished"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        {tasks === undefined ? (
          <LoadingRows rows={6} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No open tasks"
            body="Everything raised has been finished. New work appears here on its own — from a PO nearing its ETA, a request waiting to be prepared, or a stock take in progress."
          />
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-card shadow-1">
            <Table minWidth="40rem">
              <TableHeader>
                <tr>
                  <TableHead className="w-10">
                    <span className="sr-only">Select</span>
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead>Status</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {tasks.map((task: Task) => (
                  <TableRow
                    key={task.id}
                    // Level 2: a bar, not a fill. Twenty filled rows read as none.
                    className={cn(task.overdue && 'border-l-[3px] border-l-st-danger')}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(task.id)}
                        onCheckedChange={() => toggle(task.id)}
                        aria-label={`Select ${TASK_LABELS[task.type]} ${task.label}`}
                      />
                    </TableCell>
                    <TableCell>{TASK_LABELS[task.type]}</TableCell>
                    <TableCell className="text-text-secondary">{task.label}</TableCell>
                    {/* An em dash, not a blank: an empty cell reads as data that
                        failed to load rather than as nobody holding it. */}
                    <TableCell className="text-text-secondary">{nameOf(task.ownerId)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        task.overdue ? 'font-semibold text-st-danger' : 'text-text-secondary',
                      )}
                    >
                      {ageHours(task.createdAt)}h
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind="task" status={task.status} overdue={task.overdue} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Beside Assign, deliberately — see the header comment. */}
        <aside className="space-y-3" aria-label="Workload">
          <h2 className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
            Workload
          </h2>

          <ul className="space-y-2">
            {operators.map((operator) => {
              const count = load.get(operator.id) ?? 0;
              const active = assignee === operator.id;
              return (
                <li key={operator.id}>
                  <button
                    type="button"
                    onClick={() => setAssignee(active ? undefined : operator.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex min-h-touch w-full items-center justify-between gap-3 rounded-btn border px-3 text-left',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      // Solid tokens only. An alpha tint here would be opacity
                      // carrying meaning, which §6.4 forbids — and in a bright
                      // office it is the first thing to disappear.
                      active
                        ? 'border-primary bg-secondary'
                        : 'border-border bg-card hover:bg-secondary',
                    )}
                  >
                    <span className="min-w-0 truncate text-body text-text-primary">
                      {operator.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-body font-semibold text-text-primary">
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <Button
            type="button"
            className="w-full"
            disabled={!assignee || selected.size === 0}
            onClick={() => void assign()}
          >
            {selected.size > 0
              ? `Assign ${selected.size} task${selected.size === 1 ? '' : 's'}`
              : 'Assign'}
          </Button>

          {/* The number AFTER, not just the number now. */}
          {projected !== null && selected.size > 0 && (
            <p className="text-body-sm text-text-secondary">
              {nameOf(assignee ?? null)} will have{' '}
              <span className="font-semibold text-text-primary">{projected}</span>
            </p>
          )}

          {selected.size > 0 && !assignee && (
            <p className="text-body-sm text-text-secondary">
              Choose who takes them.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
