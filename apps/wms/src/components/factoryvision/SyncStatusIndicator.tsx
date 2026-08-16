import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * SyncStatusIndicator — global (UI Spec D3).
 *
 * The tone is the specification. A queue of unsent transactions is the
 * NORMAL state in a warehouse with no signal, so it renders grey and reads
 * "3 pending" — a statement, not an alarm. PRD §12 calls for an honest sync
 * indicator, and an honest one does not shout.
 *
 * If pending work were red, operators would stop working to "fix" a system
 * that is functioning exactly as designed. Red is reserved for the one case
 * that genuinely needs a person: a conflict awaiting a human decision.
 */

export type SyncState = 'synced' | 'pending' | 'conflict';

export function resolveSyncState(pending: number, conflicts: number): SyncState {
  if (conflicts > 0) return 'conflict';
  return pending > 0 ? 'pending' : 'synced';
}

export function SyncStatusIndicator({
  pending,
  conflicts,
  size = 'default',
  className,
}: {
  pending: number;
  conflicts: number;
  size?: 'default' | 'large';
  className?: string;
}) {
  const t = useTerm();
  const state = resolveSyncState(pending, conflicts);

  const label =
    state === 'conflict'
      ? `${conflicts} ${t('sync_conflict')}`
      : state === 'pending'
        ? `${pending} ${t('sync_pending')}`
        : t('sync_synced');

  return (
    <span
      className={cn('inline-flex items-center gap-2', size === 'large' && 'text-body-lg', className)}
      role="status"
    >
      <span
        className={cn(
          'inline-block rounded-full',
          size === 'large' ? 'h-3 w-3' : 'h-2.5 w-2.5',
          state === 'synced' && 'bg-sync-synced',
          state === 'pending' && 'bg-sync-pending',
          state === 'conflict' && 'bg-sync-conflict',
        )}
        aria-hidden
      />
      <span
        className={cn(
          state === 'conflict' ? 'font-semibold text-st-danger' : 'text-text-secondary',
        )}
      >
        {label}
      </span>
    </span>
  );
}
