import type { DefectReason } from '@fv/contracts';
import { formatQuantity, gt, sub, type Qty, ZERO } from '@fv/domain';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PhotoCapture } from './PhotoCapture';
import { QuantityInput } from './QuantityInput';
import { ReasonPicker } from './ReasonPicker';

/**
 * DefectQuantityField — L06 only (UI Spec §5, added v2.1).
 *
 * ## Why this is a component and not a prop
 *
 * It could have been `<QuantityInput showDefect />`. It is not, for the same
 * reason `BlindCountInput` is separate: a prop gets switched on somewhere it
 * should not be, and here every extra tap is paid for out of the ≤20 second
 * budget that decides whether the product lives (PRD Risiko #4).
 *
 * ## Why it opens inline, under Quantity
 *
 * `Defect quantity` is a PART OF `Quantity`, not a separate figure. A sheet
 * would cover the parent number at exactly the moment the operator needs to
 * compare the two — "of the 100 that came off the truck, 3 are wet" is one
 * thought, not two screens. Placed at the end of the form instead, it reads as
 * a fifth standalone number and gets entered as an addition rather than a
 * part, which corrupts stock immediately (UI Spec L06).
 *
 * Level 2 colouring (§6.4): a 3px left bar, never a solid fill. This is a form
 * being filled in, not an alert to be read across the room, and L06 already
 * has one primary action that must stay the loudest thing on screen.
 */

export interface DefectQuantityFieldProps {
  /** The parent figure. Defect can never exceed it. */
  receivedQuantity: Qty;
  unit: string;
  quantity: Qty;
  onQuantityChange: (value: Qty) => void;
  reason: DefectReason | null;
  onReasonChange: (reason: DefectReason) => void;
  photoIds: string[];
  onPhotoChange: (ids: string[]) => void;
  /** Closing is as cheap as opening — see `Remove defect` in L06. */
  onRemove: () => void;
  className?: string;
}

/**
 * Closed list (K14 default). Labels are what an operator reads; codes are what
 * the event stores, because a label that changes must not rewrite history.
 */
const DEFECT_REASONS: Record<string, DefectReason> = {
  'Damaged in transit': 'DAMAGED_IN_TRANSIT',
  'Wrong item': 'WRONG_ITEM',
  'Wet / contaminated': 'WET_CONTAMINATED',
  'Short shelf life': 'SHORT_SHELF_LIFE',
  'Quality below spec': 'BELOW_SPEC',
};

const REASON_LABELS = Object.keys(DEFECT_REASONS);

const labelFor = (code: DefectReason | null): string | undefined =>
  REASON_LABELS.find((label) => DEFECT_REASONS[label] === code);

export function DefectQuantityField({
  receivedQuantity,
  unit,
  quantity,
  onQuantityChange,
  reason,
  onReasonChange,
  photoIds,
  onPhotoChange,
  onRemove,
  className,
}: DefectQuantityFieldProps) {
  const exceeds = gt(quantity, receivedQuantity || ZERO);
  const toStock = exceeds ? ZERO : sub(receivedQuantity || ZERO, quantity || ZERO);

  return (
    <section
      // Level 2 (§6.4): accent bar carries the status, the surface stays calm.
      className={cn(
        'rounded-card border border-st-danger/40 border-l-[3px] border-l-st-danger bg-card p-card',
        className,
      )}
      aria-label="Defect details"
    >
      <div className="flex items-center justify-between gap-2 pb-3">
        <h3 className="text-body font-semibold text-text-primary">Defect</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-touch-sm"
        >
          <X aria-hidden className="mr-1 size-4" />
          Remove defect
        </Button>
      </div>

      <div className="space-y-4">
        <QuantityInput
          label="Defect quantity"
          value={quantity}
          onChange={onQuantityChange}
          unit={unit}
          required
          autoFocus
          max={receivedQuantity}
          error={exceeds ? `Cannot exceed the ${formatQuantity(receivedQuantity)} ${unit} received` : undefined}
        />

        {/* Both mandatory. Without a reason the supplier conversation has no
            basis, and without a photo it has no evidence. */}
        <ReasonPicker
          label="Defect reason"
          required
          reasons={REASON_LABELS}
          value={labelFor(reason)}
          onChange={(label) => onReasonChange(DEFECT_REASONS[label]!)}
        />

        <PhotoCapture
          label="Photo of defect"
          required
          max={2}
          value={photoIds}
          onChange={onPhotoChange}
          hint="This is the evidence used to bill the supplier."
        />

        {/* The conclusion of this block, and the last line in it: the operator
            should never have to do this subtraction in their head. */}
        <p className="border-t border-border pt-3 text-body font-semibold tabular-nums text-text-primary">
          → {formatQuantity(toStock)} {unit} to stock
        </p>
      </div>
    </section>
  );
}
