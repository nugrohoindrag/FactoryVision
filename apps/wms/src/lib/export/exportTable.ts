import { loadSheetJs } from '@/lib/excel/loadSheetJs';

/**
 * Report export (PRD F15 — every report to Excel and PDF).
 *
 * PRD Principle 7 is the reason this exists at all: "Excel is the way in and
 * the way out. Withholding data is the fastest way to lose trust." A factory
 * that cannot get its own numbers back out will not commit to the system.
 *
 * **Excel** reuses the SheetJS chunk K06 already loads — no second library.
 * **PDF** goes through the browser's own print-to-PDF rather than bundling a
 * PDF engine. A PDF library would cost more gzip than the entire application
 * shell, to reproduce something every device already does well.
 */

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

export async function exportToExcel<T>(
  fileName: string,
  columns: ExportColumn<T>[],
  rows: T[],
): Promise<void> {
  const XLSX = await loadSheetJs();
  const data = [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => column.value(row))),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Report');
  XLSX.writeFile(book, `${fileName}.xlsx`);
}

/**
 * Print-to-PDF of a specific element.
 *
 * The element is cloned into a print-only container so the surrounding app
 * chrome — sidebar, top nav, buttons — does not end up in the customer's PDF.
 */
export function exportToPdf(elementId: string, title: string): void {
  const source = document.getElementById(elementId);
  if (!source) return;

  const container = document.createElement('div');
  container.className = 'print-only';
  container.innerHTML = `<h1>${title}</h1>${source.innerHTML}`;
  document.body.appendChild(container);
  document.body.classList.add('printing');

  const cleanup = () => {
    document.body.classList.remove('printing');
    container.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  window.print();
}
