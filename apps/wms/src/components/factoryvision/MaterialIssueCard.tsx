import { formatAge, formatMoney } from '@fv/domain';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from './StatusBadge';
import type { MaterialIssueStatus } from '@fv/contracts';

/**
 * MaterialIssueCard — L14, L17, K02 (UI Spec §5).
 *
 * The age is the loudest thing on the card, deliberately. An open material
 * issue is the product's defining metric (≥85% closed within 24 hours), and
 * the only pressure that actually closes them is seeing how long yours has
 * been sitting there (UI Spec §12).
 *
 * Colouring follows UI Spec §6.4 exactly:
 * - normal → **level 1**, plain white card
 * - past 24h **inside a list** → **level 2**, a 3px red left bar
 *
 * Never level 3 here. Twenty red-filled cards in a list are unreadable, and
 * the most urgent one disappears among them. The single solid card in this
 * product is K01's `Open material issues` tile, and only when something is
 * actually overdue.
 */

export interface MaterialIssueCardProps {
  workOrderNo: string;
  status: MaterialIssueStatus;
  ageHours: number;
  materialCount: number;
  requesterName?: string;
  /** Rupiah value — hidden from roles that may not see prices (PRD F13). */
  value?: string;
  overdueHours?: number;
  onClick?: () => void;
  className?: string;
}

export function MaterialIssueCard({
  workOrderNo,
  status,
  ageHours,
  materialCount,
  requesterName,
  value,
  overdueHours = 24,
  onClick,
  className,
}: MaterialIssueCardProps) {
  const overdue = status === 'OPEN' && ageHours >= overdueHours;
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('w-full text-left', className)}
    >
      <Card
        level={overdue ? 'accented' : 'neutral'}
        status={overdue ? 'danger' : 'none'}
        className={cn(onClick && 'hover:bg-accent')}
      >
        <CardContent className="flex items-center gap-4 p-card">
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold text-text-primary">{workOrderNo}</p>
            <p className="truncate pt-0.5 text-body-sm text-text-secondary">
              {materialCount} material{materialCount === 1 ? '' : 's'}
              {requesterName && ` · ${requesterName}`}
              {value && ` · ${formatMoney(value)}`}
            </p>
          </div>

          <div className="shrink-0 text-right">
            {/* Age is the headline number, not a footnote. */}
            <p
              className={cn(
                'text-h3 font-semibold tabular-nums',
                overdue ? 'text-st-danger' : 'text-text-primary',
              )}
            >
              {formatAge(ageHours)}
            </p>
            <div className="pt-1">
              <StatusBadge kind="issue" status={status} overdue={overdue} />
            </div>
          </div>
        </CardContent>
      </Card>
    </Wrapper>
  );
}
