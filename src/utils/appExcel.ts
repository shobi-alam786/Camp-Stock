/**
 * Excel exports for the Camp Stock app itself (one file each, no extra libraries):
 *   1. Records            -> sheets: All records | Received | Dispatched | Returned
 *   2. Handover & Supplies-> sheets: Staff Handover | Supplies
 *   3. Stock balances     -> sheets: Material list | Starting Balance | Current Balance | Stock Adjustments | Daily Closing Balance
 *      (first three laid out like Stock_Records.xlsx)
 * Quantities are real Excel numbers; dates are real dates. Mirrors model/AppExcel.kt on Android.
 */
import { CAMP_LOCATIONS, DecimalSafe, instantOf, isSnapshotBaseline } from '../types/inventory.ts';
import type { InventoryTransaction, MaterialCatalogueItem, Supplier } from '../types/inventory.ts';
import { localDay, stockSign } from './dailyReport.ts';
import { buildXlsx, XlsxSheet } from './xlsxWriter.ts';
import { Kind, toCell } from './iomExcel.ts';
import { materialInfo } from '../types/materialInfo.ts';

interface Col<T> { header: string; kind: Kind; width?: number; get: (r: T) => string }

/** Builds a sheet. Columns that are empty in every row are left out unless keepAll is set. */
function makeSheet<T>(name: string, cols: Array<Col<T>>, rows: T[], keepAll = false): XlsxSheet {
  const use = keepAll ? cols : cols.filter((c) => rows.some((r) => c.get(r).trim() !== ''));
  const final = use.length > 0 ? use : cols.slice(0, 3);
  return {
    name,
    header: final.map((c) => c.header),
    widths: final.map((c) => c.width ?? 14),
    rows: rows.map((r) => final.map((c) => toCell(c.kind, c.get(r)))),
  };
}

const locName = (id: string) => CAMP_LOCATIONS.find((l) => l.id === id)?.name ?? id ?? '';
const joinNotes = (...v: Array<string | undefined>) => v.map((s) => (s ?? '').trim()).filter(Boolean).join(' | ');
const byDateRef = (a: { date: string; ref: string }, b: { date: string; ref: string }) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref);

// ---------- 1. Records ----------

interface RecRow {
  date: string; type: string; ref: string; from: string; to: string; block: string; subBlock: string; mrf: string; drr: string;
  supplier: string; po: string; vehicle: string; item: string; unit: string; qty: string; damaged: string;
  staff: string; receivedBy: string; issuedBy: string; ackBy: string; notes: string; code: string; sync: string; kobo: string;
}

const TYPE_LABEL: Record<string, string> = { RECEIPT: 'Received', DISPATCH: 'Dispatched', RETURN: 'Returned' };

export function recordRows(transactions: InventoryTransaction[]): RecRow[] {
  const out: RecRow[] = [];
  for (const t of transactions) {
    const type = TYPE_LABEL[t.txType];
    if (!type) continue;
    for (const l of t.lines) {
      out.push({
        date: localDay(t.txDateTime), type, ref: t.referenceNumber || '', from: locName(t.sourceLocationId), to: locName(t.destinationLocationId),
        block: t.block || '', subBlock: t.subBlock || '', mrf: t.mrfNumber || '', drr: t.drrCode || '',
        supplier: t.supplierName || '', po: t.poNumber || '', vehicle: t.vehicleNumber || '',
        item: l.materialName || l.materialCode, unit: l.unit, qty: l.quantity, damaged: t.txType === 'RETURN' ? (l.damagedQuantity || '') : '',
        staff: t.staffId || '', receivedBy: t.receivedBy || '', issuedBy: t.issuedBy || '', ackBy: t.acknowledgementBy || '',
        notes: joinNotes(t.notes, l.notes), code: l.materialCode, sync: t.syncStatus, kobo: t.koboSubmissionId ? String(t.koboSubmissionId) : '',
      });
    }
  }
  return out.sort(byDateRef);
}

