import * as React from 'react';
import { PhotoCapture } from '@/components/factoryvision/PhotoCapture';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * ReasonPicker — L10 (hold/reject), L19 (shrinkage), L25 (adjustment).
 *
 * The list is CLOSED, and that is the point. Free text cannot be grouped,
 * counted, or ranked by rupiah value — and the variance report is the report
 * factory owners actually want (PRD F6). A reason nobody can aggregate is the
 * same as no reason at all.
 *
 * The note stays free text on purpose: it captures the specific story the
 * closed list cannot. The list carries the reporting; the note carries the
 * detail; the photo carries the proof.
 *
 * Reasons are tenant configuration (K14), never constants.
 */

export interface ReasonPickerProps {
  label: string;
  reasons: string[];
  value?: string;
  onChange: (reason: string) => void;
  note?: string;
  onNoteChange?: (note: string) => void;
  photoIds?: string[];
  onPhotosChange?: (photoIds: string[]) => void;
  required?: boolean;
  error?: string;
  className?: string;
}

export function ReasonPicker({
  label,
  reasons,
  value,
  onChange,
  note,
  onNoteChange,
  photoIds,
  onPhotosChange,
  required,
  error,
  className,
}: ReasonPickerProps) {
  const groupId = React.useId();

  return (
    <div className={cn('w-full space-y-4', className)}>
      <div>
        <Label id={groupId} className="mb-2 block">
          {label}
          {required && <span className="text-st-danger"> *</span>}
        </Label>

        {/* Chips, not a dropdown: every option visible, one tap, glove-sized. */}
        <div role="radiogroup" aria-labelledby={groupId} className="flex flex-wrap gap-2">
          {reasons.map((reason) => {
            const selected = value === reason;
            return (
              <button
                key={reason}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(reason)}
                className={cn(
                  'min-h-touch rounded-btn border px-4 text-body-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground font-semibold'
                    : 'border-border bg-card text-text-primary hover:bg-secondary',
                )}
              >
                {reason}
              </button>
            );
          })}
        </div>

        {error && <p className="pt-2 text-body-sm text-st-danger">{error}</p>}
      </div>

      {onNoteChange && (
        <div>
          <Label htmlFor={`${groupId}-note`} className="mb-2 block">
            Note
          </Label>
          <Textarea
            id={`${groupId}-note`}
            value={note ?? ''}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="What happened, in your own words"
            rows={3}
            className="text-body"
          />
        </div>
      )}

      {onPhotosChange && (
        <PhotoCapture
          label="Photo"
          value={photoIds ?? []}
          onChange={onPhotosChange}
          max={2}
          hint="Optional — proof of the condition."
        />
      )}
    </div>
  );
}
