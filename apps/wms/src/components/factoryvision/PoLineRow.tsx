import type { PoLineProgress } from '@fv/domain';
import { formatQuantity } from '@fv/domain';
import { cn } from '@/lib/utils';

/**
 * PoLineRow — L05, L06, K15, K16 (UI Spec §5, added v2.1).
 *
 * Three numbers side by side: `Ordered` · `Received` · `Outstanding`.
 *
 * The outstanding figure is shown, never implied. An operator standing at a
 * delivery should not have to subtract two numbers in their head to find out
 * how much is still owed — that subtraction is where "we thought it all came"
 * starts, and M11 with it.
 *
 * Defect is called out separately when present, because it is the part of the
 * shortfall the supplier is answerable for rather than simply late.
 */

export interface PoLineRowProps {
  line: PoLineProgress;
  productName: string;
  /** Compact variant for the L05/L06 receiving path, where space is scarce. */
  dense?: boolean;
  className?: string;
}

export function PoLineRow({ line, productName, dense, className }: PoLineRowProps) {
  const complete = line.outstanding === '0';
  const pct = completionPct(line);

  return (
    <div className={cn('py-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-body font-medium text-text-primary">
          {productName}
        </p>
        <p className="shrink-0 tabular-nums text-body-sm text-text-secondary">
          {formatQuantity(line.received)} / {formatQuantity(line.ordered)} {line.unit}
        </p>
      </div>

      {/* The bar answers "how much has actually turned up" at a glance — a
          badge alone never does, and that is the first question about a PO. */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${productName} received`}
      >
        <div
          className={cn('h-full rounded-full', complete ? 'bg-st-success' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {!dense && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-body-sm tabular-nums">
          {!complete && (
            <span className="text-text-primary">
              Outstanding{' '}
              <span className="font-semibold">
                {formatQuantity(line.outstanding)} {line.unit}
              </span>
            </span>
          )}
          {line.defect !== '0' && (
            // Not lumped in with "outstanding": this part is owed BECAUSE it
            // arrived broken, which is a different conversation with the supplier.
            <span className="text-st-danger">
              Defect {formatQuantity(line.defect)} {line.unit}
            </span>
          )}
          {line.overReceived !== '0' && (
            <span className="text-st-warning">
              Over {formatQuantity(line.overReceived)} {line.unit}
            </span>
          )}
          {complete && line.defect === '0' && (
            <span className="text-st-success">Complete</span>
          )}
        </div>
      )}
    </div>
  );
}

function completionPct(line: PoLineProgress): number {
  const ordered = Number(line.ordered);
  if (!ordered) return 0;
  return Math.min(100, Math.round((Number(line.received) / ordered) * 100));
}
