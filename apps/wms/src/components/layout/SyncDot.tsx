import { cn } from '@/lib/utils';

/**
 * The coloured dot that rides on the `Sync` nav item (UI Spec §6.5).
 *
 * Deliberately minimal. The full `SyncStatusIndicator` domain component is
 * T-043 in Sprint 2; this is only the dot the shell needs to exist.
 *
 * Tone matters (D3): a queue is NORMAL, so pending is grey. If offline work
 * showed red, operators would stop working while the system was fine.
 */
export type SyncState = 'synced' | 'pending' | 'conflict';

export function SyncDot({ state, className }: { state: SyncState; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full',
        state === 'synced' && 'bg-sync-synced',
        state === 'pending' && 'bg-sync-pending',
        state === 'conflict' && 'bg-sync-conflict',
        className,
      )}
      aria-hidden
    />
  );
}
