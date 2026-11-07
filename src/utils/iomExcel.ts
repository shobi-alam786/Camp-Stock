/**
 * Excel export of IOM Stock Records: one workbook, four sheets
 *   All records | Received | Dispatched | Returned
 * Columns that are empty for a sheet are left out (Received has no MRF, Returned has no waybill, ...).
 * Quantities are real numbers that keep the decimals Kobo supplied (0.170 stays 0.170).
 */
import type { IomRow } from './iomRecords.ts';
import { buildXlsx, XlsxCell, XlsxSheet } from './xlsxWriter.ts';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface IomBalanceRow {
  code: string;
  category: string;
  subCategory: string;
  item: string;
  unit: string;
  campQuantity: string;
  totalQuantity: string;
}

type XmlValue = string | number | XmlValue[] | { [key: string]: XmlValue | undefined } | undefined;

const asArray = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

function parseWorkbookXml(xml: string, label: string): Record<string, XmlValue> {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`Invalid ${label} XML.`);
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, parseAttributeValue: false }).parse(xml);
}

function xmlText(value: XmlValue): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(xmlText).join('');
  if ('#text' in value) return xmlText(value['#text']);
  return Object.values(value).map(xmlText).join('');
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? '';
  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function resolveWorkbookPath(target: string): string {
  const segments: string[] = [];
  for (const segment of (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}

/** Read the Camp 13 balance snapshot from the BALANCE - CAMP worksheet. */
export function parseIomBalanceSheet(bytes: Uint8Array): IomBalanceRow[] {
  const files = unzipSync(bytes);
  const readXml = (path: string) => {
    const data = files[path];
    if (!data) throw new Error(`Workbook is missing ${path}.`);
    return parseWorkbookXml(strFromU8(data), path);
  };
  const workbook = readXml('xl/workbook.xml');
  const relationships = readXml('xl/_rels/workbook.xml.rels');
  const workbookNode = workbook.workbook as Record<string, XmlValue> | undefined;
  const sheetsNode = workbookNode?.sheets as Record<string, XmlValue> | undefined;
  const sheets = asArray(sheetsNode?.sheet as Record<string, XmlValue> | Record<string, XmlValue>[] | undefined);
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sheet = sheets.find((entry) => normalize(String(entry['@_name'] ?? '')) === 'balancecamp');
  if (!sheet) throw new Error('The workbook does not contain a BALANCE - CAMP sheet.');

  const relationshipNode = relationships.Relationships as Record<string, XmlValue> | undefined;
  const relationshipEntries = asArray(relationshipNode?.Relationship as Record<string, XmlValue> | Record<string, XmlValue>[] | undefined);
  const relationshipId = String(sheet['@_r:id'] ?? '');
  const relationship = relationshipEntries.find((entry) => entry['@_Id'] === relationshipId);
  const target = relationship?.['@_Target'];
  if (typeof target !== 'string') throw new Error('Could not locate the BALANCE - CAMP worksheet data.');

  const sharedStrings: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const shared = readXml('xl/sharedStrings.xml');
    const stringTable = shared.sst as Record<string, XmlValue> | undefined;
    for (const entry of asArray(stringTable?.si as XmlValue | XmlValue[] | undefined)) sharedStrings.push(xmlText(entry));
  }

  const worksheet = readXml(resolveWorkbookPath(target));
  const worksheetNode = worksheet.worksheet as Record<string, XmlValue> | undefined;
  const sheetData = worksheetNode?.sheetData as Record<string, XmlValue> | undefined;
  const worksheetRows = asArray(sheetData?.row as Record<string, XmlValue> | Record<string, XmlValue>[] | undefined);
  const cellValues = (row: Record<string, XmlValue>) => {
    const values = new Map<number, string>();
    for (const cell of asArray(row.c as Record<string, XmlValue> | Record<string, XmlValue>[] | undefined)) {
      const index = columnIndex(String(cell['@_r'] ?? ''));
      const value = cell.v;
      const type = cell['@_t'];
      if (index < 0) continue;
      if (type === 's') {
        const sharedIndex = Number(xmlText(value));
        values.set(index, sharedStrings[sharedIndex] ?? '');
      } else if (type === 'inlineStr') values.set(index, xmlText(cell.is));
      else values.set(index, xmlText(value));
    }
    return values;
  };

  const headerRowIndex = worksheetRows.findIndex((row) => cellValues(row).size > 0);
  if (headerRowIndex < 0) throw new Error('The BALANCE - CAMP sheet is empty.');
  const headers = cellValues(worksheetRows[headerRowIndex]);
  const headerIndex = (names: string[]) => Array.from(headers.entries()).find(([, value]) => names.includes(normalize(value)))?.[0];
  const codeIndex = headerIndex(['code']);
  const categoryIndex = headerIndex(['category']);
  const subCategoryIndex = headerIndex(['subcategory']);
  const itemIndex = headerIndex(['items', 'item', 'material']);
  const unitIndex = headerIndex(['unit']);
  const campIndex = headerIndex(['c013', 'camp13']);
  const totalIndex = headerIndex(['total']);
  if (itemIndex === undefined || unitIndex === undefined || campIndex === undefined) {
    throw new Error('BALANCE - CAMP must include items, unit, and C013 columns.');
  }

  return worksheetRows.slice(headerRowIndex + 1).flatMap((row) => {
    const values = cellValues(row);
    const item = values.get(itemIndex) ?? '';
    if (!item) return [];
    return [{
      code: codeIndex === undefined ? '' : values.get(codeIndex) ?? '',
      category: categoryIndex === undefined ? '' : values.get(categoryIndex) ?? '',
      subCategory: subCategoryIndex === undefined ? '' : values.get(subCategoryIndex) ?? '',
      item,
      unit: values.get(unitIndex) ?? '',
      campQuantity: values.get(campIndex) ?? '',
      totalQuantity: totalIndex === undefined ? '' : values.get(totalIndex) ?? '',
    }];
  });
}

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
