import type { ItemClass } from '@fv/contracts';
import { toDate, toQuantity, toText } from './coerce';
import type { CellValue } from './parseWorkbook';

/**
 * What a spreadsheet can be imported INTO, and how each column is validated.
 *
 * PRD F1 treats Excel import as a core feature, not a utility — it is the way
 * a factory's existing data gets in, and the benchmark is >90% of rows from
 * ten different factories' real files, with no manual editing.
 *
 * Transaction history is importable too, not just balances, so the stock card
 * does not start from zero on day one.
 */

export type FieldKind = 'text' | 'quantity' | 'date' | 'itemClass' | 'enum';

export interface TargetField {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Header names seen in real files, lower-cased. Drives auto-mapping. */
  aliases: string[];
  options?: string[];
  help?: string;
}

export interface ImportTarget {
  id: 'products' | 'locations' | 'partners' | 'opening_stock';
  label: string;
  description: string;
  fields: TargetField[];
}

const ITEM_CLASS_ALIASES: Record<string, ItemClass> = {
  'bahan baku': 'RAW_MATERIAL',
  'raw material': 'RAW_MATERIAL',
  raw: 'RAW_MATERIAL',
  kemasan: 'PACKAGING',
  'bahan kemasan': 'PACKAGING',
  packaging: 'PACKAGING',
  'bahan pembantu': 'AUXILIARY',
  pembantu: 'AUXILIARY',
  auxiliary: 'AUXILIARY',
  wip: 'WIP',
  'setengah jadi': 'WIP',
  'barang jadi': 'FINISHED_GOODS',
  'finished goods': 'FINISHED_GOODS',
  jadi: 'FINISHED_GOODS',
  sparepart: 'SPARE_PART',
  'spare part': 'SPARE_PART',
};

export const IMPORT_TARGETS: ImportTarget[] = [
  {
    id: 'products',
    label: 'Products',
    description: 'Items, units, and shelf life',
    fields: [
      {
        key: 'sku',
        label: 'Code',
        kind: 'text',
        required: false,
        aliases: ['kode', 'kode barang', 'sku', 'code', 'item code', 'kode item', 'part no'],
        help: 'Generated automatically when the column is empty.',
      },
      {
        key: 'name',
        label: 'Name',
        kind: 'text',
        required: true,
        aliases: ['nama', 'nama barang', 'name', 'item', 'item name', 'deskripsi', 'description', 'material'],
      },
      {
        key: 'itemClass',
        label: 'Item class',
        kind: 'itemClass',
        required: false,
        aliases: ['kelas', 'kelas barang', 'jenis', 'kategori', 'category', 'class', 'type'],
        help: 'Defaults to Raw Material when it cannot be read.',
      },
      {
        key: 'baseUnit',
        label: 'Base unit',
        kind: 'text',
        required: true,
        aliases: ['satuan', 'satuan dasar', 'unit', 'uom', 'base unit', 'sat'],
      },
      {
        key: 'minimumStock',
        label: 'Minimum stock',
        kind: 'quantity',
        required: false,
        aliases: ['stok minimum', 'min', 'minimum', 'min stock', 'safety stock', 'rop'],
      },
      {
        key: 'shelfLifeDays',
        label: 'Shelf life (days)',
        kind: 'quantity',
        required: false,
        aliases: ['umur simpan', 'shelf life', 'masa simpan', 'expired days'],
      },
      {
        key: 'averageCost',
        label: 'Unit cost',
        kind: 'quantity',
        required: false,
        aliases: ['harga', 'harga beli', 'cost', 'unit cost', 'price', 'harga satuan'],
      },
    ],
  },
  {
    id: 'locations',
    label: 'Locations',
    description: 'Places stock can sit. Arrange the hierarchy afterwards in Locations.',
    /**
     * No `level` column any more (v1.4).
     *
     * It offered a fixed `WAREHOUSE|ZONE|RACK|VIRTUAL` enum, which a factory
     * with different levels could not answer honestly — and a spreadsheet
     * almost never carries a hierarchy worth trusting anyway. Rows import flat
     * and storable; the tree is built on K04, where the parent actually exists
     * to point at.
     */
    fields: [
      { key: 'code', label: 'Code', kind: 'text', required: true, aliases: ['kode', 'kode rak', 'code', 'rack', 'lokasi', 'location'] },
      { key: 'name', label: 'Name', kind: 'text', required: true, aliases: ['nama', 'name', 'nama lokasi', 'description'] },
      { key: 'parentCode', label: 'Parent code', kind: 'text', required: false, aliases: ['induk', 'parent', 'zona', 'zone', 'gudang', 'warehouse'] },
    ],
  },
  {
    id: 'partners',
    label: 'Partners',
    description: 'Suppliers and customers',
    fields: [
      { key: 'code', label: 'Code', kind: 'text', required: false, aliases: ['kode', 'code', 'kode pemasok', 'supplier code'] },
      { key: 'name', label: 'Name', kind: 'text', required: true, aliases: ['nama', 'name', 'pemasok', 'supplier', 'pelanggan', 'customer', 'vendor'] },
      {
        key: 'kind',
        label: 'Type',
        kind: 'enum',
        required: false,
        options: ['SUPPLIER', 'CUSTOMER', 'BOTH'],
        aliases: ['tipe', 'type', 'jenis', 'kategori'],
      },
      { key: 'phone', label: 'Phone', kind: 'text', required: false, aliases: ['telepon', 'telp', 'hp', 'phone', 'no hp', 'kontak'] },
    ],
  },
  {
    id: 'opening_stock',
    label: 'Opening stock',
    description: 'Balances and batches as they stand today',
    fields: [
      { key: 'sku', label: 'Item code', kind: 'text', required: true, aliases: ['kode', 'kode barang', 'sku', 'code', 'item code'] },
      { key: 'quantity', label: 'Quantity', kind: 'quantity', required: true, aliases: ['qty', 'jumlah', 'quantity', 'stok', 'stock', 'saldo', 'balance'] },
      { key: 'locationCode', label: 'Location', kind: 'text', required: false, aliases: ['lokasi', 'rak', 'location', 'rack', 'gudang'] },
      { key: 'batchNo', label: 'Batch', kind: 'text', required: false, aliases: ['batch', 'lot', 'no batch', 'batch no'] },
      { key: 'expiryDate', label: 'Expiry', kind: 'date', required: false, aliases: ['expired', 'kedaluwarsa', 'exp', 'expiry', 'tanggal expired', 'ed'] },
    ],
  },
];

