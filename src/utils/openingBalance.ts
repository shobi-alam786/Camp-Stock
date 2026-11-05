/**
 * One-time import of the "Stock Balance - Camp 13" list dated 18-10-2026 into Central Camp Warehouse.
 * Only the DIFFERENCE from opening stock already recorded is written, so running it twice is harmless.
 * Keys starting with NEW: are materials that were not in the 45-item catalogue.
 */
import { DecimalSafe, calculateCurrentStock } from '../types/inventory.ts';
import type { InventoryTransaction, MaterialCatalogueItem } from '../types/inventory.ts';
import { newId } from './form.ts';

export const OPENING_BALANCE_FLAG = 'openingBalance_2026_10_18';
const LOCATION = 'LOC-CENTRAL';
const WHEN = '2026-10-18T06:00:00.000Z';

// [code or NEW:name, unit, quantity ('' = not given; unit is still confirmed)]
const ROWS: Array<[string, string, string]> = [
  ['MAT-0005', 'BAG', '860.16'],
  ['MAT-0004', 'PCS', '151280'],
  ['MAT-0003', 'CUM', '198.918'],
  ['MAT-0006', 'CUM', '50.948'],
  ['MAT-0001', 'PCS', '165'],
  ['MAT-0045', 'PCS', '200'],
  ['MAT-0002', 'PCS', '3818'],
  ['MAT-0026', 'BUNDLE', '3745'],
  ['MAT-0027', 'BUNDLE', '3759'],
  ['MAT-0010', 'M', '1523.356'],
  ['MAT-0030', 'PCS', '3332'],
  ['MAT-0009', 'PCS', '800'],
  ['MAT-0008', 'PCS', '400'],
  ['MAT-0007', 'PCS', '650'],
  ['MAT-0013', 'KG', '12.82'],
  ['MAT-0014', 'KG', '10.46'],
  ['MAT-0015', 'KG', '2'],
  ['MAT-0029', 'KG', '0.85'],
  ['MAT-0028', 'KG', '173.353'],
  ['MAT-0043', 'KG', '50'],
  ['MAT-0022', 'PCS', '155'],
  ['MAT-0021', 'PCS', '96'],
  ['MAT-0011', 'CUM', '6.408'],
  ['MAT-0012', 'CUM', '382.6'],
  ['MAT-0018', 'PCS', '12'],
  ['MAT-0020', 'PCS', '16'],
  ['MAT-0019', 'PCS', '47'],
  ['MAT-0036', 'FT', '130.014'],
  ['MAT-0037', 'PCS', '146'],
  ['MAT-0031', 'PCS', '6'],
  ['MAT-0032', 'PCS', '40'],
  ['MAT-0033', 'PCS', '40'],
  ['MAT-0035', 'PCS', '40'],
  ['MAT-0017', 'PCS', '129'],
  ['NEW:Nut', 'PCS', '129'],
  ['MAT-0039', 'PCS', ''],
  ['MAT-0040', 'PCS', '5'],
  ['MAT-0041', 'PCS', '10'],
  ['NEW:Steel Brackets', 'PCS', '58'],
  ['MAT-0023', 'PCS', '6'],
  ['MAT-0024', 'PCS', '18']
];

export function applyOpeningBalance(catalogue: MaterialCatalogueItem[], transactions: InventoryTransaction[]): {
  catalogue: MaterialCatalogueItem[];
  changedItems: MaterialCatalogueItem[];
  tx: InventoryTransaction | null;
} | null {
  if (catalogue.length < 45) return null;
  const next = [...catalogue];
  const changedItems: MaterialCatalogueItem[] = [];
  const lines: InventoryTransaction['lines'] = [];
  const uuid = newId();

  for (const [key, unit, qty] of ROWS) {
    const isNew = key.startsWith('NEW:');
    const name = key.replace('NEW:', '');
    let idx = next.findIndex((m) => (isNew ? m.name.toLowerCase() === name.toLowerCase() : m.code === key));
    if (idx < 0) {
      if (!isNew) return null;
      next.push({ code: `CUS-${newId().replace(/-/g, '').slice(0, 6).toUpperCase()}`, name, unit, isUnitConfirmed: true, isCustom: true, notes: 'Added from Camp 13 stock balance 18-10-2026' });
      idx = next.length - 1;
    }
    const m = { ...next[idx], unit, isUnitConfirmed: true };
    next[idx] = m;
    changedItems.push(m);
    if (qty) {
      const current = calculateCurrentStock(m.code, LOCATION, transactions).openingStock;
      const delta = DecimalSafe.subtract(qty, current);
      if (!DecimalSafe.isZero(delta)) {
        lines.push({ lineId: `${uuid}-line-${lines.length + 1}`, materialCode: m.code, materialName: m.name, quantity: delta, unit });
      }
    }
  }

  const tx: InventoryTransaction | null = lines.length === 0 ? null : {
    clientTxUuid: uuid, txType: 'OPENING_STOCK', txDateTime: WHEN,
    sourceLocationId: LOCATION, destinationLocationId: LOCATION, staffId: 'Opening balance',
    referenceNumber: 'OPN-20261018-CAMP13', notes: 'Stock Balance - Camp 13, 18-10-2026',
    lines, syncStatus: 'PENDING', createdAt: WHEN, modifiedAt: WHEN,
  };
  return { catalogue: next, changedItems, tx };
}
