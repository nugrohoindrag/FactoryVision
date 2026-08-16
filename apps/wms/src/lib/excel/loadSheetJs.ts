/**
 * The only permitted entry point to SheetJS.
 *
 * SheetJS is large — hundreds of kilobytes of parser for every Excel quirk
 * that exists. It is worth every byte on K06, and worth none of them on any
 * other screen. A static `import * as XLSX from 'xlsx'` anywhere would put
 * the whole thing in the entry bundle and blow the 200KB budget (Tech
 * Stack §4) for an operator who only ever opens a goods receipt.
 *
 * So it is loaded on demand, and only when the import wizard is actually
 * opened. The rest of the app never pays for it.
 *
 * Parsing happens entirely in the browser (Tech Stack §2.3): warehouse files
 * run to tens of megabytes, and uploading them to shared hosting to be parsed
 * is the slowest and most failure-prone path available.
 */
export type SheetJs = typeof import('xlsx');

let pending: Promise<SheetJs> | null = null;

/** Loads SheetJS once and caches it for the rest of the session. */
export function loadSheetJs(): Promise<SheetJs> {
  pending ??= import('xlsx');
  return pending;
}
