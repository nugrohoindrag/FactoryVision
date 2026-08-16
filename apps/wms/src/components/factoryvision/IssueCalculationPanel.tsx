import { formatWithUnit, type IssueLineBalance } from '@fv/domain';
import { cn } from '@/lib/utils';

/**
 * The L19 calculation panel (T-033).
 *
 *     Issued        100.00 kg
 *     Returned    −   8.00 kg
 *     Shrinkage   −   0.50 kg
 *     ─────────────────────────
 *     Consumed       91.50 kg
 *
 * It sits ABOVE the inputs and updates on every keystroke, because the number
 * an operator is reasoning about must be visible while they type — not
 * revealed after they submit.
 *
 * Colouring is level 1, neutral (UI Spec §6.4): this is an instrument, not a
 * warning. It only turns red when the arithmetic is impossible — returned
 * plus shrinkage exceeding what was issued — which is a data error, not a
 * status.
 *
 * Numbers are tabular and right-aligned so the column subtracts visually the
 * way it does arithmetically.
 */
export function IssueCalculationPanel({
  line,
  className,
}: {
  line: IssueLineBalance;
  className?: string;
}) {
  const row = (label: string, value: string, options?: { sign?: string; strong?: boolean }) => (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1',
        options?.strong && 'text-body-lg font-semibold',
      )}
    >
      <span className={cn('text-body-sm', options?.strong ? 'text-text-primary' : 'text-text-secondary')}>
        {label}
      </span>
      <span className="tabular-nums text-text-primary">
        {options?.sign && <span className="pr-1 text-text-secondary">{options.sign}</span>}
        {value}
      </span>
    </div>
  );

  return (
    <section
      aria-live="polite"
      className={cn(
        'rounded-card border border-border bg-card p-card',
        line.overAccounted && 'border-st-danger',
        className,
      )}
    >
      {row('Issued', formatWithUnit(line.issued, line.unit))}
      {row('Returned', formatWithUnit(line.returned, line.unit), { sign: '−' })}
      {row('Shrinkage', formatWithUnit(line.shrinkage, line.unit), { sign: '−' })}

      <div className="my-2 border-t border-border" />

      {row('Consumed', formatWithUnit(line.consumed, line.unit), { strong: true })}

      {line.overAccounted && (
        <p className="pt-3 text-body-sm text-st-danger">
          Returned and shrinkage add up to more than was issued. Check the figures — this cannot
          be saved.
        </p>
      )}
    </section>
  );
}
