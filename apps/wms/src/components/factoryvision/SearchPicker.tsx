import { Check, ChevronDown, Search } from 'lucide-react';
import * as React from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * SearchPicker — items in L06/L13/L15/L21, suppliers in L05, customers in K10.
 *
 * One picker, not one per entity: the interaction is identical and a second
 * copy would drift (UI Spec §5.1). Built on shadcn `command`, but it encodes
 * two rules the plain combobox does not:
 *
 * 1. **Recents appear before any typing.** L06 shows the five items last
 *    received from this supplier immediately — most deliveries repeat, and a
 *    tap beats a search every time. This is where the seconds are won.
 * 2. **A sheet on touch, not a dropdown.** A dropdown near the bottom of a
 *    phone is unreachable one-handed and collapses when the keyboard opens.
 *    The sheet keeps the search field and the list together.
 *
 * Search matches the code as well as the name — operators read the code off
 * the sack, not the product name.
 */

export interface PickerOption {
  id: string;
  name: string;
  /** SKU, partner code — whatever is printed on the physical thing. */
  code?: string;
  /** Extra line, e.g. base unit or phone number. */
  meta?: string;
  disabled?: boolean;
}

export interface SearchPickerProps {
  label: string;
  /** `undefined` while loading. */
  options: PickerOption[] | undefined;
  value?: string;
  onChange: (id: string) => void;
  /** Ids surfaced above the full list, in order. */
  recentIds?: string[];
  recentLabel?: string;
  allLabel?: string;
  required?: boolean;
  /** Opens the sheet on mount — L06 relies on this for its field order. */
  autoOpen?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function SearchPicker({
  label,
  options,
  value,
  onChange,
  recentIds = [],
  recentLabel = 'Recent',
  allLabel = 'All',
  required,
  autoOpen,
  placeholder = 'Search by name or code',
  emptyMessage = 'Nothing matches that.',
  error,
  disabled,
  className,
}: SearchPickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options?.find((o) => o.id === value);

  React.useEffect(() => {
    if (autoOpen && !disabled) setOpen(true);
  }, [autoOpen, disabled]);

  const recents = React.useMemo(
    () =>
      recentIds
        .map((id) => options?.find((o) => o.id === id))
        .filter((o): o is PickerOption => Boolean(o)),
    [recentIds, options],
  );

  const rest = React.useMemo(
    () => (options ?? []).filter((o) => !recentIds.includes(o.id)),
    [options, recentIds],
  );

  const renderOption = (option: PickerOption) => (
    <CommandItem
      key={option.id}
      value={`${option.name} ${option.code ?? ''}`}
      disabled={option.disabled}
      onSelect={() => {
        onChange(option.id);
        setOpen(false);
      }}
      className="min-h-touch gap-3"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-text-primary">{option.name}</p>
        {(option.code || option.meta) && (
          <p className="truncate text-body-sm text-text-secondary">
            {[option.code, option.meta].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      {value === option.id && <Check size={20} className="text-primary" aria-hidden />}
    </CommandItem>
  );

  return (
    <div className={cn('w-full', className)}>
      <Label className="mb-2 block">
        {label}
        {required && <span className="text-st-danger"> *</span>}
      </Label>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-invalid={Boolean(error)}
        className={cn(
          'flex h-input w-full items-center gap-3 rounded-input border border-border bg-card px-4 text-left',
          'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:bg-secondary disabled:text-text-disabled',
          error && 'border-st-danger',
        )}
      >
        <Search size={20} className="shrink-0 text-text-secondary" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              <span className="text-body text-text-primary">{selected.name}</span>
              {selected.code && (
                <span className="pl-2 text-body-sm text-text-secondary">{selected.code}</span>
              )}
            </>
          ) : (
            <span className="text-body text-text-disabled">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={20} className="shrink-0 text-text-secondary" aria-hidden />
      </button>

      {error && <p className="pt-2 text-body-sm text-st-danger">{error}</p>}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="h-[85dvh] p-0">
          <SheetHeader className="px-4 pt-4 text-left">
            <SheetTitle>{label}</SheetTitle>
          </SheetHeader>
          <Command className="h-full">
            <CommandInput placeholder={placeholder} className="text-body" />
            <CommandList className="max-h-[calc(85dvh-8rem)]">
              <CommandEmpty className="p-6 text-center text-body-sm text-text-secondary">
                {emptyMessage}
              </CommandEmpty>
              {recents.length > 0 && (
                <CommandGroup heading={recentLabel}>{recents.map(renderOption)}</CommandGroup>
              )}
              <CommandGroup heading={allLabel}>{rest.map(renderOption)}</CommandGroup>
            </CommandList>
          </Command>
        </SheetContent>
      </Sheet>
    </div>
  );
}
