import { recordsSheets, handoverSuppliersSheets, stockSheets, stockSeries, daysBetween } from './appExcel.ts';
import type { InventoryTransaction, MaterialCatalogueItem, Supplier } from '../types/inventory.ts';

const assert = (c: unknown, m: string) => { if (!c) throw new Error('FAIL: ' + m); };
const cat: MaterialCatalogueItem[] = [
  { code: 'A', name: 'Cement', unit: 'BAG', isUnitConfirmed: true },
  { code: 'B', name: 'Sand', unit: 'CUM', isUnitConfirmed: true },
  { code: 'C', name: 'Unused', unit: 'PCS', isUnitConfirmed: true },
];
const tx = (o: Partial<InventoryTransaction> & { txType: InventoryTransaction['txType']; txDateTime: string; lines: InventoryTransaction['lines'] }): InventoryTransaction => ({
  clientTxUuid: Math.random().toString(), sourceLocationId: 'LOC-CENTRAL', destinationLocationId: 'LOC-CENTRAL', staffId: 'S', referenceNumber: 'R', syncStatus: 'PENDING', createdAt: '', modifiedAt: '', ...o });
const ln = (code: string, name: string, q: string, unit = 'BAG') => ({ lineId: code + q, materialCode: code, materialName: name, quantity: q, unit });
const sup: Supplier[] = [{ supplierId: 'S1', name: 'Ayan Corporation', phone: '017', isActive: true }, { supplierId: 'S2', name: 'No Delivery Ltd', isActive: false }];
const txs = [
  tx({ txType: 'STOCK_BASELINE', txDateTime: '2026-10-01T06:00:00.000Z', lines: [ln('A', 'Cement', '100')] }),
  tx({ txType: 'RECEIPT', txDateTime: '2026-10-02T06:00:00.000Z', supplierId: 'S1', supplierName: 'Ayan Corporation', poNumber: '0042', lines: [ln('A', 'Cement', '50'), ln('B', 'Sand', '2.50', 'CUM')] }),
  tx({ txType: 'DISPATCH', txDateTime: '2026-10-03T06:00:00.000Z', block: 'A', mrfNumber: '777', lines: [ln('A', 'Cement', '30')] }),
  tx({ txType: 'RETURN', txDateTime: '2026-10-04T06:00:00.000Z', block: 'A', lines: [{ ...ln('A', 'Cement', '10'), damagedQuantity: '4' }] }),
  tx({ txType: 'RECEIPT', txDateTime: '2026-10-04T07:00:00.000Z', supplierName: 'Unlisted Co', lines: [ln('B', 'Sand', '1', 'CUM')] }),
  tx({ txType: 'ADJUSTMENT_NEG', txDateTime: '2026-10-05T08:00:00.000Z', referenceNumber: 'ADJ-1', notes: 'Damaged in rain', lines: [ln('B', 'Sand', '0.5', 'CUM')] }),
  tx({ txType: 'ADJUSTMENT_POS', txDateTime: '2026-10-09T08:00:00.000Z', referenceNumber: 'ADJ-2', lines: [ln('B', 'Sand', '9', 'CUM')] }),
  tx({ txType: 'STAFF_HANDOVER', txDateTime: '2026-10-05T06:00:00.000Z', handoverDate: '2026-10-05', handoverFromName: 'Ali', handoverToName: 'Sami', lines: [ln('A', 'Cement', '126')] }),
];
const r = recordsSheets(txs);
assert(r.map((s) => s.name).join('|') === 'All records|Received|Dispatched|Returned', 'record sheets');
assert(r[0].rows.length === 5 && r[1].rows.length === 3 && r[2].rows.length === 1 && r[3].rows.length === 1, 'record counts');
assert(!r[1].header.includes('MRF') && r[2].header.includes('MRF'), 'empty columns dropped');
const h = handoverSuppliersSheets(txs, sup);
assert(h[0].name === 'Staff Handover' && h[0].rows.length === 1 && h[1].name === 'Supplies', 'handover sheets');
assert(h[1].rows.length === 4, 'supplies: 2 deliveries of S1 + no-delivery supplier + unlisted'); // S1:2 lines, S2:1, unlisted:1
const s = stockSheets(cat, txs, 'LOC-CENTRAL', '2026-10-03', '2026-10-05');
assert(s.map((x) => x.name).join('|') === 'Material list|Starting Balance|Current Balance|Stock Adjustments|Daily Closing Balance', 'stock sheets ' + s.map((x) => x.name));
assert(s[0].header.join() === 'code,category,sub_category,sub_category_sql,items_smsd,unit' && s[0].rows.length === 3, 'material list: every material');
assert(s[1].header.join() === 'code,category,sub_category,items,unit,Starting Balance,Closing Balance' && s[1].rows.length === 3, 'starting balance sheet');
assert(s[2].header.join() === 'code,category,sub_category,items,unit,Balance', 'current balance sheet');
assert(s[3].rows.length === 1, 'adjustments: only the one inside the date range'); // ADJ-1 on 10-05; ADJ-2 is 10-09
const adj = s[3].rows[0];
assert(s[3].header.includes('Adjustment') && adj.some((c) => c && 'v' in c && c.v === 'Removed') && adj.some((c) => c && 'v' in c && c.v === '-0.5'), 'adjustment shows Removed -0.5');
assert(stockSheets(cat, txs, 'LOC-CENTRAL', '2026-10-03', '2026-10-10')[3].rows.length === 2, 'wider range includes both adjustments');
assert(stockSheets(cat, txs, 'LOC-BLOCK-A', '2026-10-03', '2026-10-10')[3].rows.length === 0, 'other location has none');
const ser = stockSeries(cat, txs, 'LOC-CENTRAL', '2026-10-03', '2026-10-05');
const cement = ser.lines.find((l) => l.code === 'A')!;
// start (end of 10-02) = 100 + 50 = 150; 10-03 = 120; 10-04 = 126 (return 10 - 4 damaged); 10-05 = 126
assert(cement.start === 1500000n && cement.closes.map(String).join() === '1200000,1260000,1260000', 'cement balances ' + cement.closes);
assert(!ser.lines.some((l) => l.code === 'C'), 'unused material left out');
assert(s[4].rows.length === ser.days.length * ser.lines.length, 'daily rows = days x materials');
assert(daysBetween('2026-10-03', '2026-10-05').length === 3, 'days');
console.log('appExcel tests passed');