const REC_COLS: Array<Col<RecRow>> = [
  { header: 'Date', kind: 'date', width: 12, get: (r) => r.date },
  { header: 'Type', kind: 'text', width: 12, get: (r) => r.type },
  { header: 'Reference', kind: 'id', width: 18, get: (r) => r.ref },
  { header: 'From', kind: 'text', width: 22, get: (r) => r.from },
  { header: 'To', kind: 'text', width: 22, get: (r) => r.to },
  { header: 'Block', kind: 'text', width: 8, get: (r) => r.block },
  { header: 'Sub block', kind: 'text', width: 10, get: (r) => r.subBlock },
  { header: 'MRF', kind: 'id', get: (r) => r.mrf },
  { header: 'DRR', kind: 'text', width: 24, get: (r) => r.drr },
  { header: 'Supplier', kind: 'text', width: 26, get: (r) => r.supplier },
  { header: 'PO number', kind: 'id', get: (r) => r.po },
  { header: 'Vehicle', kind: 'text', get: (r) => r.vehicle },
  { header: 'Item', kind: 'text', width: 42, get: (r) => r.item },
  { header: 'Unit', kind: 'text', width: 10, get: (r) => r.unit },
  { header: 'Quantity', kind: 'qty', width: 12, get: (r) => r.qty },
  { header: 'Damaged qty', kind: 'qty', width: 12, get: (r) => r.damaged },
  { header: 'Staff', kind: 'text', width: 22, get: (r) => r.staff },
  { header: 'Received by', kind: 'text', width: 20, get: (r) => r.receivedBy },
  { header: 'Issued by', kind: 'text', width: 20, get: (r) => r.issuedBy },
  { header: 'Acknowledged by', kind: 'text', width: 20, get: (r) => r.ackBy },
  { header: 'Notes', kind: 'text', width: 30, get: (r) => r.notes },
  { header: 'Material code', kind: 'text', width: 14, get: (r) => r.code },
  { header: 'Sync status', kind: 'text', width: 12, get: (r) => r.sync },
  { header: 'Kobo ID', kind: 'id', get: (r) => r.kobo },
];

export function recordsSheets(transactions: InventoryTransaction[]): XlsxSheet[] {
  const rows = recordRows(transactions);
  return [
    makeSheet('All records', REC_COLS, rows),
    makeSheet('Received', REC_COLS, rows.filter((r) => r.type === 'Received')),
    makeSheet('Dispatched', REC_COLS, rows.filter((r) => r.type === 'Dispatched')),
    makeSheet('Returned', REC_COLS, rows.filter((r) => r.type === 'Returned')),
  ];
}
export const recordsWorkbook = (t: InventoryTransaction[]) => buildXlsx(recordsSheets(t));

// ---------- 2. Staff Handover & Supplies ----------

interface HandRow { date: string; ref: string; location: string; fromName: string; fromPhone: string; toName: string; toPhone: string; item: string; unit: string; qty: string; notes: string }

export function handoverRows(transactions: InventoryTransaction[]): HandRow[] {
  const out: HandRow[] = [];
  for (const t of transactions) {
    if (t.txType !== 'STAFF_HANDOVER') continue;
    const base = {
      date: t.handoverDate || localDay(t.txDateTime), ref: t.referenceNumber || '', location: locName(t.sourceLocationId || t.destinationLocationId),
      fromName: t.handoverFromName || '', fromPhone: t.handoverFromPhone || '', toName: t.handoverToName || '', toPhone: t.handoverToPhone || '', notes: t.notes || '',
    };
    if (t.lines.length === 0) out.push({ ...base, item: '', unit: '', qty: '' });
    for (const l of t.lines) out.push({ ...base, item: l.materialName || l.materialCode, unit: l.unit, qty: l.quantity });
  }
  return out.sort(byDateRef);
}

const HAND_COLS: Array<Col<HandRow>> = [
  { header: 'Date', kind: 'date', width: 12, get: (r) => r.date },
  { header: 'Reference', kind: 'text', width: 18, get: (r) => r.ref },
  { header: 'Location', kind: 'text', width: 22, get: (r) => r.location },
  { header: 'Handed over by', kind: 'text', width: 24, get: (r) => r.fromName },
  { header: 'Phone (from)', kind: 'text', width: 16, get: (r) => r.fromPhone },
  { header: 'Taken over by', kind: 'text', width: 24, get: (r) => r.toName },
  { header: 'Phone (to)', kind: 'text', width: 16, get: (r) => r.toPhone },
  { header: 'Item', kind: 'text', width: 42, get: (r) => r.item },
  { header: 'Unit', kind: 'text', width: 10, get: (r) => r.unit },
  { header: 'Balance handed over', kind: 'qty', width: 18, get: (r) => r.qty },
  { header: 'Notes', kind: 'text', width: 30, get: (r) => r.notes },
];

interface SupRow { supplier: string; phone: string; contact: string; status: string; supNotes: string; date: string; po: string; ref: string; item: string; unit: string; qty: string; receivedAt: string }

