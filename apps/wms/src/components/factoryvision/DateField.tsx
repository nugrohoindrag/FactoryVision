import { formatDate } from '@fv/domain';
import { CalendarIcon } from 'lucide-react';
import * as React from 'react';
import { useDensity } from '@/app/density';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * DateField — received date, expiry date, production date, shipment date.
 *
 * Two implementations behind one label, chosen by input method:
 *
 * - **Touch → the native date input.** Android's own picker is faster than any
 *   custom calendar, is already familiar, and its targets are sized by the OS.
 *   On a receiving dock, that difference is measured in seconds per item.
 * - **Mouse → shadcn `calendar` in a `popover`** (UI Spec §5.1 step 3), where a
 *   month grid genuinely beats typing.
 *
 * The value is always an ISO `YYYY-MM-DD` string — never a `Date`, which
 * would drag timezone drift into an expiry date that must not move.
 */

export interface DateFieldProps {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  hint?: string;
  error?: string;
  className?: string;
}

const toIso = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function DateField({
  label,
  value,
  onChange,
  required,
  disabled,
  min,
  max,
  hint,
  error,
  className,
}: DateFieldProps) {
  const density = useDensity();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);

  const help = error ?? hint;

  return (
    <div className={cn('w-full', className)}>
      <Label htmlFor={id} className="mb-2 block">
        {label}
        {required && <span className="text-st-danger"> *</span>}
      </Label>

      {density === 'touch' ? (
        <input
          id={id}
          type="date"
          value={value ?? ''}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          className={cn(
            'h-input w-full rounded-input border border-border bg-card px-4 text-body text-text-primary',
            'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:bg-secondary disabled:text-text-disabled',
            error && 'border-st-danger',
          )}
        />
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              disabled={disabled}
              aria-invalid={Boolean(error)}
              className={cn(
                'h-input w-full justify-start gap-3 px-4 font-normal',
                !value && 'text-text-disabled',
                error && 'border-st-danger',
              )}
            >
              <CalendarIcon aria-hidden />
              {value ? formatDate(value) : 'Select a date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={value ? new Date(`${value}T00:00:00`) : undefined}
              onSelect={(date) => {
                if (date) onChange(toIso(date));
                setOpen(false);
              }}
              disabled={(date) => {
                const iso = toIso(date);
                return Boolean((min && iso < min) || (max && iso > max));
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      )}

      {help && (
        <p className={cn('pt-2 text-body-sm', error ? 'text-st-danger' : 'text-text-secondary')}>
          {help}
        </p>
      )}
    </div>
  );
}
