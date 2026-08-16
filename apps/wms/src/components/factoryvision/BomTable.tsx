import type { Bom } from '@fv/contracts';
import { formatQuantity, type ExplodedLine } from '@fv/domain';
import { AlertTriangle, ChevronDown, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * BomTable — K17 (edit) and L13 (read) (UI Spec §5, added v2.1).
 *
 * Two modes, one component, because a recipe read differently in two places is
 * a recipe two people will describe differently.
 *
 * ## The collapse decision (UI Spec §26.7)
 *
 * In read mode the list is COLLAPSED by default — but lines with a problem
 * stay visible even when collapsed.
 *
 * Twelve rows on a 360px screen means production scrolls before it can send,
 * and that runs straight into the <30s target that decides whether the core
 * flow is used at all (Risiko #1). BOM exists to REDUCE production's work;
 * showing all of it hands the work back as scrolling.
 *
 * But collapsing everything means production sends a request, waits, and only
 * then learns a material is short. So what gets folded away is *what is
 * already correct*. What needs a decision is never folded.
 */

export interface BomTableReadProps {
  mode: 'read';
  lines: ExplodedLine[];
  productNameOf: (productId: string) => string;
  /** Lines the warehouse cannot cover — always visible, collapsed or not. */
  shortProductIds?: string[];
  className?: string;
}

export interface BomTableEditProps {
  mode: 'edit';
  bom: Bom;
  productNameOf: (productId: string) => string;
  onChangeLine: (lineId: string, quantity: string) => void;
  onRemoveLine: (lineId: string) => void;
  className?: string;
}

export type BomTableProps = BomTableReadProps | BomTableEditProps;

export function BomTable(props: BomTableProps) {
  if (props.mode === 'edit') return <EditTable {...props} />;
  return <ReadList {...props} />;
}

function ReadList({ lines, productNameOf, shortProductIds = [], className }: BomTableReadProps) {
  // Collapsed on phones, open from `md` up: the reason to collapse is scroll,
  // and above md there is room (UI Spec L13).
  const [open, setOpen] = React.useState(false);
  const short = new Set(shortProductIds);
  const problemLines = lines.filter((l) => short.has(l.productId));

  if (lines.length === 0) return null;

  return (
    <div className={cn('rounded-card border border-border bg-card', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-touch w-full items-center justify-between gap-2 px-card py-3 text-left"
      >
        {/* The header names a NUMBER, not a word: production needs to know how
            many there are without opening it. */}
        <span className="text-body font-medium text-text-primary">
          {lines.length} material{lines.length === 1 ? '' : 's'} from BOM
        </span>
        <ChevronDown
          aria-hidden
          className={cn('size-5 shrink-0 text-text-secondary transition-transform', open && 'rotate-180')}
        />
      </button>

      {/* Always visible, collapsed or not. Folding a shortage away is how
          production ends up waiting for material that was never there. */}
      {!open && problemLines.length > 0 && (
        <ul className="border-t border-border">
          {problemLines.map((line) => (
            <li
              key={line.productId}
              className="flex items-start gap-2 border-l-[3px] border-l-st-warning px-card py-3"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-st-warning" />
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-text-primary">
                  {productNameOf(line.productId)}
                </p>
                <p className="text-body-sm text-st-warning">
                  {formatQuantity(line.requiredQuantity)} {line.unit} needed · not enough in stock
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ul className="border-t border-border">
          {lines.map((line) => {
            const isShort = short.has(line.productId);
            return (
              <li
                key={line.productId}
                className={cn(
                  'flex items-center justify-between gap-3 px-card py-3',
                  isShort && 'border-l-[3px] border-l-st-warning',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                  {productNameOf(line.productId)}
                </span>
                <span className="shrink-0 tabular-nums text-body font-medium text-text-primary">
                  {formatQuantity(line.requiredQuantity)} {line.unit}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EditTable({
  bom,
  productNameOf,
  onChangeLine,
  onRemoveLine,
  className,
}: BomTableEditProps) {
  if (bom.lines.length === 0) {
    return (
      <p className={cn('py-6 text-center text-body text-text-secondary', className)}>
        No materials yet. Add the first one to build the recipe.
      </p>
    );
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[32rem] border-collapse text-body">
        <thead>
          <tr className="border-b border-border text-left text-body-sm text-text-secondary">
            <th scope="col" className="py-2 pr-3 font-medium">Item</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Standard</th>
            <th scope="col" className="py-2 pr-3 font-medium">Unit</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Shrink %</th>
            <th scope="col" className="py-2 w-12">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {bom.lines.map((line) => (
            <tr key={line.id} className="border-b border-border last:border-0">
              <td className="py-2 pr-3 text-text-primary">{productNameOf(line.productId)}</td>
              <td className="py-2 pr-3 text-right">
                <input
                  inputMode="decimal"
                  value={line.standardQuantity}
                  onChange={(e) => onChangeLine(line.id, e.target.value.replace(',', '.'))}
                  aria-label={`Standard quantity for ${productNameOf(line.productId)}`}
                  className="h-touch-sm w-24 rounded-input border border-border bg-card px-2 text-right tabular-nums"
                />
              </td>
              <td className="py-2 pr-3 text-text-secondary">{line.unit}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-text-secondary">
                {line.standardShrinkagePct ?? '—'}
              </td>
              <td className="py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveLine(line.id)}
                  aria-label={`Remove ${productNameOf(line.productId)}`}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
