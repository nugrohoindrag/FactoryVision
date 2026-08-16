import { Check } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * TwoPartyConfirm — L16 handover (UI Spec §5, §11).
 *
 * A handover is the moment stock leaves the warehouse and becomes the
 * production floor's responsibility, and the material issue starts ageing.
 * If only one person confirms it, the disagreement afterwards has no record —
 * which is exactly problem M8 (PRD §3).
 *
 * Both parties confirm on the same device, one after the other, each with
 * their name recorded. A signature pad was considered and rejected: it needs
 * a stylus or a clean finger, and neither exists on a receiving dock.
 *
 * The second confirmation is deliberately NOT enabled until the first is
 * done — sequence is what makes it two parties rather than one person
 * tapping twice without looking.
 */

export interface TwoPartyConfirmProps {
  giverLabel: string;
  giverName: string;
  receiverLabel: string;
  receiverName: string;
  giverConfirmed: boolean;
  receiverConfirmed: boolean;
  onGiverConfirm: () => void;
  onReceiverConfirm: () => void;
  className?: string;
}

function Party({
  label,
  name,
  confirmed,
  disabled,
  onConfirm,
}: {
  label: string;
  name: string;
  confirmed: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-card border p-card',
        confirmed ? 'border-st-success bg-st-success-bg' : 'border-border bg-card',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </p>
        <p className="truncate pt-1 text-body font-medium text-text-primary">{name}</p>
      </div>

      {confirmed ? (
        <span className="flex items-center gap-2 text-body-sm font-semibold text-st-success-fg">
          <Check size={20} aria-hidden />
          Confirmed
        </span>
      ) : (
        <Button type="button" size="sm" disabled={disabled} onClick={onConfirm}>
          Confirm
        </Button>
      )}
    </div>
  );
}

export function TwoPartyConfirm({
  giverLabel,
  giverName,
  receiverLabel,
  receiverName,
  giverConfirmed,
  receiverConfirmed,
  onGiverConfirm,
  onReceiverConfirm,
  className,
}: TwoPartyConfirmProps) {
  const groupId = React.useId();

  return (
    <div className={cn('w-full space-y-3', className)}>
      <Label id={groupId} className="block">
        Both parties confirm
      </Label>

      <Party
        label={giverLabel}
        name={giverName}
        confirmed={giverConfirmed}
        onConfirm={onGiverConfirm}
      />

      <Party
        label={receiverLabel}
        name={receiverName}
        confirmed={receiverConfirmed}
        // Order is enforced: the goods are handed over, then received.
        disabled={!giverConfirmed}
        onConfirm={onReceiverConfirm}
      />

      {!giverConfirmed && (
        <p className="text-body-sm text-text-secondary">
          Hand the phone over after you confirm. Both names are recorded against this handover.
        </p>
      )}
    </div>
  );
}
