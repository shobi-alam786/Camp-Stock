/**
 * Camp Stock Inventory Management System
 * Catalogue maintenance (opening stock, bulk add) and staff handover records.
 * Pure functions only, so they are easy to test and match the Android logic.
 */

import {
  DecimalSafe,
  InventoryTransaction,
  MaterialCatalogueItem,
  calculateCurrentStock,
  instantOf,
  isSnapshotBaseline,
} from '../types/inventory.ts';
import { autoRef, dateToIso, newId } from './form.ts';


const exactQty = (q: string) => DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(q));

/**
 * The record a quantity edit must update: the newest single-material STOCK_BASELINE of this material at this location.
 * (Older multi-material baseline batches cannot be changed one material at a time, so they are never returned.)
 */
export function findBaselineRecord(code: string, locationId: string, transactions: InventoryTransaction[]): InventoryTransaction | undefined {
  let best: InventoryTransaction | undefined;
  for (const t of transactions) {
    if (t.txType !== 'STOCK_BASELINE' || t.destinationLocationId !== locationId) continue;
    if (t.lines.length !== 1 || t.lines[0].materialCode !== code) continue;
    if (!best || instantOf(t.txDateTime) > instantOf(best.txDateTime)) best = t;
  }
  return best;
}

/**
 * Sets the current stock of one material to EXACTLY the quantity typed (a stock-count snapshot, SNAP- reference).
 * One material at one location = one local baseline and one active Kobo submission:
 *  - first time: a new single-material record;
 *  - later edits: the same local record (same clientTxUuid) with a new quantity, marked PENDING;
 *    Kobo sync replaces the remote row and removes the old submission after verification.
 * Returns null when the stock already equals the quantity.
 */
export function buildSnapshotBaseline(args: {
  material: MaterialCatalogueItem; locationId: string; desiredQty: string; transactions: InventoryTransaction[]; staff: string; now?: Date;
}): { tx: InventoryTransaction; replaces: boolean } | null {
  const now = args.now ?? new Date();
  const iso = now.toISOString();
  const current = calculateCurrentStock(args.material.code, args.locationId, args.transactions);
  if (DecimalSafe.compare(args.desiredQty, current.currentStock) === 0) return null;
  const qty = exactQty(args.desiredQty);
  const notes = `Current stock count: ${current.currentStock} -> ${qty} ${args.material.unit}`;
  const existing = findBaselineRecord(args.material.code, args.locationId, args.transactions);
  if (existing) {
    const reopen = existing.syncStatus === 'SYNCED' || existing.syncStatus === 'CONFLICT' || existing.syncStatus === 'SYNCING';
    return {
      replaces: true,
      tx: {
        ...existing,
        txDateTime: iso,
        staffId: args.staff.trim() || existing.staffId,
        referenceNumber: isSnapshotBaseline(existing) ? existing.referenceNumber : autoRef('SNAP', iso.slice(0, 10)),
        notes,
        lines: [{ ...existing.lines[0], materialName: args.material.name, unit: args.material.unit, quantity: qty }],
        syncStatus: reopen ? 'PENDING' : existing.syncStatus,
        syncErrorMessage: undefined,
        modifiedAt: iso,
      },
    };
  }
  const uuid = newId();
  return {
    replaces: false,
    tx: {
      clientTxUuid: uuid, txType: 'STOCK_BASELINE', txDateTime: iso,
      sourceLocationId: args.locationId, destinationLocationId: args.locationId,
      staffId: args.staff.trim(), referenceNumber: autoRef('SNAP', iso.slice(0, 10)),
      notes,
      lines: [{ lineId: `${uuid}-line-1`, materialCode: args.material.code, materialName: args.material.name, quantity: qty, unit: args.material.unit }],
      syncStatus: 'PENDING', createdAt: iso, modifiedAt: iso,
    },
  };
}

