import type { Product } from '@fv/contracts';
import { formatMoney, formatWithUnit, type VarianceLine } from '@fv/domain';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * VarianceTable — K08 and K12 (UI Spec §5, §16).
 *
 * **Always ordered by rupiah, descending. It is not a sortable column.**
 * A 2 kg discrepancy in something expensive matters more than 500 kg of
 * cardboard, and a table that can be re-sorted by quantity will be — burying
 * the finding that justified the whole stock take (UI Spec §16 K08).
 *
 * The system quantity appears here and nowhere near L23. This is the
 * reconciliation, which is precisely the moment the blind count ends.
 */
export function VarianceTable({
  lines,
  products,
  className,
}: {
  lines: VarianceLine[];
  products: Product[];
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-card', className)}>
      <Table minWidth="44rem">
        <TableHeader>
          <tr>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">System</TableHead>
            <TableHead className="text-right">Counted</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            {/* The column the ordering follows, and the one owners read. */}
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Status</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const product = products.find((p) => p.id === line.ref.productId);
            const unit = product?.baseUnit ?? '';
            const short = line.variance.startsWith('-');
            const exact = line.variance === '0';

            return (
              <TableRow key={line.key}>
                <TableCell>
                  <p>{product?.name ?? 'Unknown item'}</p>
                  <p className="text-caption text-text-secondary">{product?.sku}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums text-text-secondary">
                  {formatWithUnit(line.systemQuantity, unit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatWithUnit(line.countedQuantity, unit)}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-semibold tabular-nums',
                    exact ? 'text-text-secondary' : short ? 'text-st-danger' : 'text-st-info',
                  )}
                >
                  {exact ? '—' : `${short ? '' : '+'}${formatWithUnit(line.variance, unit)}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.valueImpact === '0' ? '—' : formatMoney(line.valueImpact)}
                </TableCell>
                <TableCell>
                  {line.needsRecount ? (
                    <Badge variant="warning">Recount</Badge>
                  ) : exact ? (
                    <Badge variant="success">Match</Badge>
                  ) : (
                    <Badge variant="violet">Round {line.round}</Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