/* ------------------------------------------------------------------ mapping */

export type ColumnMapping = Record<string, number | null>;

/** Normalises a header for comparison: lower-cased, punctuation stripped. */
const normalise = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Guesses the column for each field: exact alias first, then containment.
 * A wrong guess is cheap here — the mapping table shows it and the user
 * corrects it in one tap. A MISSING guess costs them a manual pass.
 */
export function autoMap(target: ImportTarget, headers: string[]): ColumnMapping {
  const normalised = headers.map(normalise);
  const taken = new Set<number>();
  const mapping: ColumnMapping = {};

  for (const field of target.fields) {
    let index = normalised.findIndex((h, i) => !taken.has(i) && field.aliases.includes(h));

    if (index === -1) {
      index = normalised.findIndex(
        (h, i) =>
          !taken.has(i) &&
          h !== '' &&
          field.aliases.some((alias) => h.includes(alias) || alias.includes(h)),
      );
    }

    mapping[field.key] = index === -1 ? null : index;
    if (index !== -1) taken.add(index);
  }

  return mapping;
}

/* --------------------------------------------------------------- validation */

export type RowSeverity = 'valid' | 'warning' | 'error';

export interface RowIssue {
  field: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface ValidatedRow {
  rowNumber: number;
  values: Record<string, unknown>;
  issues: RowIssue[];
  severity: RowSeverity;
}

export function validateRows(
  target: ImportTarget,
  mapping: ColumnMapping,
  rows: { rowNumber: number; cells: CellValue[] }[],
): ValidatedRow[] {
  return rows.map(({ rowNumber, cells }) => {
    const values: Record<string, unknown> = {};
    const issues: RowIssue[] = [];

    for (const field of target.fields) {
      const columnIndex = mapping[field.key];
      const raw = columnIndex === null || columnIndex === undefined ? null : cells[columnIndex] ?? null;

      if (raw === null || String(raw).trim() === '') {
        if (field.required) {
          issues.push({ field: field.key, message: `${field.label} is empty`, severity: 'error' });
        }
        continue;
      }

      switch (field.kind) {
        case 'quantity': {
          const value = toQuantity(raw);
          if (value === null) {
            issues.push({
              field: field.key,
              message: `${field.label} "${String(raw)}" is not a number`,
              severity: field.required ? 'error' : 'warning',
            });
          } else values[field.key] = value;
          break;
        }
        case 'date': {
          const value = toDate(raw);
          if (value === null) {
            issues.push({
              field: field.key,
              message: `${field.label} "${String(raw)}" is not a date we can read`,
              severity: 'warning',
            });
          } else values[field.key] = value;
          break;
        }
        case 'itemClass': {
          const key = normalise(String(raw));
          const value = ITEM_CLASS_ALIASES[key];
          if (!value) {
            issues.push({
              field: field.key,
              message: `Unknown item class "${String(raw)}" — imported as Raw Material`,
              severity: 'warning',
            });
            values[field.key] = 'RAW_MATERIAL';
          } else values[field.key] = value;
          break;
        }
        case 'enum': {
          const text = String(raw).trim().toUpperCase();
          const match = field.options?.find((option) => option === text || option.startsWith(text));
          if (!match) {
            issues.push({
              field: field.key,
              message: `${field.label} "${String(raw)}" is not recognised`,
              severity: 'warning',
            });
          } else values[field.key] = match;
          break;
        }
        default: {
          const value = toText(raw);
          if (value === null && field.required) {
            issues.push({ field: field.key, message: `${field.label} is empty`, severity: 'error' });
          } else values[field.key] = value;
        }
      }
    }

    const severity: RowSeverity = issues.some((i) => i.severity === 'error')
      ? 'error'
      : issues.length > 0
        ? 'warning'
        : 'valid';

    return { rowNumber, values, issues, severity };
  });
}

export function summarise(rows: ValidatedRow[]) {
  return {
    valid: rows.filter((r) => r.severity === 'valid').length,
    warning: rows.filter((r) => r.severity === 'warning').length,
    error: rows.filter((r) => r.severity === 'error').length,
    total: rows.length,
  };
}
