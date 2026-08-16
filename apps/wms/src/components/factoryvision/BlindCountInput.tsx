import { isValidQty, qty, ZERO, type Qty } from '@fv/domain';
import * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * BlindCountInput — L23 and L24 only (UI Spec §5, §16).
 *
 * **This component is structurally incapable of displaying a system
 * quantity.** There is no prop for one, no slot for one, and no way to pass
 * one in. That is the entire reason it exists as a separate component rather
 * than a `showSystemQty={false}` flag on QuantityInput: a flag can be enabled
 * by accident, in a hurry, by someone who does not know why it is there — and
 * once a counter has seen the system figure, every number in that stock take
 * is worthless (acceptance §23.6).
 *
 * Do not add a `systemQuantity`, `expected`, `variance`, or `hint` prop to
 * this file. If a screen needs one, that screen is not a blind count.
 *
 * The stepper is deliberately absent too: stepping from a pre-filled value
 * would leak an anchor. A blind count starts empty and is typed.
 */

export interface BlindCountInputProps {
  label: string;
  value: Qty | '';
  onChange: (value: Qty) => void;
  unit: string;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
}

export function BlindCountInput({
  label,
  value,
  onChange,
  unit,
  autoFocus,
  disabled,
  error,
  className,
}: BlindCountInputProps) {
  const id = React.useId();
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? value;

  return (
    <div className={cn('w-full', className)}>
      <Label htmlFor={id} className="mb-2 block">
        {label}
      </Label>

      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={shown}
          placeholder="0"
          onChange={(e) => {
            const cleaned = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
            setDraft(cleaned);
            if (isValidQty(cleaned)) onChange(cleaned);
            else if (cleaned === '') onChange(ZERO);
          }}
          onBlur={() => {
            setDraft(null);
            if (isValidQty(shown)) onChange(qty(shown));
          }}
          aria-invalid={Boolean(error)}
          className={cn(
            // Oversized numerals: counted standing, at arm's length, in poor light.
            'h-[calc(var(--size-input)*1.3)] w-full rounded-input border border-border bg-card pl-4 text-h1 font-semibold tabular-nums text-text-primary',
            'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:bg-secondary disabled:text-text-disabled',
            error && 'border-st-danger',
          )}
          style={{ paddingRight: `${unit.length + 2}ch` }}
        />
        <span
          className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-body-lg font-medium text-text-secondary"
          aria-hidden
        >
          {unit}
        </span>
      </div>

      {error && <p className="pt-2 text-body-sm text-st-danger">{error}</p>}
    </div>
  );
}