/** Supplier list plus every delivery. A supplier with no delivery still gets one row; deliveries from an unlisted supplier keep their name. */
export function supplyRows(suppliers: ReadonlyArray<Supplier>, transactions: InventoryTransaction[]): SupRow[] {
  const out: SupRow[] = [];
  const known = new Set<string>();
  const deliveries = transactions.filter((t) => t.txType === 'RECEIPT');
  const supplierOf = (t: InventoryTransaction) => suppliers.find((s) => (t.supplierId && s.supplierId === t.supplierId) || (!t.supplierId && t.supplierName && s.name.trim().toLowerCase() === t.supplierName.trim().toLowerCase()));
  const delivRows = (t: InventoryTransaction, s: Supplier | undefined) => {
    const base = {
      supplier: s?.name ?? (t.supplierName || '(no supplier)'), phone: s?.phone ?? '', contact: s?.contactPerson ?? '', status: s ? (s.isActive ? 'Active' : 'Inactive') : '', supNotes: s?.notes ?? '',
      date: localDay(t.txDateTime), po: t.poNumber || '', ref: t.referenceNumber || '', receivedAt: locName(t.destinationLocationId),
    };
    return t.lines.length === 0 ? [{ ...base, item: '', unit: '', qty: '' }] : t.lines.map((l) => ({ ...base, item: l.materialName || l.materialCode, unit: l.unit, qty: l.quantity }));
  };
  for (const s of suppliers) {
    const mine = deliveries.filter((t) => supplierOf(t)?.supplierId === s.supplierId);
    if (mine.length) known.add(s.supplierId);
    if (mine.length === 0) {
      out.push({ supplier: s.name, phone: s.phone ?? '', contact: s.contactPerson ?? '', status: s.isActive ? 'Active' : 'Inactive', supNotes: s.notes ?? '', date: '', po: '', ref: '', item: '', unit: '', qty: '', receivedAt: '' });
    } else {
      for (const t of mine) out.push(...delivRows(t, s));
    }
  }
  for (const t of deliveries) if (!supplierOf(t)) out.push(...delivRows(t, undefined));
  return out.sort((a, b) => a.supplier.localeCompare(b.supplier) || a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

const SUP_COLS: Array<Col<SupRow>> = [
  { header: 'Supplier', kind: 'text', width: 28, get: (r) => r.supplier },
  { header: 'Phone', kind: 'text', width: 16, get: (r) => r.phone },
  { header: 'Contact person', kind: 'text', width: 22, get: (r) => r.contact },
  { header: 'Status', kind: 'text', width: 10, get: (r) => r.status },
  { header: 'Supplier notes', kind: 'text', width: 24, get: (r) => r.supNotes },
  { header: 'Delivery date', kind: 'date', width: 13, get: (r) => r.date },
  { header: 'PO number', kind: 'id', get: (r) => r.po },
  { header: 'GRN / Reference', kind: 'id', width: 18, get: (r) => r.ref },
  { header: 'Item', kind: 'text', width: 42, get: (r) => r.item },
  { header: 'Unit', kind: 'text', width: 10, get: (r) => r.unit },
  { header: 'Quantity', kind: 'qty', width: 12, get: (r) => r.qty },
  { header: 'Received at', kind: 'text', width: 22, get: (r) => r.receivedAt },
];

export function handoverSuppliersSheets(transactions: InventoryTransaction[], suppliers: ReadonlyArray<Supplier>): XlsxSheet[] {
  return [
    makeSheet('Staff Handover', HAND_COLS, handoverRows(transactions)),
    makeSheet('Supplies', SUP_COLS, supplyRows(suppliers, transactions)),
  ];
}
export const handoverSuppliersWorkbook = (t: InventoryTransaction[], s: ReadonlyArray<Supplier>) => buildXlsx(handoverSuppliersSheets(t, s));

// ---------- 3. Stock balances ----------

export const MAX_STOCK_DAYS = 366;

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  for (let t = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)); t <= end && out.length < MAX_STOCK_DAYS; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export interface StockLine { code: string; name: string; unit: string; start: bigint; closes: bigint[]; moved: boolean }

/**
 * Balance of every material at one location, as of the END of each day, using the same rule as the Current Stock screen:
 * newest stock baseline (else legacy opening) + all receipts, returns and adjustments, minus dispatches.
 * start = balance at the end of the day before `from`.
 */
export function stockSeries(catalogue: ReadonlyArray<MaterialCatalogueItem>, transactions: InventoryTransaction[], locationId: string, from: string, to: string, includeAll = false): { days: string[]; lines: StockLine[] } {
  const days = daysBetween(from, to);
  type Ev = { day: string; time: string; kind: 'legacy' | 'base' | 'move'; q: bigint; snap?: boolean };
  const events = new Map<string, Ev[]>();
  const push = (code: string, e: Ev) => { const a = events.get(code); if (a) a.push(e); else events.set(code, [e]); };
  for (const t of transactions) {
    const day = localDay(t.txDateTime);
    for (const l of t.lines) {
      const q = DecimalSafe.toScaledInt(l.quantity);
      if (t.txType === 'STOCK_BASELINE') {
        if (t.destinationLocationId === locationId) push(l.materialCode, { day, time: t.txDateTime, kind: 'base', q, snap: isSnapshotBaseline(t) });
      } else if (t.txType === 'OPENING_STOCK') {
        if (t.destinationLocationId === locationId) push(l.materialCode, { day, time: t.txDateTime, kind: 'legacy', q });
      } else {
        const sign = stockSign(t, locationId);
        if (sign === 0) continue;
        const net = t.txType === 'RETURN' ? q - DecimalSafe.toScaledInt(l.damagedQuantity || '0') : q;
        push(l.materialCode, { day, time: t.txDateTime, kind: 'move', q: net * BigInt(sign) });
      }
    }
  }
  const balanceAt = (evs: Ev[], day: string): bigint => {
    let legacy = 0n, move = 0n;
    let base: Ev | null = null;
    for (const e of evs) {
      if (e.day > day) continue;
      if (e.kind === 'legacy') legacy += e.q;
      else if (e.kind === 'move') move += e.q;
      else if (!base || instantOf(e.time) > instantOf(base.time) || (instantOf(e.time) === instantOf(base.time) && e.time > base.time)) base = e;
    }
    if (base && base.snap) {
      // snapshot baseline: the exact quantity entered + only the movements dated after it
      const at = instantOf(base.time);
      let after = 0n;
      for (const e of evs) if (e.kind === 'move' && e.day <= day && instantOf(e.time) > at) after += e.q;
      return base.q + after;
    }
    return (base ? base.q : legacy) + move;
  };
  const dayBefore = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)) - 86400000).toISOString().slice(0, 10);
  const lines: StockLine[] = [];
  for (const m of catalogue) {
    const evs = events.get(m.code) ?? [];
    const start = balanceAt(evs, dayBefore);
    const closes = days.map((d) => balanceAt(evs, d));
    const moved = evs.some((e) => e.day >= from && e.day <= to);
    if (includeAll || start !== 0n || moved || closes.some((c) => c !== 0n)) lines.push({ code: m.code, name: m.name, unit: m.unit, start, closes, moved });
  }
  return { days, lines };
}

