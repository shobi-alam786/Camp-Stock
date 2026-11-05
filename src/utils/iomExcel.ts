/**
 * Excel export of IOM Stock Records: one workbook, four sheets
 *   All records | Received | Dispatched | Returned
 * Columns that are empty for a sheet are left out (Received has no MRF, Returned has no waybill, ...).
 * Quantities are real numbers that keep the decimals Kobo supplied (0.170 stays 0.170).
 */
import type { IomRow } from './iomRecords.ts';
import { buildXlsx, XlsxCell, XlsxSheet } from './xlsxWriter.ts';

export type Kind = 'text' | 'id' | 'date' | 'qty';
interface Col { header: string; kind: Kind; get: (r: IomRow) => string; width?: number }

const COLS: Col[] = [
  { header: 'Kobo ID', kind: 'id', get: (r) => String(r.koboId) },
  { header: 'Entry by', kind: 'text', get: (r) => r.entryBy, width: 24 },
  { header: 'Entry date', kind: 'date', get: (r) => r.entryDate, width: 12 },
  { header: 'Type', kind: 'text', get: (r) => r.inventoryType, width: 12 },
  { header: 'Sub type', kind: 'text', get: (r) => r.inventorySubType, width: 12 },
  { header: 'MRF', kind: 'id', get: (r) => r.mrfNo },
  { header: 'DRR', kind: 'text', get: (r) => r.drrCode, width: 24 },
  { header: 'Category', kind: 'text', get: (r) => r.category, width: 16 },
  { header: 'Sub category', kind: 'text', get: (r) => r.subCategory, width: 24 },
  { header: 'Item', kind: 'text', get: (r) => r.item, width: 42 },
  { header: 'Unit', kind: 'text', get: (r) => r.unit, width: 10 },
  { header: 'Quantity', kind: 'qty', get: (r) => r.quantity, width: 12 },
  { header: 'Waybill', kind: 'id', get: (r) => r.waybillNo },
  { header: 'Camp', kind: 'text', get: (r) => r.camp },
  { header: 'Warehouse', kind: 'text', get: (r) => r.warehouse },
  { header: 'Supplier', kind: 'text', get: (r) => r.supplier, width: 26 },
  { header: 'PO number', kind: 'id', get: (r) => r.poNumber },
  { header: 'GRN number', kind: 'id', get: (r) => r.grnNumber },
  { header: 'PRF number', kind: 'id', get: (r) => r.prfNumber },
  { header: 'Project', kind: 'text', get: (r) => r.project },
  { header: 'Code', kind: 'id', get: (r) => r.code },
  { header: 'Sub storage', kind: 'text', get: (r) => r.subStorage, width: 14 },
  { header: 'Casting yard', kind: 'text', get: (r) => r.castingYard },
  { header: 'Description', kind: 'text', get: (r) => r.description, width: 30 },
];

/** Excel date serial for YYYY-MM-DD (also accepts a longer ISO timestamp). */
export function excelDateSerial(text: string): number | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

export function toCell(kind: Kind, raw: string): XlsxCell {
  const v = raw.trim();
  if (!v) return null;
  if (kind === 'date') {
    const d = excelDateSerial(v);
    return d === null ? { t: 's', v } : { t: 'd', v: d };
  }
  if (kind === 'id') return /^[1-9]\d{0,14}$|^0$/.test(v) ? { t: 'n', v, scale: 0 } : { t: 's', v };
  if (kind === 'qty') {
    const n = v.replace(/,/g, '');
    const m = n.match(/^[+-]?\d+(?:\.(\d+))?$/);
    if (m && (m[1]?.length ?? 0) <= 6 && n.replace(/^[+-]/, '').replace(/\..*/, '').length <= 15) return { t: 'n', v: n.replace(/^\+/, ''), scale: m[1]?.length ?? 0 };
    return { t: 's', v };
  }
  return { t: 's', v: raw };
}

function sheetFor(name: string, rows: IomRow[]): XlsxSheet {
  const cols = COLS.filter((c) => rows.some((r) => c.get(r).trim() !== ''));
  const use = cols.length > 0 ? cols : COLS.filter((c) => ['Entry date', 'Type', 'Item', 'Unit', 'Quantity'].includes(c.header));
  return {
    name,
    header: use.map((c) => c.header),
    widths: use.map((c) => c.width ?? 14),
    rows: rows.map((r) => use.map((c) => toCell(c.kind, c.get(r)))),
  };
}

const typeIs = (r: IomRow, t: string) => r.inventoryType.trim().toLowerCase() === t;

export function iomSheets(rows: IomRow[]): XlsxSheet[] {
  return [
    sheetFor('All records', rows),
    sheetFor('Received', rows.filter((r) => typeIs(r, 'received'))),
    sheetFor('Dispatched', rows.filter((r) => typeIs(r, 'dispatched'))),
    sheetFor('Returned', rows.filter((r) => typeIs(r, 'returned'))),
  ];
}

export function iomWorkbook(rows: IomRow[]): Uint8Array<ArrayBuffer> {
  return buildXlsx(iomSheets(rows));
}
