import { formatMoney, formatWithUnit, todayLocal, usageVariance } from '@fv/domain';
import { Download } from 'lucide-react';
import { useMemo } from 'react';
import { EmptyState } from '@/components/layout/Screen';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIssues, useProducts } from '@/db/hooks';
import { exportToExcel } from '@/lib/export/exportTable';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * K12 · Usage variance report (UI Spec §20, PRD F6).
 *
 * "The report factory owners look for most" — how much material a job actually
 * consumed against what it should have.
 *
 * **In P0 there is no BOM**, so the comparator is the historical average per
 * closed issue rather than a standard. That is genuinely weaker, and the
 * screen says so in plain words rather than presenting an average as if it
 * were an engineering standard. A number a factory over-trusts is worse than
 * one it understands the limits of. The real standard arrives with F21 in P1.
 *
 * Ordered by rupiah, like every variance view in the product.
 */
export function UsageVariance() {
  const t = useTerm();
  const issues = useIssues();
  const products = useProducts();

  const rows = useMemo(() => {
    if (!issues || !products) return [];
    return usageVariance([...issues.values()], products);
  }, [issues, products]);

  const nameOf = (id: string) => products?.find((p) => p.id === id)?.name ?? 'Unknown item';
  const unitOf = (id: string) => products?.find((p) => p.id === id)?.baseUnit ?? '';

  const download = () =>
    void exportToExcel(
      `usage-variance-${todayLocal()}`,
      [
        { header: 'Material', value: (r: (typeof rows)[number]) => nameOf(r.productId) },
        { header: 'Actual', value: (r: (typeof rows)[number]) => r.actual },
        { header: 'Historical average', value: (r: (typeof rows)[number]) => r.benchmark },
        { header: 'Variance', value: (r: (typeof rows)[number]) => r.variance },
        { header: 'Value impact', value: (r: (typeof rows)[number]) => r.valueImpact },
      ],
      rows,
    );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">{t('variance')}</h1>
          <p className="pt-1 text-body-sm text-text-secondary">
            Ordered by rupiah impact, highest first.
          </p>
        </div>
        {rows.length > 0 && (
          <Button variant="outline" onClick={download}>
            <Download aria-hidden />
            Excel
          </Button>
        )}
      </header>

      {/* Say what the comparator actually is. Do not dress it up. */}
      <Alert>
        <AlertTitle>Compared against history, not a standard</AlertTitle>
        <AlertDescription>
          This version has no bill of materials, so "expected" here is the average this material
          has consumed across previous closed issues. It shows drift, not engineering deviation.
          A real standard arrives with the BOM feature.
        </AlertDescription>
      </Alert>

      {rows.length === 0 ? (
        <EmptyState
          title="Not enough history yet"
          body="A material needs at least two closed issues before an average means anything. Close a few more and this fills in."
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card shadow-1">
          <Table minWidth="40rem">
            <TableHeader>
              <tr>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Historical average</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Value impact</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const over = !row.variance.startsWith('-') && row.variance !== '0';
                return (
                  <TableRow key={row.productId}>
                    <TableCell>{nameOf(row.productId)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatWithUnit(row.actual, unitOf(row.productId))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-text-secondary">
                      {formatWithUnit(row.benchmark, unitOf(row.productId))}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        over ? 'text-st-danger' : 'text-st-success',
                      )}
                    >
                      {over ? '+' : ''}
                      {formatWithUnit(row.variance, unitOf(row.productId))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.valueImpact)}
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
