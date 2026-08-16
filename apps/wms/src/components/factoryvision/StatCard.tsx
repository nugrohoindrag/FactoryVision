import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { IconChip } from '@/components/factoryvision/IconChip';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * StatCard — the KPI tile every office dashboard is built from (UI Spec §18).
 *
 * It exists because the six dashboard cards were six hand-assembled stacks of
 * `<p>` tags, which is how a dashboard ends up with five different ideas about
 * how big a number should be.
 *
 * Three things are deliberate:
 *
 * 1. **Tone is a DATA accent, not a status.** `teal`, `violet`, `amber` mean
 *    "a different quantity", nothing more. Only `success` and `danger` carry
 *    meaning, and a tile may not be red unless the number is genuinely bad —
 *    UI Spec D4 reserves red on a dashboard for overdue material issues, and
 *    a second red tile is what stops the first one from working.
 * 2. **The meter is proportion, never precision.** It shows how full the
 *    number is against its own ceiling. The digits are the truth; the bar is
 *    the glance.
 * 3. **Arrival is staggered by index**, so a grid resolves left-to-right
 *    instead of flashing in as one block. Flattened by prefers-reduced-motion.
 */

export type StatTone =
  | 'brand'
  | 'teal'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'cyan'
  | 'lime'
  | 'success'
  | 'danger'
  | 'neutral';

/** Each tone names the solid chip it uses and the bar that matches it. */
const TONE: Record<StatTone, { bar: string; value: string }> = {
  brand: { bar: 'bg-primary', value: 'text-text-primary' },
  teal: { bar: 'bg-data-teal', value: 'text-text-primary' },
  violet: { bar: 'bg-data-violet', value: 'text-text-primary' },
  amber: { bar: 'bg-data-amber', value: 'text-text-primary' },
  rose: { bar: 'bg-data-rose', value: 'text-text-primary' },
  cyan: { bar: 'bg-data-cyan', value: 'text-text-primary' },
  lime: { bar: 'bg-data-lime', value: 'text-text-primary' },
  success: { bar: 'bg-st-success', value: 'text-text-primary' },
  danger: { bar: 'bg-st-danger', value: 'text-st-danger-fg' },
  neutral: { bar: 'bg-st-neutral', value: 'text-text-primary' },
};

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** One line under the number — what the reader is meant to do about it. */
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  /** 0–1. Omit when the number has no meaningful ceiling. */
  meter?: number;
  /** Position in its grid, for the staggered arrival. */
  index?: number;
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  meter,
  index = 0,
  onClick,
  children,
  className,
}: StatCardProps) {
  const t = TONE[tone];

  const body = (
    <Card
      interactive={Boolean(onClick)}
      className={cn('fv-stagger group h-full', className)}
      style={{ '--fv-i': index } as React.CSSProperties}
    >
      <CardContent className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <p className="text-body-sm font-medium text-text-secondary">{label}</p>
          {Icon && <IconChip icon={Icon} tone={tone} className="group-hover:scale-110" />}
        </div>

        <p
          className={cn(
            'pt-2 text-h2 font-semibold leading-none tracking-tight tabular-nums',
            t.value,
          )}
        >
          {value}
        </p>

        {hint && <p className="pt-2 text-body-sm text-text-secondary">{hint}</p>}

        {children}

        {meter !== undefined && (
          // `mt-auto` pushes the meter to the bottom so tiles in a row line
          // their bars up; `pt-4` is the floor, because on a short tile
          // `mt-auto` resolves to zero and the bar ends up underlining the
          // hint text like a typo.
          <div className="mt-auto pt-4">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
              // The bar duplicates the number above it; screen readers get the
              // number, not a meter with no units.
              aria-hidden
            >
              <div
                className={cn('h-full origin-left rounded-full animate-grow-x', t.bar)}
                style={{ width: `${Math.round(Math.min(Math.max(meter, 0), 1) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (!onClick) return body;

  return (
    <button type="button" onClick={onClick} className="block h-full w-full text-left">
      {body}
    </button>
  );
}
