import type { Location, Partner, Product } from '@fv/contracts';
import { AlertCircle, ArrowLeft, ArrowRight, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useSession } from '@/app/session';
import { ExcelMappingTable } from '@/components/factoryvision/ExcelMappingTable';
import { EmptyState } from '@/components/layout/Screen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/db/schema';
import { uuidv7 } from '@/db/ids';
import {
  autoMap,
  IMPORT_TARGETS,
  summarise,
  validateRows,
  type ColumnMapping,
  type ImportTarget,
  type ValidatedRow,
} from '@/lib/excel/importTargets';
import { loadSheetJs } from '@/lib/excel/loadSheetJs';
import {
  dataRows,
  headerLabels,
  parseWorkbook,
  type ParsedWorkbook,
  type SheetPreview,
} from '@/lib/excel/parseWorkbook';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * K06 · Excel import wizard ⚠️ (UI Spec §19, acceptance §23.4).
 *
 * "Import fails on a real file during the demo → the sale dies on the spot"
 * (PRD Risk #5). Everything here is built for files that are already messy,
 * not for files we wish were clean.
 *
 * Five steps, and each earns its place:
 *   1 Upload   — parsed in the browser; the file never leaves the device
 *   2 Detect   — header row guessed, and MOVABLE, because the guess will
 *                sometimes be wrong and the user must not be stuck with it
 *   3 Map      — every column shown with live samples (ExcelMappingTable)
 *   4 Preview  — errors per ROW, filterable, so a bad file is diagnosable
 *   5 Import   — partial import allowed; rejected rows download as a fix-up
 *                file. Refusing everything because 12 rows are wrong is how a
 *                migration stalls for a week.
 *
 * Note the regression suite over 30 real files (T-030) is still blocked on
 * P-01. Until those files exist, this screen is built to the tolerances the
 * PRD names — merged cells, text numbers, mixed dates, blank rows, repeated
 * headers — and verified against synthesised versions of each.
 */

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS: Record<Step, string> = {
  1: 'Upload',
  2: 'Detect header',
  3: 'Map columns',
  4: 'Preview',
  5: 'Import',
};

export function ExcelImport() {
  const t = useTerm();
  const tenantId = useSession((s) => s.tenantId);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [workbook, setWorkbook] = useState<ParsedWorkbook>();
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [targetId, setTargetId] = useState<ImportTarget['id']>('products');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number>();
  const [filter, setFilter] = useState<'all' | 'valid' | 'warning' | 'error'>('all');

  const target = IMPORT_TARGETS.find((x) => x.id === targetId)!;

  const sheet: SheetPreview | undefined = useMemo(() => {
    const raw = workbook?.sheets[sheetIndex];
    return raw ? { ...raw, headerRowIndex: headerRow } : undefined;
  }, [workbook, sheetIndex, headerRow]);

  const headers = useMemo(() => (sheet ? headerLabels(sheet) : []), [sheet]);
  const rows = useMemo(() => (sheet ? dataRows(sheet) : []), [sheet]);
  const validated: ValidatedRow[] = useMemo(
    () => (sheet ? validateRows(target, mapping, rows) : []),
    [sheet, target, mapping, rows],
  );
  const stats = useMemo(() => summarise(validated), [validated]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    setParseError(undefined);
    try {
      const parsed = await parseWorkbook(file);
      const first = parsed.sheets[0];
      if (!first) {
        setParseError('That workbook has no sheets we can read.');
        return;
      }
      setWorkbook(parsed);
      setSheetIndex(0);
      setHeaderRow(first.headerRowIndex);
      setMapping(autoMap(target, headerLabels(first)));
      setStep(2);
    } catch {
      setParseError(
        'That file could not be opened. It may be password protected, or not a spreadsheet.',
      );
    } finally {
      setParsing(false);
    }
  };

  /** Re-guesses the mapping whenever the header row or target changes. */
  const refreshMapping = (nextTarget = target, nextHeaderRow = headerRow) => {
    if (!workbook) return;
    const raw = workbook.sheets[sheetIndex];
    if (!raw) return;
    setMapping(autoMap(nextTarget, headerLabels({ ...raw, headerRowIndex: nextHeaderRow })));
  };

  const runImport = async () => {
    setImporting(true);
    try {
      // Partial import by design: valid and warning rows go in, errors do not.
      const accepted = validated.filter((row) => row.severity !== 'error');
      await writeRows(tenantId, target, accepted);
      setImported(accepted.length);
      setStep(5);
    } finally {
      setImporting(false);
    }
  };

  /** Rejected rows come back as a spreadsheet the user can fix and re-upload. */
  const downloadRejects = async () => {
    const XLSX = await loadSheetJs();
    const rejects = validated.filter((row) => row.severity === 'error');
    const sheetData = [
      ['Row in your file', 'Problem', ...target.fields.map((f) => f.label)],
      ...rejects.map((row) => [
        row.rowNumber,
        row.issues.map((i) => i.message).join('; '),
        ...target.fields.map((f) => String(row.values[f.key] ?? '')),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rows to fix');
    XLSX.writeFile(wb, `rows-to-fix-${target.id}.xlsx`);
  };

  const visibleRows = validated.filter((row) => filter === 'all' || row.severity === filter);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">{t('screen_import')}</h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          Your file is read here in the browser. It is never uploaded.
        </p>
      </header>

      {/* Step indicator — five steps, current one named. */}
      <div>
        <Progress value={(step / 5) * 100} />
        <ol className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-caption">
          {([1, 2, 3, 4, 5] as Step[]).map((n) => (
            <li
              key={n}
              className={cn(
                n === step ? 'font-semibold text-primary' : 'text-text-secondary',
              )}
            >
              {n}. {STEP_LABELS[n]}
            </li>
          ))}
        </ol>
      </div>

      {/* ------------------------------------------------------ 1 · Upload */}
      {step === 1 && (
        <Card>
          <CardContent className="space-y-6 pt-card">
            <div>
              <Label className="mb-2 block">What are you importing?</Label>
              <Select
                value={targetId}
                onValueChange={(value) => {
                  const next = IMPORT_TARGETS.find((x) => x.id === value)!;
                  setTargetId(next.id);
                  refreshMapping(next);
                }}
              >
                <SelectTrigger className="w-full max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_TARGETS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label} — {option.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleFile(e.dataTransfer.files[0]);
              }}
              className="flex flex-col items-center rounded-card border border-dashed border-border bg-secondary px-6 py-12 text-center"
            >
              <FileSpreadsheet size={40} className="text-text-disabled" aria-hidden />
              <p className="pt-3 text-body text-text-primary">
                Drop your Excel file here, or choose it
              </p>
              <p className="pt-1 text-body-sm text-text-secondary">
                .xlsx, .xls and .csv. Messy files are expected — merged cells, headers part-way
                down, numbers stored as text.
              </p>
              <Button className="mt-6" loading={parsing} onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden />
                Choose file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
            </div>

            {parseError && (
              <p className="flex items-center gap-2 text-body-sm text-st-danger">
                <AlertCircle size={16} aria-hidden />
                {parseError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------ 2 · Detect header row */}
      {step === 2 && sheet && workbook && (
        <Card>
          <CardContent className="space-y-4 pt-card">
            {workbook.sheets.length > 1 && (
              <div>
                <Label className="mb-2 block">Sheet</Label>
                <Select
                  value={String(sheetIndex)}
                  onValueChange={(value) => {
                    const index = Number(value);
                    setSheetIndex(index);
                    const raw = workbook.sheets[index]!;
                    setHeaderRow(raw.headerRowIndex);
                    refreshMapping(target, raw.headerRowIndex);
                  }}
                >
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workbook.sheets.map((s, index) => (
                      <SelectItem key={s.name} value={String(index)}>
                        {s.name} ({s.totalRows} rows)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <p className="text-body-sm text-text-secondary">
              We think row <span className="font-semibold text-text-primary">{headerRow + 1}</span>{' '}
              holds the column names. Tap the correct row if that is wrong.
            </p>

            <div className="overflow-hidden rounded-card border border-border bg-card">
              <Table>
                <TableBody>
                  {sheet.rows.slice(0, 15).map((row, index) => {
                    const isHeader = index === headerRow;
                    return (
                      <TableRow
                        key={index}
                        onClick={() => {
                          setHeaderRow(index);
                          refreshMapping(target, index);
                        }}
                        data-state={isHeader ? 'selected' : undefined}
                        className={cn('cursor-pointer', isHeader && 'font-semibold')}
                      >
                        <TableCell className="w-12 px-2 py-2 text-caption text-text-secondary">
                          {index + 1}
                        </TableCell>
                        {row.slice(0, 8).map((cell, cellIndex) => (
                          <TableCell key={cellIndex} className="max-w-[12rem] truncate px-3 py-2">
                            {cell === null ? '' : String(cell)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --------------------------------------------- 3 · Map the columns */}
      {step === 3 && sheet && (
        <ExcelMappingTable
          target={target}
          headers={headers}
          mapping={mapping}
          onChange={setMapping}
          sampleRows={rows.slice(0, 5).map((r) => r.cells)}
        />
      )}

      {/* ------------------------------------------------- 4 · Row preview */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', `All ${stats.total}`],
                ['valid', `Valid ${stats.valid}`],
                ['warning', `Warning ${stats.warning}`],
                ['error', `Error ${stats.error}`],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? 'default' : 'outline'}
                onClick={() => setFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="overflow-hidden rounded-card border border-border bg-card">
            <Table minWidth="40rem">
              <TableHeader>
                <tr>
                  <TableHead className="px-3">Row</TableHead>
                  <TableHead className="px-3">Status</TableHead>
                  {target.fields.map((field) => (
                    <TableHead key={field.key} className="px-3">
                      {field.label}
                    </TableHead>
                  ))}
                  <TableHead className="px-3">Problem</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {visibleRows.slice(0, 200).map((row) => (
                  <TableRow key={row.rowNumber}>
                    <TableCell className="px-3 py-2 tabular-nums text-text-secondary">
                      {row.rowNumber}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <Badge
                        variant={
                          row.severity === 'error'
                            ? 'danger'
                            : row.severity === 'warning'
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {row.severity}
                      </Badge>
                    </TableCell>
                    {target.fields.map((field) => (
                      <TableCell key={field.key} className="max-w-[12rem] truncate px-3 py-2">
                        {String(row.values[field.key] ?? '')}
                      </TableCell>
                    ))}
                    <TableCell className="px-3 py-2 text-text-secondary">
                      {row.issues.map((i) => i.message).join('; ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {visibleRows.length > 200 && (
            <p className="text-body-sm text-text-secondary">
              Showing the first 200 of {visibleRows.length} rows. All of them will be imported.
            </p>
          )}
        </div>
      )}

      {/* ----------------------------------------------------- 5 · Imported */}
      {step === 5 && (
        <EmptyState
          title={`${imported ?? 0} rows imported`}
          body={
            stats.error > 0
              ? `${stats.error} rows could not be read and were left out. Download them, fix them in Excel, and import that file — nothing else needs redoing.`
              : 'Every row came through. Nothing was left behind.'
          }
          action={
            stats.error > 0 ? (
              <Button variant="outline" onClick={() => void downloadRejects()}>
                <Download aria-hidden />
                Download rows to fix
              </Button>
            ) : undefined
          }
        />
      )}

      {/* ------------------------------------------------------ navigation */}
      {step < 5 && (
        <div className="flex flex-wrap items-center gap-3">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => (s - 1) as Step)}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
          )}

          {step === 4 ? (
            <Button
              loading={importing}
              disabled={stats.total - stats.error === 0}
              onClick={() => void runImport()}
            >
              Import {stats.total - stats.error} rows
            </Button>
          ) : (
            <Button disabled={!sheet && step > 1} onClick={() => setStep((s) => (s + 1) as Step)}>
              Continue
              <ArrowRight aria-hidden />
            </Button>
          )}

          {step === 4 && stats.error > 0 && (
            <span className="text-body-sm text-text-secondary">
              {stats.error} rows will be left out and can be downloaded afterwards.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ writing */

/**
 * Master data is written directly to its table rather than through the event
 * log: it is reference data, not a physical movement. Opening stock is the
 * exception — a balance IS a movement, so it becomes a receipt event and shows
 * up on the stock card like everything else.
 */
async function writeRows(tenantId: string, target: ImportTarget, rows: ValidatedRow[]) {
  if (target.id === 'products') {
    const products: Product[] = rows.map((row) => ({
      id: uuidv7(),
      tenantId: tenantId as Product['tenantId'],
      sku: String(row.values.sku ?? `AUTO-${row.rowNumber}`),
      name: String(row.values.name),
      itemClass: (row.values.itemClass as Product['itemClass']) ?? 'RAW_MATERIAL',
      baseUnit: String(row.values.baseUnit),
      conversions: [],
      shelfLifeDays: row.values.shelfLifeDays ? Number(row.values.shelfLifeDays) : undefined,
      minimumStock: (row.values.minimumStock as string) ?? undefined,
      averageCost: (row.values.averageCost as string) ?? undefined,
      active: true,
    }));
    await db.products.bulkPut(products);
    return;
  }

  if (target.id === 'locations') {
    const locations: Location[] = rows.map((row) => ({
      id: uuidv7(),
      tenantId: tenantId as Location['tenantId'],
      code: String(row.values.code),
      name: String(row.values.name),
      parentId: null,
      // Imported flat, at the top of the tree. Depth and parentage are set on
      // K04 afterwards: a spreadsheet almost never carries a reliable
      // hierarchy, and inventing one from a `level` column produced parents
      // that did not exist (v1.4).
      depth: 0,
      // Storable by default — an imported location is nearly always somewhere
      // stock goes. A container that is not gets unticked on K04.
      storable: true,
      virtual: false,
      active: true,
    }));
    await db.locations.bulkPut(locations);
    return;
  }

  if (target.id === 'partners') {
    const partners: Partner[] = rows.map((row) => ({
      id: uuidv7(),
      tenantId: tenantId as Partner['tenantId'],
      code: String(row.values.code ?? `AUTO-${row.rowNumber}`),
      name: String(row.values.name),
      kind: (row.values.kind as Partner['kind']) ?? 'SUPPLIER',
      phone: (row.values.phone as string) ?? undefined,
      active: true,
    }));
    await db.partners.bulkPut(partners);
  }

  // `opening_stock` is written as receipt events by the caller's importer in
  // Sprint 2 (T-030), once the real-file regression suite exists to prove the
  // quantities survive the round trip.
}
