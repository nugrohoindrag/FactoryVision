import { AlertTriangle, Check } from 'lucide-react';
import type { ColumnMapping, ImportTarget } from '@/lib/excel/importTargets';
import type { CellValue } from '@/lib/excel/parseWorkbook';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toLocalDate } from '@fv/domain';

/**
 * ExcelMappingTable — K06 step 3 (UI Spec §19).
 *
 * Shows the system's guess for every field, editable in one tap, with **live
 * sample values from the file beside each row**. The samples are the point:
 * a mapping is only verifiable if you can see what would come through it. A
 * dropdown of column names alone makes the user open Excel in another window
 * to check — and that is where a demo stalls.
 *
 * Unmapped required fields are called out immediately rather than at import
 * time, so nothing is discovered after a two-minute parse.
 */

const NONE = '__none__';

export interface ExcelMappingTableProps {
  target: ImportTarget;
  headers: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  /** First few data rows, used to show what each mapping would actually read. */
  sampleRows: CellValue[][];
  className?: string;
}

export function ExcelMappingTable({
  target,
  headers,
  mapping,
  onChange,
  sampleRows,
  className,
}: ExcelMappingTableProps) {
  const samplesFor = (columnIndex: number | null | undefined): string => {
    if (columnIndex === null || columnIndex === undefined) return '—';
    const values = sampleRows
      .map((row) => row[columnIndex])
      .filter((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
      .slice(0, 3)
      .map((cell) => (cell instanceof Date ? toLocalDate(cell) : String(cell)));
    return values.length === 0 ? 'no values in this column' : values.join(' · ');
  };

  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-card', className)}>
      <Table minWidth="36rem">
        <TableHeader>
          <tr>
            <TableHead>System field</TableHead>
            <TableHead>Column in your file</TableHead>
            <TableHead>What it reads</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {target.fields.map((field) => {
            const columnIndex = mapping[field.key] ?? null;
            const missing = field.required && columnIndex === null;

            return (
              <TableRow
                key={field.key}
                className={cn('align-top', missing && 'bg-st-danger-bg hover:bg-st-danger-bg')}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">{field.label}</span>
                    {field.required && <Badge>required</Badge>}
                  </div>
                  {field.help && (
                    <p className="pt-1 text-caption text-text-secondary">{field.help}</p>
                  )}
                </TableCell>

                <TableCell>
                  <Select
                    value={columnIndex === null ? NONE : String(columnIndex)}
                    onValueChange={(value) =>
                      onChange({
                        ...mapping,
                        [field.key]: value === NONE ? null : Number(value),
                      })
                    }
                  >
                    <SelectTrigger className="h-control-sm w-full min-w-[12rem]">
                      <SelectValue placeholder="Not imported" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not imported</SelectItem>
                      {headers.map((header, index) => (
                        <SelectItem key={`${header}-${index}`} value={String(index)}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                <TableCell>
                  <div className="flex items-start gap-2">
                    {missing ? (
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-st-danger" aria-hidden />
                    ) : columnIndex !== null ? (
                      <Check size={16} className="mt-0.5 shrink-0 text-st-success" aria-hidden />
                    ) : null}
                    <span className={cn('text-text-secondary', missing && 'text-st-danger-fg')}>
                      {missing
                        ? 'Pick the column that holds this, or the rows will be rejected.'
                        : samplesFor(columnIndex)}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
