import { addDays, formatMoney, formatTimestamp, inventoryValue, lastMovementByProduct, materialUsagePerBatch, movementSummary, shrinkageByReason, stockAging, stockCard, todayLocal, type StockCardEntry } from '@fv/domain';
import { Download, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { EmptyState } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateField } from '@/components/factoryvision/DateField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEventLog, useIssues, useProducts, useStock } from '@/db/hooks';
import { exportToExcel, exportToPdf, type ExportColumn } from '@/lib/export/exportTable';
import { useTerm, type TermKey } from '@/lib/terms/useTerm';

/**
 * K11 · Report centre (UI Spec §20, PRD F15).
 *
 * Seven reports, one frame. Each is computed from the same event log and stock
 * projection the operational screens use — there is no reporting database that
 * can disagree with the warehouse, which is the usual reason a report gets
 * argued with instead of acted on.
 *
 * Valuation is **weighted average** throughout (PRD F15). FIFO is an open
 * question (PRD #4) and is not implemented on a guess.
 *
 * Everything exports to Excel and PDF, because withholding data is the fastest
 * way to lose a customer's trust (PRD Principle 7).
 */

type ReportId =
  | 'stock_card'
  | 'movement'
  | 'value'
  | 'usage_per_batch'
  | 'aging'
  | 'shrinkage'
  | 'stock_take_history';

const REPORTS: { id: ReportId; labelKey?: TermKey; label?: string; description: string }[] = [
  // The stock card is a locked glossary term, so its name comes from useTerm.
  { id: 'stock_card', labelKey: 'stock_card', description: 'Every movement of one item' },
  { id: 'movement', label: 'Movement summary', description: 'In and out per item class' },
  { id: 'value', label: 'Inventory value', description: 'Weighted average cost' },
  { id: 'usage_per_batch', label: 'Material usage', description: 'Per production batch' },
  { id: 'aging', label: 'Stock aging', description: 'How long value has been sitting' },
  { id: 'shrinkage', label: 'Shrinkage', description: 'Grouped by reason' },
  { id: 'stock_take_history', label: 'Stock take history', description: 'Sessions and accuracy' },
];