/** Item-list details for a material: list number (else the app code), category, sub-category. */
function itemInfo(code: string, name: string) {
  const i = materialInfo(name);
  return { no: i ? String(i.no) : code, category: i?.category ?? '', sub: i?.subCategory ?? '', sql: i?.subCategorySql ?? '', rank: i ? i.no : Number.MAX_SAFE_INTEGER };
}

interface AdjRow { date: string; ref: string; code: string; name: string; unit: string; dir: string; qty: string; staff: string; notes: string }

/** Stock adjustments (added / removed) at one location inside the date range. */
export function adjustmentRows(transactions: InventoryTransaction[], locationId: string, from: string, to: string): AdjRow[] {
  const out: AdjRow[] = [];
  for (const t of transactions) {
    if (t.txType !== 'ADJUSTMENT_POS' && t.txType !== 'ADJUSTMENT_NEG') continue;
    if (t.sourceLocationId !== locationId && t.destinationLocationId !== locationId) continue;
    const date = localDay(t.txDateTime);
    if (date < from || date > to) continue;
    for (const l of t.lines) {
      out.push({
        date, ref: t.referenceNumber ?? '', code: l.materialCode, name: l.materialName, unit: l.unit,
        dir: t.txType === 'ADJUSTMENT_POS' ? 'Added' : 'Removed',
        qty: (t.txType === 'ADJUSTMENT_NEG' ? '-' : '') + DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.quantity)),
        staff: t.staffId ?? '', notes: joinNotes(t.notes, l.notes),
      });
    }
  }
  return out.sort(byDateRef);
}

