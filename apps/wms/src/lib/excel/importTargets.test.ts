import { describe, expect, it } from 'vitest';
import { autoMap, IMPORT_TARGETS, summarise, validateRows } from './importTargets';
import { detectHeaderRow, type CellValue } from './parseWorkbook';

const products = IMPORT_TARGETS.find((t) => t.id === 'products')!;

describe('header detection', () => {
  it('finds a header that is not on the first row', () => {
    const rows: CellValue[][] = [
      ['LAPORAN STOK GUDANG', null, null],
      ['PT Contoh Manufaktur', null, null],
      [null, null, null],
      ['Kode', 'Nama Barang', 'Satuan'],
      ['RM-01', 'Tepung terigu', 'kg'],
      ['RM-02', 'Gula pasir', 'kg'],
    ];
    expect(detectHeaderRow(rows)).toBe(3);
  });

  it('prefers the first header when the file repeats it part-way down', () => {
    const rows: CellValue[][] = [
      ['Kode', 'Nama', 'Qty'],
      ['RM-01', 'Tepung', '10'],
      ['RM-02', 'Gula', '20'],
      ['Kode', 'Nama', 'Qty'],
      ['RM-03', 'Garam', '30'],
    ];
    expect(detectHeaderRow(rows)).toBe(0);
  });
});

describe('auto-mapping', () => {
  it('maps Indonesian headers without help', () => {
    const mapping = autoMap(products, ['Kode Barang', 'Nama Barang', 'Satuan', 'Stok Minimum']);
    expect(mapping.sku).toBe(0);
    expect(mapping.name).toBe(1);
    expect(mapping.baseUnit).toBe(2);
    expect(mapping.minimumStock).toBe(3);
  });

  it('maps English headers too', () => {
    const mapping = autoMap(products, ['Item Code', 'Description', 'UOM']);
    expect(mapping.sku).toBe(0);
    expect(mapping.name).toBe(1);
    expect(mapping.baseUnit).toBe(2);
  });

  it('never maps two fields to the same column', () => {
    const mapping = autoMap(products, ['Nama', 'Kode']);
    const used = Object.values(mapping).filter((v) => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves a field unmapped rather than guessing wildly', () => {
    const mapping = autoMap(products, ['Kode', 'Nama', 'Satuan']);
    expect(mapping.shelfLifeDays).toBeNull();
  });
});

describe('row validation', () => {
  const mapping = autoMap(products, ['Kode', 'Nama', 'Kelas', 'Satuan', 'Harga']);

  const rows = [
    { rowNumber: 2, cells: ['RM-01', 'Tepung terigu', 'Bahan Baku', 'kg', '9.500'] },
    { rowNumber: 3, cells: ['RM-02', 'Gula pasir', 'Sesuatu', 'kg', 'n/a'] },
    { rowNumber: 4, cells: ['RM-03', null, 'Bahan Baku', 'kg', '1000'] },
  ] satisfies { rowNumber: number; cells: CellValue[] }[];

  const validated = validateRows(products, mapping, rows);

  it('accepts a clean row', () => {
    expect(validated[0]?.severity).toBe('valid');
    expect(validated[0]?.values.itemClass).toBe('RAW_MATERIAL');
    expect(validated[0]?.values.averageCost).toBe('9500');
  });

  it('warns but still imports a row it can partly read', () => {
    // Unknown class falls back to Raw Material; an unreadable optional price
    // is a warning, not a rejection — the row is still worth importing.
    expect(validated[1]?.severity).toBe('warning');
    expect(validated[1]?.values.itemClass).toBe('RAW_MATERIAL');
  });

  it('rejects only when a required field is missing', () => {
    expect(validated[2]?.severity).toBe('error');
    expect(validated[2]?.issues[0]?.field).toBe('name');
  });

  it('summarises the way the preview filters do', () => {
    expect(summarise(validated)).toEqual({ valid: 1, warning: 1, error: 1, total: 3 });
  });

  it('imports 2 of 3 rows — partial import is the point', () => {
    const accepted = validated.filter((r) => r.severity !== 'error');
    expect(accepted).toHaveLength(2);
  });
});
