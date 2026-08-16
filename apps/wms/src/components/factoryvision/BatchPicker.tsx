import type { Batch, Location } from '@fv/contracts';
import { daysToExpiry, formatDate, formatWithUnit, type FefoCandidate } from '@fv/domain';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * BatchPicker — L15 prepare issue, L21 pick list (UI Spec §5).
 *
 * FEFO is a SUGGESTION and expiry is a BLOCK. That distinction is the whole
 * component:
 *
 * - The earliest-expiring batch carries a `FEFO` chip and sits at the top.
 *   Picking another one is allowed, but L15 then demands a reason — the
 *   override is recorded, not prevented (PRD F5).
 * - An expired batch is **hard-blocked**: not selectable, greyed with a flat
 *   token rather than opacity, and labelled. A warning here would be tapped
 *   through on a busy morning; owner approval is the only route past it.
 * - Quarantined batches do not appear at all. They are not a choice a
 *   picker should be able to make.
 *
 * The rack is shown on every row because the operator is about to walk there.
 */

export interface BatchPickerProps {
  label: string;
  candidates: FefoCandidate[];
  batches: Batch[];
  locations: Location[];
  unit: string;
  /** Stock keys currently chosen. */
  selectedKeys: string[];
  onToggle: (candidate: FefoCandidate) => void;
  /** Key of the batch FEFO suggests first. */
  fefoKey?: string;
  today: string;
  className?: string;
}

export function BatchPicker({
  label,
  candidates,
  batches,
  locations,
  unit,
  selectedKeys,
  onToggle,
  fefoKey,
  today,
  className,
}: BatchPickerProps) {
  return (
    <div className={cn('w-full', className)}>
      <Label className="mb-2 block">{label}</Label>

      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
        {candidates.map((candidate) => {
          const batch = batches.find((b) => b.id === candidate.level.batchId);
          const location = locations.find((l) => l.id === candidate.level.locationId);
          const selected = selectedKeys.includes(candidate.level.key);
          const days = daysToExpiry(candidate.expiryDate, today);
          const isFefo = candidate.level.key === fefoKey;

          return (
            <li key={candidate.level.key}>
              <button
                type="button"
                disabled={candidate.expired}
                aria-pressed={selected}
                onClick={() => onToggle(candidate)}
                className={cn(
                  'flex w-full min-h-touch items-center gap-3 px-4 py-3 text-left',
                  candidate.expired
                    ? 'cursor-not-allowed bg-secondary text-text-disabled'
                    : 'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  selected && !candidate.expired && 'bg-accent',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">
                      {batch?.batchNo ?? 'No batch'}
                    </span>
                    {isFefo && !candidate.expired && <Badge variant="success">FEFO</Badge>}
                    {candidate.expired && <Badge variant="danger">Expired</Badge>}
                  </div>

                  <p className="pt-0.5 text-body-sm text-text-secondary">
                    {location?.code ?? 'Unknown rack'}
                    {candidate.expiryDate && (
                      <>
                        {' · '}
                        {formatDate(candidate.expiryDate)}
                        {days !== undefined && !candidate.expired && ` (${days}d left)`}
                      </>
                    )}
                  </p>
                </div>

                <span className="shrink-0 text-body font-semibold tabular-nums text-text-primary">
                  {formatWithUnit(candidate.level.quantity, unit)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {candidates.some((c) => c.expired) && (
        <p className="flex items-start gap-2 pt-2 text-body-sm text-text-secondary">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-st-danger" aria-hidden />
          Expired batches cannot be issued. Ask the owner to approve one if there is genuinely no
          alternative.
        </p>
      )}
    </div>
  );
}
