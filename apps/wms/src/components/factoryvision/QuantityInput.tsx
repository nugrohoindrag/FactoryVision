import { Minus, Plus } from 'lucide-react';
import * as React from 'react';
import { add, gte, isValidQty, lte, qty, sub, type Qty, ZERO } from '@fv/domain';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * QuantityInput — used in L06, L18, L19 (UI Spec §5).
 *
 * This component carries the ≤20 second target more than any other. Design
 * consequences, each of them deliberate:
 *
 * - **`inputMode="decimal"`** opens the numeric keypad straight away. An
 *   operator holding a sack does not have time to switch keyboard modes.
 * - **Stepper buttons are ≥48dp** and sit either side of the field, reachable
 *   with a thumb, and workable with gloves (PRD §10 physical resilience).
 * - **The unit suffix lives inside the field** so the value and its unit are
 *   read as one thing, never mismatched.
 * - **The value is a decimal STRING throughout.** It never becomes a `number`,
 *   not even briefly — that is how 0.1 + 0.2 gets into the stock card
 *   (Tech Stack §2.4).
 * - **Comma is accepted as a decimal separator** because Indonesian keyboards
 *   produce it and operators type it; it is normalised to a dot on the way in.
 */

export interface QuantityInputProps {
  id?: string;
  label: string;
  value: Qty;
  onChange: (value: Qty) => void;
  unit: string;
  /** Stepper increment. Default 1; use 0.5 or 0.1 for weighed materials. */
  step?: Qty;
  min?: Qty;
  max?: Qty;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Shown under the field. Replaced by `error` when invalid. */
  hint?: string;
  error?: string;
  /** Secondary reading, e.g. "= 75 kg" when entering sacks. */
  conversionHint?: string;
  className?: string;
}

/** Accepts what an operator actually types; rejects what cannot be a quantity. */
function normalise(raw: string): string {
  return raw.replace(',', '.').replace(/[^\d.]/g, '');
}

export const QuantityInput = React.forwardRef<HTMLInputElement, QuantityInputProps>(
  function QuantityInput(
    {
      id,
      label,
      value,
      onChange,
      unit,
      step = '1',
      min = ZERO,
      max,
      required,
      disabled,
      autoFocus,
      hint,
      error,
      conversionHint,
      className,
    },
    forwardedRef,
  ) {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const describedBy = `${inputId}-help`;

    // While typing, the field holds raw text ("12." is a legal intermediate
    // state that is not yet a valid decimal). It is only normalised on blur.
    const [draft, setDraft] = React.useState<string | null>(null);
    const shown = draft ?? value;

    const canDecrease = !disabled && (min === undefined || gte(sub(value || ZERO, step), min));
    const canIncrease = !disabled && (max === undefined || lte(add(value || ZERO, step), max));

    const bump = (direction: 1 | -1) => {
      const base = isValidQty(value) ? value : ZERO;
      const next = direction === 1 ? add(base, step) : sub(base, step);
      if (min !== undefined && lte(next, min) && !gte(next, min)) return;
      setDraft(null);
      onChange(qty(next));
    };

    const handleChange = (raw: string) => {
      const cleaned = normalise(raw);
      setDraft(cleaned);
      // Report every keystroke that forms a valid number, so the L19 panel
      // and the unit conversion hint update live as the operator types.
      if (isValidQty(cleaned)) onChange(cleaned);
      else if (cleaned === '') onChange(ZERO);
    };

    return (
      <div className={cn('w-full', className)}>
        <Label htmlFor={inputId} className="mb-2 block">
          {label}
          {required && <span className="text-st-danger"> *</span>}
        </Label>

        <div className="flex items-stretch gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-input w-input shrink-0"
            disabled={!canDecrease}
            onClick={() => bump(-1)}
            aria-label={`Decrease ${label}`}
            aria-controls={inputId}
          >
            <Minus aria-hidden />
          </Button>

          <div className="relative flex-1">
            <input
              id={inputId}
              ref={forwardedRef}
              // `decimal` gives the numeric keypad with a separator key;
              // `numeric` would hide the decimal point entirely.
              inputMode="decimal"
              type="text"
              autoComplete="off"
              autoFocus={autoFocus}
              disabled={disabled}
              required={required}
              value={shown}
              onChange={(e) => handleChange(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                setDraft(null);
                if (isValidQty(shown)) onChange(qty(shown));
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={hint || error || conversionHint ? describedBy : undefined}
              className={cn(
                'h-input w-full rounded-input border border-border bg-card pl-4 text-h3 font-semibold tabular-nums text-text-primary',
                'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:bg-secondary disabled:text-text-disabled',
                error && 'border-st-danger',
              )}
              // Room for the unit suffix, scaled to its length.
              style={{ paddingRight: `${unit.length + 2}ch` }}
            />
            <span
              className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-body font-medium text-text-secondary"
              aria-hidden
            >
              {unit}
            </span>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-input w-input shrink-0"
            disabled={!canIncrease}
            onClick={() => bump(1)}
            aria-label={`Increase ${label}`}
            aria-controls={inputId}
          >
            <Plus aria-hidden />
          </Button>
        </div>

        {(error || hint || conversionHint) && (
          <p
            id={describedBy}
            className={cn(
              'pt-2 text-body-sm',
              error ? 'text-st-danger' : 'text-text-secondary',
            )}
          >
            {error ?? conversionHint ?? hint}
          </p>
        )}
      </div>
    );
  },
);
