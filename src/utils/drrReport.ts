/**
 * DRR dispatch reporting: materials dispatched per DRR-CODE, by Sub-Block and MRF number.
 * Mirrors the Android implementation (model/DrrReport.kt) so both apps show the same numbers.
 */
import { DecimalSafe, InventoryTransaction } from '../types/inventory.ts';

export const NO_SUB_BLOCK = '(no sub-block)';
export const NO_MRF = '(no MRF)';

export interface DispatchRow {
  txUuid: string;
  dateTime: string;
  drrCode: string;
  block: string;
  subBlock: string;
  mrfNumber: string;
  reference: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: string;     // negative for a RETURN, so totals are net of returns
  syncStatus: string;
  isReturn: boolean;
}

export interface MaterialTotal {
  materialCode: string;
  materialName: string;
  unit: string;
  total: string;
}

export interface DrrSummary {
  drrCode: string;
  block: string;
  dispatchCount: number;
  materialCount: number;
  lastDate: string;
}

const neg = (q: string) => DecimalSafe.subtract('0', q);

export function drrRows(transactions: InventoryTransaction[]): DispatchRow[] {
  const rows: DispatchRow[] = [];
  for (const tx of transactions) {
    if ((tx.txType !== 'DISPATCH' && tx.txType !== 'RETURN') || !(tx.drrCode || '').trim()) continue;
    for (const line of tx.lines) {
      rows.push({
        txUuid: tx.clientTxUuid,
        dateTime: tx.txDateTime,
        drrCode: tx.drrCode!.trim(),
        block: (tx.block || '').trim(),
        subBlock: (tx.subBlock || '').trim() || NO_SUB_BLOCK,
        mrfNumber: (tx.mrfNumber || '').trim() || NO_MRF,
        reference: tx.referenceNumber,
        materialCode: line.materialCode,
        materialName: line.materialName || line.materialCode,
        unit: line.unit,
        quantity: tx.txType === 'RETURN' ? neg(line.quantity) : DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(line.quantity)),
        syncStatus: tx.syncStatus,
        isReturn: tx.txType === 'RETURN',
      });
    }
  }
  return rows;
}

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uniq = <T,>(a: T[]) => Array.from(new Set(a));

export function drrSummaries(rows: DispatchRow[]): DrrSummary[] {
  const groups = new Map<string, DispatchRow[]>();
  for (const r of rows) {
    const k = r.drrCode.toUpperCase();
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  return Array.from(groups.values())
    .map((list) => ({
      drrCode: list[0].drrCode,
      block: list.map((r) => r.block).find((b) => b) || '',
      dispatchCount: uniq(list.filter((r) => !r.isReturn).map((r) => r.txUuid)).length,
      materialCount: uniq(list.map((r) => r.materialCode)).length,
      lastDate: list.map((r) => r.dateTime).sort().slice(-1)[0],
    }))
    .sort((a, b) => a.drrCode.localeCompare(b.drrCode));
}

export const forDrr = (rows: DispatchRow[], drr: string) => rows.filter((r) => sameText(r.drrCode, drr));

export const subBlocksOf = (rows: DispatchRow[]) => uniq(rows.map((r) => r.subBlock)).sort();

export const mrfsOf = (rows: DispatchRow[], subBlock: string | null) =>
  uniq(rows.filter((r) => subBlock === null || r.subBlock === subBlock).map((r) => r.mrfNumber)).sort();

export function filterRows(rows: DispatchRow[], subBlock: string | null, mrf: string | null, query: string): DispatchRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (subBlock === null || r.subBlock === subBlock) &&
      (mrf === null || r.mrfNumber === mrf) &&
      (q === '' || r.materialName.toLowerCase().includes(q) || r.materialCode.toLowerCase().includes(q))
  );
}

export function totalsByMaterial(rows: DispatchRow[]): MaterialTotal[] {
  const map = new Map<string, MaterialTotal>();
  for (const r of rows) {
    const k = `${r.materialCode}|${r.unit}`;
    const cur = map.get(k);
    map.set(k, {
      materialCode: r.materialCode,
      materialName: cur?.materialName || r.materialName,
      unit: r.unit,
      total: DecimalSafe.add(cur?.total || '0', r.quantity),
    });
  }
  return Array.from(map.values()).sort((a, b) => a.materialName.toLowerCase().localeCompare(b.materialName.toLowerCase()));
}

export interface SubBlockGroup {
  subBlock: string;
  mrfs: Array<{ mrf: string; rows: DispatchRow[] }>;
}

export function groupBySubBlockAndMrf(rows: DispatchRow[]): SubBlockGroup[] {
  return subBlocksOf(rows).map((sb) => {
    const inSb = rows.filter((r) => r.subBlock === sb);
    return { subBlock: sb, mrfs: mrfsOf(inSb, null).map((m) => ({ mrf: m, rows: inSb.filter((r) => r.mrfNumber === m) })) };
  });
}

export function drrShareText(drr: string, rows: DispatchRow[]): string {
  const out: string[] = [`DRR ${drr} - materials dispatched`];
  for (const g of groupBySubBlockAndMrf(rows)) {
    out.push('', `Sub-Block: ${g.subBlock}`);
    for (const m of g.mrfs) {
      out.push(`  MRF ${m.mrf}`);
      for (const t of totalsByMaterial(m.rows)) out.push(`    - ${t.materialName}: ${t.total} ${t.unit}`);
    }
  }
  out.push('', 'Total by material:');
  for (const t of totalsByMaterial(rows)) out.push(`- ${t.materialName}: ${t.total} ${t.unit}`);
  return out.join('\n');
}