export function stockSheets(catalogue: ReadonlyArray<MaterialCatalogueItem>, transactions: InventoryTransaction[], locationId: string, from: string, to: string): XlsxSheet[] {
  const { days, lines: used } = stockSeries(catalogue, transactions, locationId, from, to);
  const { lines: every } = stockSeries(catalogue, transactions, locationId, from, to, true);
  const f = DecimalSafe.fromScaledInt;
  // every material, in item-list order (materials without a list number go last, by name)
  const all = [...every].sort((a, b) => itemInfo(a.code, a.name).rank - itemInfo(b.code, b.name).rank || a.name.localeCompare(b.name));
  const closeOf = (l: StockLine) => l.closes[l.closes.length - 1] ?? l.start;
  const info = (l: StockLine) => itemInfo(l.code, l.name);

  const list = makeSheet('Material list', [
    { header: 'code', kind: 'id', width: 8, get: (l: StockLine) => info(l).no },
    { header: 'category', kind: 'text', width: 16, get: (l) => info(l).category },
    { header: 'sub_category', kind: 'text', width: 24, get: (l) => info(l).sub },
    { header: 'sub_category_sql', kind: 'text', width: 22, get: (l) => info(l).sql },
    { header: 'items_smsd', kind: 'text', width: 42, get: (l) => l.name },
    { header: 'unit', kind: 'text', width: 10, get: (l) => l.unit },
  ], all, true);
  const head = (name: string, extra: Array<Col<StockLine>>) => makeSheet(name, [
    { header: 'code', kind: 'id', width: 8, get: (l: StockLine) => info(l).no },
    { header: 'category', kind: 'text', width: 16, get: (l: StockLine) => info(l).category },
    { header: 'sub_category', kind: 'text', width: 24, get: (l: StockLine) => info(l).sub },
    { header: 'items', kind: 'text', width: 42, get: (l: StockLine) => l.name },
    { header: 'unit', kind: 'text', width: 10, get: (l: StockLine) => l.unit },
    ...extra,
  ], all, true);
  const starting = head('Starting Balance', [
    { header: 'Starting Balance', kind: 'qty', width: 16, get: (l) => f(l.start) },
    { header: 'Closing Balance', kind: 'qty', width: 16, get: (l) => f(closeOf(l)) },
  ]);
  const current = head('Current Balance', [
    { header: 'Balance', kind: 'qty', width: 14, get: (l) => f(closeOf(l)) },
  ]);

  const adjusted = adjustmentRows(transactions, locationId, from, to);
  const adjustments = makeSheet('Stock Adjustments', [
    { header: 'Date', kind: 'date', width: 12, get: (r: AdjRow) => r.date },
    { header: 'Reference', kind: 'id', width: 16, get: (r: AdjRow) => r.ref },
    { header: 'code', kind: 'id', width: 8, get: (r: AdjRow) => itemInfo(r.code, r.name).no },
    { header: 'category', kind: 'text', width: 16, get: (r: AdjRow) => itemInfo(r.code, r.name).category },
    { header: 'sub_category', kind: 'text', width: 24, get: (r: AdjRow) => itemInfo(r.code, r.name).sub },
    { header: 'items', kind: 'text', width: 42, get: (r: AdjRow) => r.name },
    { header: 'unit', kind: 'text', width: 10, get: (r: AdjRow) => r.unit },
    { header: 'Adjustment', kind: 'text', width: 12, get: (r: AdjRow) => r.dir },
    { header: 'Quantity', kind: 'qty', width: 12, get: (r: AdjRow) => r.qty },
    { header: 'Staff', kind: 'text', width: 18, get: (r: AdjRow) => r.staff },
    { header: 'Reason / notes', kind: 'text', width: 36, get: (r: AdjRow) => r.notes },
  ], adjusted, true);

  type DayRow = { day: string; l: StockLine; close: bigint };
  const dayRows: DayRow[] = [];
  days.forEach((day, i) => { for (const l of used) dayRows.push({ day, l, close: l.closes[i] }); });
  const daily = makeSheet('Daily Closing Balance', [
    { header: 'Date', kind: 'date', width: 12, get: (r: DayRow) => r.day },
    { header: 'code', kind: 'id', width: 8, get: (r: DayRow) => info(r.l).no },
    { header: 'Item', kind: 'text', width: 42, get: (r: DayRow) => r.l.name },
    { header: 'Unit', kind: 'text', width: 10, get: (r: DayRow) => r.l.unit },
    { header: 'Closing Balance', kind: 'qty', width: 16, get: (r: DayRow) => f(r.close) },
  ], dayRows, true);
  return [list, starting, current, adjustments, daily];
}
export const stockWorkbook = (c: ReadonlyArray<MaterialCatalogueItem>, t: InventoryTransaction[], loc: string, from: string, to: string) => buildXlsx(stockSheets(c, t, loc, from, to));
