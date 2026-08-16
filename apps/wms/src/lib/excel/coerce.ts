import { isValidQty, qty, toLocalDate, type Qty } from '@fv/domain';
import type { CellValue } from './parseWorkbook';

/**
 * Coercion — where messy files are actually survived.
 *
 * Every function returns `null` rather than guessing wrongly. A row that
 * cannot be read is reported as an error the user can fix; a row that is read
 * WRONG becomes a silent inventory error nobody finds for months. Refusing is
 * always the cheaper failure.
 */

export function toText(cell: CellValue): string | null {
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date) return toLocalDate(cell);
  const text = String(cell).trim();
  return text === '' ? null : text;
}

/**
 * Numbers stored as text, in either convention.
 *
 * Indonesian files write `1.500,5`; exports from English-locale tools write
 * `1,500.5`. The separators are decided by which one appears LAST, not by
 * assuming a locale — the same file often contains both.
 *
 * Also handled: thousands separators as spaces, a trailing unit ("25 kg"),
 * parentheses for negatives, and a leading apostrophe from Excel's
 * force-to-text.
 */
export function toQuantity(cell: CellValue): Qty | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? qty(cell) : null;
  if (cell instanceof Date) return null;

  let text = String(cell).trim().replace(/^'/, '');
  if (text === '') return null;

  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);

  // Drop any trailing unit: "25 kg", "1.000 pcs".
  text = text.replace(/[a-zA-Z%°]+\s*$/, '').trim();
  text = text.replace(/\s/g, '');

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever comes last is the decimal separator.
    if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = text.length - lastComma - 1;
    // `1,500` is a thousands separator; `1,5` is a decimal comma.
    text = decimals === 3 ? text.replace(/,/g, '') : text.replace(',', '.');
  } else if (lastDot >= 0) {
    const decimals = text.length - lastDot - 1;
    const dots = (text.match(/\./g) ?? []).length;
    if (dots > 1 || decimals === 3) text = text.replace(/\./g, '');
  }

  if (!/^-?\d*\.?\d*$/.test(text) || text === '' || text === '.') return null;
  const normalised = negative ? `-${text}` : text;
  return isValidQty(normalised) ? qty(normalised) : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8,
  agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

/**
 * Dates in whatever shape the file has them.
 *
 * Handles: real Date cells, Excel serial numbers, `DD/MM/YYYY`, `YYYY-MM-DD`,
 * `D MMM YYYY` with Indonesian or English month names, and two-digit years.
 *
 * **`DD/MM` is assumed over `MM/DD`** when a date is ambiguous, because these
 * files are written in Indonesia. Where the day exceeds 12 the order is
 * unambiguous and detected properly.
 */
export function toDate(cell: CellValue): string | null {
  if (cell === null || cell === undefined) return null;

  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? null : iso(cell.getFullYear(), cell.getMonth() + 1, cell.getDate());
  }

  if (typeof cell === 'number') {
    // Excel serial: days since 1899-12-30 (its leap-year bug included).
    if (cell < 1 || cell > 100_000) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + cell * 86_400_000);
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(cell).trim();
  if (text === '') return null;

  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) return iso(+isoMatch[1]!, +isoMatch[2]!, +isoMatch[3]!);

  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    let [, d, m, y] = dmy.map(Number) as [number, number, number, number];
    if (m > 12 && d <= 12) [d, m] = [m, d]; // clearly the other way round
    if (y! < 100) y = y! + (y! < 70 ? 2000 : 1900);
    return iso(y!, m!, d!);
  }

  const named = text.match(/^(\d{1,2})[\s-]*([A-Za-z]{3,})[\s-]*(\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2]!.slice(0, 3).toLowerCase()];
    if (month) {
      let year = Number(named[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      return iso(year, month, Number(named[1]));
    }
  }

  return null;
}

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
