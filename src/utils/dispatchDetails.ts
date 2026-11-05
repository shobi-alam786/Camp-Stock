/**
 * "Dispatch Details" sheet: Dispatch Date | DRR CODE | MRF | Materials |
 * Dispatch Qty | Returned Qty | Damaged Qty. One row per DRR CODE + MRF + material.
 * Returned Qty = total sent back (damaged included); Damaged Qty = the damaged part of it.
 * Mirrors ReportBuilder.dispatchDetails in the Android app.
 */
import { DecimalSafe, InventoryTransaction } from '../types/inventory.ts';

export const DISPATCH_DETAILS_HEADER = ['Dispatch Date', 'DRR CODE', 'MRF', 'Materials', 'Dispatch Qty', 'Returned Qty', 'Damaged Qty'];

export function dispatchDetailsRows(transactions: InventoryTransaction[]): string[][] {
  type Acc = { date: string; drr: string; mrf: string; name: string; dispatched: string; returned: string; damaged: string };
  const map = new Map<string, Acc>();
  const sorted = transactions
    .filter((t) => t.txType === 'DISPATCH' || t.txType === 'RETURN')
    .sort((a, b) => a.txDateTime.localeCompare(b.txDateTime));
  for (const t of sorted) {
    const isReturn = t.txType === 'RETURN';
    for (const l of t.lines) {
      const key = [(t.drrCode || '').trim().toUpperCase(), (t.mrfNumber || '').trim().toUpperCase(), (l.materialName || l.materialCode).trim().toUpperCase()].join('|');
      let a = map.get(key);
      if (!a) {
        a = { date: t.txDateTime.slice(0, 10), drr: (t.drrCode || '').trim(), mrf: (t.mrfNumber || '').trim(), name: l.materialName || l.materialCode, dispatched: '0', returned: '0', damaged: '0' };
        map.set(key, a);
      }
      if (isReturn) {
        a.returned = DecimalSafe.add(a.returned, l.quantity || '0');
        a.damaged = DecimalSafe.add(a.damaged, l.damagedQuantity || '0');
      } else {
        if (DecimalSafe.toScaledInt(a.dispatched) === 0n && DecimalSafe.toScaledInt(a.returned) !== 0n) a.date = t.txDateTime.slice(0, 10);
        a.dispatched = DecimalSafe.add(a.dispatched, l.quantity || '0');
      }
    }
  }
  return Array.from(map.values())
    .sort((x, y) => x.date.localeCompare(y.date) || x.drr.localeCompare(y.drr) || x.mrf.localeCompare(y.mrf) || x.name.localeCompare(y.name))
    .map((a) => [a.date, a.drr, a.mrf, a.name, a.dispatched, a.returned, a.damaged]);
}

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
