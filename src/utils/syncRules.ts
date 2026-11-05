/**
 * Camp Stock Inventory Management System
 * Shared synchronization rules (pure functions). The Android app implements the SAME rules in
 * android-camp-stock/.../sync/SyncRules.kt - keep the two files in step.
 *
 * One local record = one active Kobo submission:
 *   - a local record without a Kobo _id has never been confirmed on Kobo  -> CREATE (POST)
 *   - a local record with a Kobo _id                                      -> UPDATE (verified replacement POST, then delete old row)
 * The Kobo submission ID can change after a replacement; the client transaction UUID remains stable.
 */

import { DecimalSafe, InventoryTransaction, instantOf } from '../types/inventory.ts';

export type SyncAction = 'CREATE' | 'UPDATE';

export const syncActionFor = (tx: Pick<InventoryTransaction, 'koboSubmissionId'>): SyncAction =>
  tx.koboSubmissionId ? 'UPDATE' : 'CREATE';

const norm = (v?: string) => (v ?? '').trim();
const scaled = (v?: string) => { try { return DecimalSafe.toScaledInt(v || '0').toString(); } catch { return `?${v}`; } };

/** Same date/time, reference, staff and the same material quantities (numeric comparison, so "585" = "585.0"). */
export function sameContent(a: InventoryTransaction, b: InventoryTransaction): boolean {
  if (instantOf(a.txDateTime) !== instantOf(b.txDateTime)) return false;
  if (norm(a.referenceNumber) !== norm(b.referenceNumber) || norm(a.staffId) !== norm(b.staffId)) return false;
  if (a.lines.length !== b.lines.length) return false;
  const key = (t: InventoryTransaction) =>
    t.lines.map((l) => `${norm(l.materialCode)}|${scaled(l.quantity)}|${scaled(l.damagedQuantity)}`).sort().join(';');
  return key(a) === key(b);
}

/** The Kobo version of a record replaces the editable content of the local one. Identity and local-only fields stay. */
export function applyRemote(local: InventoryTransaction, remote: InventoryTransaction): InventoryTransaction {
  return {
    ...local,
    txDateTime: remote.txDateTime || local.txDateTime,
    staffId: remote.staffId || local.staffId,
    referenceNumber: remote.referenceNumber || local.referenceNumber,
    notes: remote.notes,
    lines: remote.lines.map((l, i) => ({
      ...l,
      lineId: local.lines[i]?.lineId ?? l.lineId,
      materialName: l.materialName || local.lines[i]?.materialName || '',
      unit: l.unit || local.lines[i]?.unit || '',
    })),
    syncStatus: 'SYNCED',
    koboSubmissionId: remote.koboSubmissionId ?? local.koboSubmissionId,
    koboInstanceId: remote.koboInstanceId || local.koboInstanceId,
    syncErrorMessage: undefined,
    modifiedAt: new Date().toISOString(),
  };
}

export interface MergeResult {
  records: InventoryTransaction[];
  added: number;      // on Kobo, new to this device
  updated: number;    // existing local record replaced by a newer Kobo version
  linked: number;     // local record now knows its Kobo _id / _uuid
  keptLocal: number;  // local edit is newer than Kobo: it stays and will update Kobo
}

/**
 * Brings what is on Kobo into the local ledger WITHOUT ever creating a second record for the same client_tx_uuid.
 *  - unknown record                       -> added
 *  - local SYNCED record, Kobo differs    -> Kobo wins (this is how edits made on another device arrive)
 *  - local pending CREATE, found on Kobo  -> an earlier send actually worked: link it, no second POST
 *  - local pending UPDATE, Kobo differs   -> the newer date/time wins (a stock count edit sets a new date/time);
 *                                            if Kobo is newer the local edit is dropped, otherwise it is sent later
 */
export function mergeRemote(local: InventoryTransaction[], remote: InventoryTransaction[]): MergeResult {
  const byUuid = new Map(local.map((t) => [t.clientTxUuid, t]));
  const replaced = new Map<string, InventoryTransaction>();
  const additions: InventoryTransaction[] = [];
  let updated = 0, linked = 0, keptLocal = 0;
  const seen = new Set<string>();

  for (const r of remote) {
    if (seen.has(r.clientTxUuid)) continue; // Kobo should hold one submission per record; ignore stray repeats
    seen.add(r.clientTxUuid);
    const l = byUuid.get(r.clientTxUuid);
    if (!l) { additions.push(r); continue; }
    const same = sameContent(l, r);
    const idsMissing = !l.koboSubmissionId || l.koboInstanceId !== r.koboInstanceId && !l.koboInstanceId;
    const pending = l.syncStatus !== 'SYNCED';
    if (!pending) {
      if (!same) { replaced.set(l.clientTxUuid, applyRemote(l, r)); updated++; }
      else if (idsMissing || l.koboSubmissionId !== r.koboSubmissionId) {
        replaced.set(l.clientTxUuid, { ...l, koboSubmissionId: r.koboSubmissionId, koboInstanceId: r.koboInstanceId || l.koboInstanceId }); linked++;
      }
      continue;
    }
    if (!l.koboSubmissionId) {
      // pending CREATE that already exists on Kobo
      replaced.set(l.clientTxUuid, same ? { ...l, syncStatus: 'SYNCED', koboSubmissionId: r.koboSubmissionId, koboInstanceId: r.koboInstanceId || l.koboInstanceId, syncErrorMessage: undefined }
        : { ...l, koboSubmissionId: r.koboSubmissionId, koboInstanceId: r.koboInstanceId || l.koboInstanceId });
      linked++;
      continue;
    }
    // pending UPDATE
    if (same) { replaced.set(l.clientTxUuid, { ...l, syncStatus: 'SYNCED', syncErrorMessage: undefined }); linked++; }
    else if (instantOf(r.txDateTime) > instantOf(l.txDateTime)) { replaced.set(l.clientTxUuid, applyRemote(l, r)); updated++; }
    else keptLocal++;
  }
  const records = [...additions, ...local.map((t) => replaced.get(t.clientTxUuid) ?? t)];
  return { records, added: additions.length, updated, linked, keptLocal };
}