/** Queue Stock Balance snapshots for each material affected by a warehouse movement. */
export function buildMovementStockBaselines(args: {
  movement: InventoryTransaction;
  catalogue: MaterialCatalogueItem[];
  transactions: InventoryTransaction[];
  locationId: string;
  now?: Date;
}): Array<{ tx: InventoryTransaction; replaces: boolean }> {
  const { movement, catalogue, transactions, locationId } = args;
  const changesWarehouseStock =
    (movement.txType === 'RECEIPT' && movement.destinationLocationId === locationId) ||
    (movement.txType === 'RETURN' && movement.destinationLocationId === locationId) ||
    (movement.txType === 'DISPATCH' && movement.sourceLocationId === locationId) ||
    ((movement.txType === 'ADJUSTMENT_POS' || movement.txType === 'ADJUSTMENT_NEG') &&
      (movement.sourceLocationId === locationId || movement.destinationLocationId === locationId));
  if (!changesWarehouseStock) return [];

  const afterMovement = [movement, ...transactions];
  const materialCodes = [...new Set(movement.lines.map((line) => line.materialCode))];
  const snapshots: Array<{ tx: InventoryTransaction; replaces: boolean }> = [];
  for (const code of materialCodes) {
    const material = catalogue.find((item) => item.code === code);
    if (!material) continue;
    const desiredQty = calculateCurrentStock(code, locationId, afterMovement).currentStock;
    const snapshot = buildSnapshotBaseline({
      material,
      locationId,
      desiredQty,
      transactions,
      staff: movement.staffId,
      now: args.now,
    });
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}

/** Kept for older callers: the new record for a first-time stock count (never edits an existing one). */
export function buildStockBaseline(args: {
  material: MaterialCatalogueItem; locationId: string; desiredQty: string; transactions: InventoryTransaction[]; staff: string; now?: Date;
}): InventoryTransaction | null {
  const r = buildSnapshotBaseline({ ...args, transactions: args.transactions.filter((t) => t.txType !== 'STOCK_BASELINE' || t.lines.length !== 1 || t.lines[0].materialCode !== args.material.code || t.destinationLocationId !== args.locationId) });
  return r ? r.tx : null;
}

/** One current-stock record PER material for a list of new materials (quantity 0 rows are skipped). One material = one Kobo submission. */
export function buildBaselineRecords(args: {
  items: Array<{ material: MaterialCatalogueItem; qty: string }>; locationId: string; staff: string; now?: Date;
}): InventoryTransaction[] {
  const iso = (args.now ?? new Date()).toISOString();
  return args.items.filter((i) => !DecimalSafe.isZero(i.qty)).map((i) => {
    const uuid = newId();
    return {
      clientTxUuid: uuid, txType: 'STOCK_BASELINE' as const, txDateTime: iso,
      sourceLocationId: args.locationId, destinationLocationId: args.locationId,
      staffId: args.staff.trim(), referenceNumber: autoRef('SNAP', iso.slice(0, 10)),
      notes: 'Current stock entered with new catalogue material',
      lines: [{ lineId: `${uuid}-line-1`, materialCode: i.material.code, materialName: i.material.name, quantity: exactQty(i.qty), unit: i.material.unit }],
      syncStatus: 'PENDING' as const, createdAt: iso, modifiedAt: iso,
    };
  });
}

// ------------------------------------------------------------------ opening stock

/**
 * Opening stock is part of an append-only ledger, so "change the quantity" never edits an old record.
 * It adds one OPENING_STOCK record holding the difference (desired - current opening).
 * The difference can be negative. Returns null when nothing changes.
 */
export function buildOpeningChange(args: {
  material: MaterialCatalogueItem;
  locationId: string;
  desiredQty: string;
  transactions: InventoryTransaction[];
  staff: string;
  now?: Date;
}): InventoryTransaction | null {
  const { material, locationId, desiredQty, transactions, staff } = args;
  const now = args.now ?? new Date();
  const current = calculateCurrentStock(material.code, locationId, transactions).openingStock;
  const delta = DecimalSafe.subtract(desiredQty, current);
  if (DecimalSafe.isZero(delta)) return null;

  const uuid = newId();
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  return {
    clientTxUuid: uuid,
    txType: 'OPENING_STOCK',
    txDateTime: iso,
    sourceLocationId: locationId,
    destinationLocationId: locationId,
    staffId: staff.trim(),
    referenceNumber: autoRef('OPN', day),
    notes: `Opening stock set from Catalogue: ${current} -> ${DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(desiredQty))} ${material.unit}`,
    lines: [
      {
        lineId: `${uuid}-line-1`,
        materialCode: material.code,
        materialName: material.name,
        quantity: delta,
        unit: material.unit,
      },
    ],
    syncStatus: 'PENDING',
    createdAt: iso,
    modifiedAt: iso,
  };
}

/** One OPENING_STOCK record for a whole list of new materials (quantity 0 rows are skipped). Null if all are 0. */
export function buildOpeningBatch(args: {
  items: Array<{ material: MaterialCatalogueItem; qty: string }>;
  locationId: string;
  staff: string;
  now?: Date;
}): InventoryTransaction | null {
  const used = args.items.filter((i) => !DecimalSafe.isZero(i.qty));
  if (used.length === 0) return null;
  const iso = (args.now ?? new Date()).toISOString();
  const uuid = newId();
  return {
    clientTxUuid: uuid,
    txType: 'STOCK_BASELINE',
    txDateTime: iso,
    sourceLocationId: args.locationId,
    destinationLocationId: args.locationId,
    staffId: args.staff.trim(),
    referenceNumber: autoRef('OPN', iso.slice(0, 10)),
    notes: 'Current-stock baseline entered with new catalogue materials',
    lines: used.map((i, n) => ({
      lineId: `${uuid}-line-${n + 1}`,
      materialCode: i.material.code,
      materialName: i.material.name,
      quantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(i.qty)),
      unit: i.material.unit,
    })),
    syncStatus: 'PENDING',
    createdAt: iso,
    modifiedAt: iso,
  };
}

/** Quantity typed in the catalogue: zero or more, at most 4 decimals. */
export const isValidOpeningQty = (t: string) => /^\d{1,9}(\.\d{1,4})?$/.test(t.trim());

