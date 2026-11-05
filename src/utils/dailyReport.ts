/**
 * Daily records: per-day starting/closing balances and the "Today's MRF Records" view.
 * Mirrors the Android implementation (model/DailyReport.kt) so both apps show the same numbers.
 */
import { DecimalSafe } from '../types/inventory.ts';
import type { InventoryTransaction, MaterialCatalogueItem } from '../types/inventory.ts';

/** ISO instant -> local calendar day "yyyy-MM-dd". */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return (iso || '').slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** +1 adds stock at the location, -1 removes it, 0 = no effect there. Same rules as calculateCurrentStock. */
export function stockSign(tx: InventoryTransaction, locationId: string): number {
  const atDest = tx.destinationLocationId === locationId;
  const atSrc = tx.sourceLocationId === locationId;
  switch (tx.txType) {
    case 'OPENING_STOCK':
    case 'RECEIPT':
    case 'RETURN':
      return atDest ? 1 : 0;
    case 'ADJUSTMENT_POS':
      return atDest || atSrc ? 1 : 0;
    case 'DISPATCH':
      return atSrc ? -1 : 0;
    case 'ADJUSTMENT_NEG':
      return atDest || atSrc ? -1 : 0;
    default:
      return 0;
  }
}

export interface DailyBalance {
  code: string;
  name: string;
  unit: string;
  start: string;   // stock at the start of the day (everything before that date)
  close: string;   // stock at the end of the day
}

export function dailyBalances(
  catalogue: ReadonlyArray<MaterialCatalogueItem>,
  transactions: InventoryTransaction[],
  locationId: string,
  day: string
): DailyBalance[] {
  const before = new Map<string, bigint>();
  const onDay = new Map<string, bigint>();
  for (const tx of transactions) {
    const sign = stockSign(tx, locationId);
    if (sign === 0) continue;
    const d = localDay(tx.txDateTime);
    if (d > day) continue;
    const target = d < day ? before : onDay;
    for (const line of tx.lines) {
      const q = DecimalSafe.toScaledInt(line.quantity) * BigInt(sign);
      target.set(line.materialCode, (target.get(line.materialCode) ?? 0n) + q);
    }
  }
  return catalogue.map((m) => {
    const s = before.get(m.code) ?? 0n;
    const c = s + (onDay.get(m.code) ?? 0n);
    return { code: m.code, name: m.name, unit: m.unit, start: DecimalSafe.fromScaledInt(s), close: DecimalSafe.fromScaledInt(c) };
  });
}

export interface MrfRecord {
  mrf: string;
  subBlock: string;
  block: string;
  materialCode: string;
  materialName: string;
  unit: string;
  dispatchQty: string;
  /** Total returned (damaged ones included). */
  returnQty: string;
  /** The damaged part of returnQty. */
  damagedQty: string;
}

export const NO_MRF_LABEL = '(no MRF)';
export const NO_SUB_LABEL = '-';

/** Dispatches to blocks and returns from blocks on one day, grouped by MRF + Sub-Block + material. */
export function mrfRecords(
  transactions: InventoryTransaction[],
  locationId: string,
  day: string,
  block: string | null,
  materialCode: string | null,
  query: string
): MrfRecord[] {
  const q = query.trim().toLowerCase();
  const map = new Map<string, { rec: MrfRecord; d: bigint; r: bigint; x: bigint }>();
  for (const tx of transactions) {
    const isDispatch = tx.txType === 'DISPATCH' && tx.sourceLocationId === locationId;
    const isReturn = tx.txType === 'RETURN' && tx.destinationLocationId === locationId;
    if (!isDispatch && !isReturn) continue;
    const blk = (tx.block || '').trim();
    if (!blk) continue;                       // not a block movement
    if (localDay(tx.txDateTime) !== day) continue;
    if (block && blk !== block) continue;
    const mrf = (tx.mrfNumber || '').trim() || NO_MRF_LABEL;
    const sub = (tx.subBlock || '').trim() || NO_SUB_LABEL;
    for (const line of tx.lines) {
      if (materialCode && line.materialCode !== materialCode) continue;
      const name = line.materialName || line.materialCode;
      if (q && !name.toLowerCase().includes(q) && !line.materialCode.toLowerCase().includes(q)) continue;
      const key = [mrf, sub, blk, line.materialCode, line.unit].join('|');
      const cur = map.get(key) ?? { rec: { mrf, subBlock: sub, block: blk, materialCode: line.materialCode, materialName: name, unit: line.unit, dispatchQty: '0', returnQty: '0', damagedQty: '0' }, d: 0n, r: 0n, x: 0n };
      const qty = DecimalSafe.toScaledInt(line.quantity);
      if (isDispatch) cur.d += qty; else { cur.r += qty; cur.x += DecimalSafe.toScaledInt(line.damagedQuantity || '0'); }
      map.set(key, cur);
    }
  }
  return Array.from(map.values())
    .map(({ rec, d, r, x }) => ({ ...rec, dispatchQty: DecimalSafe.fromScaledInt(d), returnQty: DecimalSafe.fromScaledInt(r), damagedQty: DecimalSafe.fromScaledInt(x) }))
    .sort((a, b) => a.mrf.localeCompare(b.mrf) || a.subBlock.localeCompare(b.subBlock) || a.materialName.localeCompare(b.materialName));
}

/** Dispatched MRFs matching a search text (for the Returns page). */
export interface MrfMatch {
  mrf: string;
  block: string;
  subBlock: string;
  drrCode: string;
  lastDate: string;
  lines: Array<{ materialCode: string; materialName: string; unit: string; issued: string; returned: string }>;
}

export function searchMrf(transactions: InventoryTransaction[], text: string): MrfMatch[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const groups = new Map<string, MrfMatch>();
  const qty = new Map<string, { i: bigint; r: bigint }>();
  for (const tx of transactions) {
    if (tx.txType !== 'DISPATCH' && tx.txType !== 'RETURN') continue;
    const mrf = (tx.mrfNumber || '').trim();
    if (!mrf || !(tx.block || '').trim() || !mrf.toLowerCase().includes(q)) continue;
    const key = `${mrf.toUpperCase()}|${(tx.block || '').trim()}|${(tx.subBlock || '').trim().toUpperCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { mrf, block: tx.block!.trim(), subBlock: (tx.subBlock || '').trim(), drrCode: (tx.drrCode || '').trim(), lastDate: tx.txDateTime, lines: [] };
      groups.set(key, g);
    }
    if (tx.txDateTime > g.lastDate) g.lastDate = tx.txDateTime;
    for (const line of tx.lines) {
      const k = `${key}|${line.materialCode}`;
      const cur = qty.get(k) ?? { i: 0n, r: 0n };
      const n = DecimalSafe.toScaledInt(line.quantity);
      if (tx.txType === 'DISPATCH') cur.i += n; else cur.r += n;
      qty.set(k, cur);
      if (!g.lines.some((l) => l.materialCode === line.materialCode)) {
        g.lines.push({ materialCode: line.materialCode, materialName: line.materialName || line.materialCode, unit: line.unit, issued: '0', returned: '0' });
      }
    }
  }
  for (const [key, g] of groups) {
    for (const l of g.lines) {
      const v = qty.get(`${key}|${l.materialCode}`)!;
      l.issued = DecimalSafe.fromScaledInt(v.i);
      l.returned = DecimalSafe.fromScaledInt(v.r);
    }
  }
  // only MRFs that were actually dispatched, newest first
  return Array.from(groups.values()).filter((g) => g.lines.some((l) => l.issued !== '0')).sort((a, b) => b.lastDate.localeCompare(a.lastDate)).slice(0, 8);
}
