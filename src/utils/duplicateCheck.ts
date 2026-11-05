/**
 * Finds drafts that look like a record that already exists (on this computer or pulled from Kobo).
 * Kobo only rejects the same record id twice; two people typing the same dispatch create two different records,
 * so this is the guard against that. It is a warning, never a block. Mirrors DuplicateCheck.kt.
 */
import { DecimalSafe, InventoryTransaction } from '../types/inventory.ts';

export interface DuplicateHit { draftUuid: string; message: string }

const lineSig = (l: InventoryTransaction['lines'][number]) =>
  [(l.materialName || l.materialCode).trim().toLowerCase(), DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.quantity || '0')), DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.damagedQuantity || '0'))].join('~');

function signature(t: InventoryTransaction): string {
  const lc = (v?: string) => (v || '').trim().toLowerCase();
  const who =
    t.txType === 'DISPATCH' || t.txType === 'RETURN' ? [lc(t.drrCode), lc(t.mrfNumber)]
    : t.txType === 'RECEIPT' ? [lc(t.referenceNumber), lc(t.poNumber), lc(t.supplierName)]
    : [(t.txDateTime || '').slice(0, 10), t.sourceLocationId, t.destinationLocationId];
  return [t.txType, ...who, ...t.lines.map(lineSig).sort()].join('|');
}

export function findDuplicates(all: InventoryTransaction[], drafts: InventoryTransaction[]): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  for (const d of drafts) {
    if (d.lines.length === 0) continue;
    const sig = signature(d);
    const twin = all.find((t) => t.clientTxUuid !== d.clientTxUuid && signature(t) === sig);
    if (!twin) continue;
    const what = d.txType === 'DISPATCH' || d.txType === 'RETURN' ? `${d.txType} ${d.drrCode || ''} / MRF ${d.mrfNumber || ''}`
      : d.txType === 'RECEIPT' ? `RECEIPT ${d.referenceNumber}` : d.txType;
    hits.push({ draftUuid: d.clientTxUuid, message: `${what}: same materials and quantities already recorded on ${(twin.txDateTime || '').slice(0, 10)}` });
  }
  return hits;
}