export function ReportCentre() {
  const t = useTerm();
  const events = useEventLog();
  const products = useProducts();
  const stock = useStock();
  const issues = useIssues();

  const today = todayLocal();
  const monthAgo = addDays(today, -30);

  const [report, setReport] = useState<ReportId>('stock_card');
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [productId, setProductId] = useState<string>();

  const activeReport = REPORTS.find((r) => r.id === report)!;
  const nameOfReport = (item: (typeof REPORTS)[number]) =>
    item.labelKey ? t(item.labelKey) : (item.label ?? '');
  const active = { ...activeReport, label: nameOfReport(activeReport) };

  const lastMovement = useMemo(
    () => (events ? lastMovementByProduct(events) : {}),
    [events],
  );

  /** Rows plus the column definition that drives both the table and the export. */
  const table = useMemo(() => {
    if (!events || !products || !stock || !issues) return undefined;
    const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown';
    const unitOf = (id: string) => products.find((p) => p.id === id)?.baseUnit ?? '';

    switch (report) {
      case 'stock_card': {
        if (!productId) return { columns: [], rows: [] as StockCardEntry[] };
        const rows = stockCard(events, productId).filter(
          (entry) => entry.at.slice(0, 10) >= from && entry.at.slice(0, 10) <= to,
        );
        const columns: ExportColumn<StockCardEntry>[] = [
          { header: 'When', value: (r) => formatTimestamp(r.at) },
          { header: 'Movement', value: (r) => r.type },
          { header: 'In', value: (r) => r.quantityIn },
          { header: 'Out', value: (r) => r.quantityOut },
          { header: 'Balance', value: (r) => r.balance },
          { header: 'By', value: (r) => r.actorRole },
        ];
        return { columns, rows };
      }

      case 'movement': {
        const rows = movementSummary(events, products, from, to);
        return {
          columns: [
            { header: 'Item class', value: (r) => r.itemClass },
            { header: 'In', value: (r) => r.quantityIn },
            { header: 'Out', value: (r) => r.quantityOut },
            { header: 'Net', value: (r) => r.net },
          ] as ExportColumn<(typeof rows)[number]>[],
          rows,
        };
      }

      case 'value': {
        const { rows } = inventoryValue(stock, products);
        return {
          columns: [
            { header: 'Item', value: (r) => r.name },
            { header: 'Class', value: (r) => r.itemClass },
            { header: 'Quantity', value: (r) => r.quantity },
            { header: 'Unit cost', value: (r) => r.unitCost },
            { header: 'Value', value: (r) => r.value },
          ] as ExportColumn<(typeof rows)[number]>[],
          rows,
        };
      }

      case 'usage_per_batch': {
        const rows = materialUsagePerBatch(events, issues);
        return {
          columns: [
            { header: 'Production batch', value: (r) => r.batchNo },
            { header: 'Product', value: (r) => nameOf(r.productId) },
            {
              header: 'Materials consumed',
              value: (r) =>
                r.materials
                  .map((m) => `${nameOf(m.productId)} ${m.consumed} ${unitOf(m.productId)}`)
                  .join('; ') || '—',
            },
          ] as ExportColumn<(typeof rows)[number]>[],
          rows,
        };
      }

      case 'aging': {
        const rows = stockAging(stock, products, lastMovement, new Date());
        return {
          columns: [
            { header: 'Item', value: (r) => nameOf(r.productId) },
            { header: 'Age bucket (days)', value: (r) => r.bucket },
            { header: 'Quantity', value: (r) => r.quantity },
            { header: 'Value', value: (r) => r.value },
          ] as ExportColumn<(typeof rows)[number]>[],
          rows,
        };
      }

      case 'shrinkage': {
        const rows = shrinkageByReason(events);
        return {
          columns: [
            { header: 'Reason', value: (r) => r.reason },
            { header: 'Quantity', value: (r) => r.quantity },
            { header: 'Occurrences', value: (r) => r.occurrences },
          ] as ExportColumn<(typeof rows)[number]>[],
          rows,
        };
      }

      case 'stock_take_history': {
        const rows = events
          .filter((e) => e.type === 'stock_take.session_created')
          .map((e) => ({
            sessionId: e.type === 'stock_take.session_created' ? e.payload.sessionId : '',
            startedAt: e.occurredAt,
            counters:
              e.type === 'stock_take.session_created' ? e.payload.countedBy.length : 0,
            scope:
              e.type === 'stock_take.session_created' ? e.payload.scopeLocationIds.length : 0,
          }));
        return {
          columns: [
            { header: 'Started', value: (r) => formatTimestamp(r.startedAt) },
            { header: 'Locations in scope', value: (r) => r.scope },
            { header: 'Counters', value: (r) => r.counters },
          ] as ExportColumn<(typeof rows)[number]>[],
          rows,
        };
      }
    }
  }, [report, events, products, stock, issues, from, to, productId, lastMovement]);

  const download = async () => {
    if (!table) return;
    await exportToExcel(
      `${report}-${today}`,
      table.columns as ExportColumn<unknown>[],
      table.rows as unknown[],
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">{t('screen_report_centre')}</h1>
          <p className="pt-1 text-body-sm text-text-secondary">
            Computed from the same records the floor uses. Values at weighted average cost.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => void download()}>
            <Download aria-hidden />
            Excel
          </Button>
          <Button variant="outline" onClick={() => exportToPdf('report-body', active.label)}>
            <FileText aria-hidden />
            PDF
          </Button>
        </div>
      </header>

      <Tabs value={report} onValueChange={(value) => setReport(value as ReportId)}>
        <TabsList>
          {REPORTS.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {nameOfReport(item)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="grid gap-4 pt-card md:grid-cols-3">
          <DateField label="From" value={from} onChange={setFrom} max={to} />
          <DateField label="To" value={to} onChange={setTo} min={from} max={today} />
          {report === 'stock_card' && (
            <SearchPicker
              label="Item"
              options={products?.map((p) => ({ id: p.id, name: p.name, code: p.sku }))}
              value={productId}
              onChange={setProductId}
              placeholder="Choose an item"
            />
          )}
        </CardContent>
      </Card>

      <div id="report-body">
        <h2 className="pb-2 text-title font-semibold text-text-primary">{active.label}</h2>
        <p className="pb-3 text-body-sm text-text-secondary">{active.description}</p>

        {!table || table.rows.length === 0 ? (
          <EmptyState
            title="Nothing in this period"
            body={
              report === 'stock_card' && !productId
                ? 'Choose an item to see its card.'
                : 'Try a wider date range, or record some movements first.'
            }
          />
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-card shadow-1">
            <Table minWidth="36rem">
              <TableHeader>
                <tr>
                  {table.columns.map((column) => (
                    <TableHead key={column.header}>{column.header}</TableHead>
                  ))}
                </tr>
              </TableHeader>
              <TableBody>
                {(table.rows as unknown[]).map((row, index) => (
                  <TableRow key={index}>
                    {table.columns.map((column) => {
                      const value = (column as ExportColumn<unknown>).value(row);
                      const isMoney = column.header.toLowerCase().includes('value') || column.header.toLowerCase().includes('cost');
                      return (
                        <TableCell
                          key={column.header}
                          className={typeof value === 'number' || isMoney ? 'tabular-nums' : undefined}
                        >
                          {isMoney && value !== '—' ? formatMoney(String(value)) : String(value)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
