import { loadSheetJs } from './loadSheetJs';

/**
 * Excel parsing for K06 (UI Spec §19, PRD F1).
 *
 * Written against MESSY files, because tidy files were never the problem. A
 * real warehouse workbook has merged cells, the header on row 7, quantities
 * stored as text with comma decimals, three date formats in one column, blank
 * rows in the middle, and a second header repeated halfway down.
 *
 * Everything here runs in the browser. Warehouse files reach tens of megabytes
 * and uploading them to shared hosting to be parsed is the slowest, most
 * failure-prone path available (Tech Stack §2.3).
 */

export type CellValue = string | number | boolean | Date | null;

export interface SheetPreview {
  name: string;
  /** Raw grid, blank-padded — index 0 is the first row of the file. */
  rows: CellValue[][];
  /** Best guess at the header row, 0-based. The user can move it. */
  headerRowIndex: number;
  totalRows: number;
}

export interface ParsedWorkbook {
  sheets: SheetPreview[];
  fileName: string;
}

/** How far down we look for a header. Beyond this it is not a header, it is data. */
const HEADER_SEARCH_DEPTH = 25;
const PREVIEW_ROWS = 500;

const isBlank = (value: CellValue): boolean =>
  value === null || value === undefined || String(value).trim() === '';

/**
 * Carries merged-cell values forward.
 *
 * SheetJS reports a merged range as one value plus blanks. A merged supplier
 * name spanning five rows would otherwise leave four rows with no supplier —
 * and those rows get thrown out as invalid, which is exactly the failure that
 * loses a demo.
 */
function fillMerges(rows: CellValue[][], merges: { s: { r: number; c: number }; e: { r: number; c: number } }[]) {
  for (const merge of merges) {
    const value = rows[merge.s.r]?.[merge.s.c] ?? null;
    if (isBlank(value)) continue;
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        if (!rows[r]) rows[r] = [];
        if (isBlank(rows[r]![c] ?? null)) rows[r]![c] = value;
      }
    }
  }
}

/**
 * Scores a row on how much it looks like a header.
 *
 * A header row is mostly short text, has few blanks, has no repeats, and is
 * followed by rows that are denser than it. Data rows fail at least one.
 */
function headerScore(rows: CellValue[][], index: number): number {
  const row = rows[index] ?? [];
  const filled = row.filter((cell) => !isBlank(cell));
  if (filled.length < 2) return -1;

  const texts = filled.filter((cell) => typeof cell === 'string');
  const textRatio = texts.length / filled.length;

  const labels = texts.map((cell) => String(cell).trim().toLowerCase());
  const uniqueRatio = labels.length === 0 ? 0 : new Set(labels).size / labels.length;

  // Headers are labels, not sentences.
  const shortRatio =
    labels.length === 0 ? 0 : labels.filter((label) => label.length <= 30).length / labels.length;

  // The rows beneath a header carry at least as many columns as the header.
  const below = rows.slice(index + 1, index + 6);
  const belowFilled =
    below.length === 0
      ? 0
      : below.reduce((acc, r) => acc + r.filter((cell) => !isBlank(cell)).length, 0) / below.length;
  const supportRatio = filled.length === 0 ? 0 : Math.min(1, belowFilled / filled.length);

  // Earlier rows win ties: a repeated header halfway down must not outrank the real one.
  const positionPenalty = index * 0.01;

  return textRatio * 2 + uniqueRatio * 1.5 + shortRatio + supportRatio * 2 - positionPenalty;
}

export function detectHeaderRow(rows: CellValue[][]): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < Math.min(HEADER_SEARCH_DEPTH, rows.length); i += 1) {
    const score = headerScore(rows, i);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const XLSX = await loadSheetJs();
  const buffer = await file.arrayBuffer();

  // `cellDates` keeps real dates as Date objects instead of Excel serials;
  // `raw: false` is deliberately NOT set, so numbers stay numbers and we
  // normalise text-typed numbers ourselves in `coerce.ts`.
  const workbook = XLSX.read(buffer, { cellDates: true, dense: false });

  const sheets: SheetPreview[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]!;
    const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
      header: 1,
      blankrows: true,
      defval: null,
    }) as CellValue[][];

    fillMerges(rows, (sheet['!merges'] ?? []) as never);

    return {
      name,
      rows: rows.slice(0, PREVIEW_ROWS),
      headerRowIndex: detectHeaderRow(rows),
      totalRows: rows.length,
    };
  });

  return { sheets, fileName: file.name };
}

/** Header labels for a chosen header row, blanks replaced by a column letter. */
export function headerLabels(sheet: SheetPreview): string[] {
  const row = sheet.rows[sheet.headerRowIndex] ?? [];
  const width = Math.max(row.length, ...sheet.rows.slice(0, 50).map((r) => r.length));
  return Array.from({ length: width }, (_, i) => {
    const label = row[i];
    return isBlank(label ?? null) ? `Column ${columnLetter(i)}` : String(label).trim();
  });
}

/**
 * Data rows beneath the header.
 *
 * Blank rows are dropped, and a repeated header row — common where a file was
 * assembled by pasting several months together — is skipped rather than
 * imported as a product called "SKU".
 */
export function dataRows(sheet: SheetPreview): { rowNumber: number; cells: CellValue[] }[] {
  const labels = headerLabels(sheet).map((l) => l.toLowerCase());
  const out: { rowNumber: number; cells: CellValue[] }[] = [];

  for (let i = sheet.headerRowIndex + 1; i < sheet.rows.length; i += 1) {
    const cells = sheet.rows[i] ?? [];
    if (cells.every((cell) => isBlank(cell))) continue;

    const asLabels = cells.map((cell) => String(cell ?? '').trim().toLowerCase());
    const looksLikeHeader =
      asLabels.filter((value, index) => value !== '' && value === labels[index]).length >= 2;
    if (looksLikeHeader) continue;

    // rowNumber is 1-based, as the operator sees it in Excel.
    out.push({ rowNumber: i + 1, cells });
  }
  return out;
}

export function columnLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}
