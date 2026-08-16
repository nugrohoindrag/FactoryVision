import { formatWithUnit, type Qty } from '@fv/domain';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * ItemRow — the same item line in L06, L15 and L21 (UI Spec §5).
 *
 * One component, variants — never a twin. If a screen needs a slightly
 * different look, it gets a variant here, not an `ItemRowCompact` (§5.1).
 *
 * Layout rule: the quantity is always right-aligned and tabular, so a column
 * of rows can be scanned down the numbers without reading the names.
 */

export interface ItemRowProps {
  name: string;
  /** SKU, batch number, location — whatever identifies this line concretely. */
  meta?: React.ReactNode;
  quantity?: Qty;
  unit?: string;
  /** Second line under the quantity, e.g. "of 60 kg requested". */
  quantityNote?: string;
  status?: React.ReactNode;
  /** Trailing control: a checkbox, a chevron, a menu. */
  action?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  /** Level 2 colouring (UI Spec §6.4) — a 3px status bar, never a filled row. */
  accent?: 'none' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  className?: string;
}

const ACCENT: Record<NonNullable<ItemRowProps['accent']>, string> = {
  none: '',
  success: 'border-l-[3px] border-l-st-success',
  warning: 'border-l-[3px] border-l-st-warning',
  danger: 'border-l-[3px] border-l-st-danger',
  info: 'border-l-[3px] border-l-st-info',
  neutral: 'border-l-[3px] border-l-st-neutral',
};

export function ItemRow({
  name,
  meta,
  quantity,
  unit,
  quantityNote,
  status,
  action,
  onClick,
  selected,
  accent = 'none',
  className,
}: ItemRowProps) {
  const interactive = Boolean(onClick);
  const Wrapper = interactive ? 'button' : 'div';

  return (
    <Wrapper
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={interactive && selected ? true : undefined}
      className={cn(
        'flex w-full min-h-row items-center gap-3 border-b border-border bg-card px-4 py-3 text-left',
        interactive && 'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        selected && 'bg-accent',
        ACCENT[accent],
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-text-primary">{name}</p>
        {meta && <div className="truncate pt-0.5 text-body-sm text-text-secondary">{meta}</div>}
      </div>

      {quantity !== undefined && unit && (
        <div className="shrink-0 text-right">
          <p className="text-body font-semibold tabular-nums text-text-primary">
            {formatWithUnit(quantity, unit)}
          </p>
          {quantityNote && <p className="text-caption text-text-secondary">{quantityNote}</p>}
        </div>
      )}

      {status && <div className="shrink-0">{status}</div>}
      {action && <div className="shrink-0">{action}</div>}
    </Wrapper>
  );
}