// ------------------------------------------------------------------ bulk add

export interface BulkRow {
  line: number;
  name: string;
  unit: string;
  qty: string;
  error?: string;
}

/**
 * One material per line: "Name, Unit, Quantity" (comma, semicolon or tab).
 * Use semicolons or tabs if you write decimals with a comma.
 * Quantity is optional (blank = 0). Names already in the catalogue or repeated in the list are reported.
 */
export function parseBulkMaterials(text: string, existingNames: string[]): BulkRow[] {
  const seen = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const rows: BulkRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    // semicolon or tab lines keep a decimal comma in the quantity ("Sand; CUM; 15,5"); otherwise split on commas
    const parts = raw.split(/[;\t]/.test(raw) ? /[;\t]/ : /,/).map((p) => p.trim());
    const name = (parts[0] || '').replace(/\s+/g, ' ');
    const unit = (parts[1] || '').toUpperCase();
    const qty = (parts[2] || '').replace(/,/g, '.') || '0';
    const row: BulkRow = { line: i + 1, name, unit, qty };
    if (!name) row.error = 'Missing name.';
    else if (!unit) row.error = 'Missing unit.';
    else if (!isValidOpeningQty(qty)) row.error = `"${parts[2]}" is not a valid quantity.`;
    else if (seen.has(name.toLowerCase())) row.error = 'Already in the catalogue or repeated above.';
    if (!row.error) seen.add(name.toLowerCase());
    rows.push(row);
  });
  return rows;
}

export function newCustomMaterial(name: string, unit: string): MaterialCatalogueItem {
  return {
    code: `CUS-${newId().replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    name: name.trim().replace(/\s+/g, ' '),
    unit: unit.trim().toUpperCase(),
    isUnitConfirmed: true,
    isCustom: true,
    isActive: true,
    notes: 'Custom material added on device',
  };
}

// ------------------------------------------------------------------ staff handover

export const isValidPhone = (t: string) => {
  const s = t.trim();
  return /^[+0-9][0-9 ()\-]*$/.test(s) && s.replace(/\D/g, '').length >= 6;
};

export interface HandoverLine {
  material: MaterialCatalogueItem;
  balance: string;
}

/** Every material with a balance other than zero at the location (a deficit is shown too). */
export function handoverSnapshot(
  catalogue: MaterialCatalogueItem[],
  locationId: string,
  transactions: InventoryTransaction[]
): HandoverLine[] {
  const out: HandoverLine[] = [];
  for (const material of catalogue) {
    const balance = calculateCurrentStock(material.code, locationId, transactions).currentStock;
    if (!DecimalSafe.isZero(balance)) out.push({ material, balance });
  }
  return out;
}

export interface HandoverInput {
  locationId: string;
  fromName: string;
  fromPhone: string;
  toName: string;
  toPhone: string;
  date: string; // yyyy-MM-dd
  notes: string;
}

/** Returns an error text, or '' when the form is complete. */
export function validateHandover(i: HandoverInput): string {
  if (!i.fromName.trim()) return 'Enter the name of the staff who is handing over.';
  if (!isValidPhone(i.fromPhone)) return 'Enter a valid phone number for the staff who is handing over.';
  if (!i.toName.trim()) return 'Enter the name of the staff who is taking over.';
  if (!isValidPhone(i.toPhone)) return 'Enter a valid phone number for the staff who is taking over.';
  if (i.fromName.trim().toLowerCase() === i.toName.trim().toLowerCase() && i.fromPhone.replace(/\D/g, '') === i.toPhone.replace(/\D/g, '')) {
    return 'The two staff are the same person.';
  }
  if (!dateToIso(i.date)) return 'Date must be yyyy-MM-dd and not in the future.';
  return '';
}

/**
 * The handover record keeps a snapshot of the balances on that day. It never changes stock:
 * the stock calculation ignores STAFF_HANDOVER.
 */
export function buildHandover(i: HandoverInput, snapshot: HandoverLine[], now: Date = new Date()): InventoryTransaction {
  const uuid = newId();
  const iso = now.toISOString();
  return {
    clientTxUuid: uuid,
    txType: 'STAFF_HANDOVER',
    txDateTime: dateToIso(i.date, now) || iso,
    sourceLocationId: i.locationId,
    destinationLocationId: i.locationId,
    staffId: i.fromName.trim(),
    referenceNumber: autoRef('HO', i.date),
    notes: i.notes.trim() || undefined,
    handoverFromName: i.fromName.trim(),
    handoverFromPhone: i.fromPhone.trim(),
    handoverToName: i.toName.trim(),
    handoverToPhone: i.toPhone.trim(),
    handoverDate: i.date,
    lines: snapshot.map((l, n) => ({
      lineId: `${uuid}-line-${n + 1}`,
      materialCode: l.material.code,
      materialName: l.material.name,
      quantity: l.balance,
      unit: l.material.unit,
    })),
    syncStatus: 'PENDING',
    createdAt: iso,
    modifiedAt: iso,
  };
}
