import { add, formatAge, formatMoney, issueAgeHours, mul, ZERO } from '@fv/domain';
import { CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import { DEV_USERS } from '@/app/session';
import { StatusBadge } from '@/components/factoryvision/StatusBadge';
import { EmptyState } from '@/components/layout/Screen';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIssues, useProducts } from '@/db/hooks';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * K02 · Open issues monitor (UI Spec §12).
 *
 * The office view of L17, across every requester — the warehouse head's daily
 * screen. Same ordering rule: **age descending**, so the oldest debt is at the
 * top and cannot be avoided by scrolling past it.
 *
 * Value is shown here because this reader is allowed to see it, and because
 * "Rp 14 juta sitting on the production floor" is a sentence that gets an
 * issue closed while "3 open issues" does not.
 */
export function OpenIssuesMonitor() {
  const t = useTerm();
  const issues = useIssues();
  const products = useProducts();
  const config = useTenantConfig();

  const rows = useMemo(() => {
    if (!issues || !products) return [];
    const now = new Date();
    return [...issues.values()]
      .filter((issue) => issue.status !== 'CLOSED' && issue.handedOverAt)
      .map((issue) => ({
        issue,
        ageHours: issueAgeHours(issue.handedOverAt!, now),
        value: issue.lines.reduce((acc, line) => {
          const cost = products.find((p) => p.id === line.productId)?.averageCost;
          return cost ? add(acc, mul(line.issued, cost)) : acc;
        }, ZERO),
        requester: DEV_USERS.find((u) => u.id === issue.requestedBy)?.name ?? 'Unknown',
      }))
      .sort((a, b) => b.ageHours - a.ageHours);
  }, [issues, products]);

  const totalValue = rows.reduce((acc, row) => add(acc, row.value), ZERO);
  const overdue = rows.filter((row) => row.ageHours >= config.defaults.issueOverdueHours);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">
          {t('screen_open_issues_monitor')}
        </h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          {rows.length} open · {formatMoney(totalValue)} on the production floor
          {overdue.length > 0 && (
            <span className="font-semibold text-st-danger">
              {' '}
              · {overdue.length} past {config.defaults.issueOverdueHours}h
            </span>
          )}
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Every issue is closed"
          body="Nothing is outstanding on the production floor. This is the state the whole system is trying to hold."
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card shadow-1">
          <Table minWidth="40rem">
            <TableHeader>
              <tr>
                <TableHead>Age</TableHead>
                <TableHead>Work order</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Materials</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Status</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map(({ issue, ageHours, value, requester }) => {
                const isOverdue = ageHours >= config.defaults.issueOverdueHours;
                return (
                  <TableRow
                    key={issue.issueId}
                    // Level 2: a bar, not a fill. Twenty red rows read as none.
                    className={cn(isOverdue && 'border-l-[3px] border-l-st-danger')}
                  >
                    <TableCell
                      className={cn('font-semibold tabular-nums', isOverdue && 'text-st-danger')}
                    >
                      {formatAge(ageHours)}
                    </TableCell>
                    <TableCell>
                      {issue.workOrderNo ?? issue.issueId.slice(0, 8)}
                      {issue.quick && (
                        <span className="pl-2 text-caption text-text-secondary">quick</span>
                      )}
                    </TableCell>
                    <TableCell className="text-text-secondary">{requester}</TableCell>
                    <TableCell className="text-text-secondary">{issue.lines.length}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(value)}</TableCell>
                    <TableCell>
                      <StatusBadge kind="issue" status={issue.status} overdue={isOverdue} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
