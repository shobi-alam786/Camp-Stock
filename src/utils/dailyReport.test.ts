import type { InventoryTransaction } from '../types/inventory.ts';
import { INITIAL_MATERIAL_CATALOGUE } from '../types/inventory.ts';
import { dailyBalances, mrfRecords, searchMrf } from './dailyReport.ts';

function assert(c: boolean, m: string) { if (!c) throw new Error(`Assertion failed: ${m}`); }

// Local-time stamps (no "Z") so the day does not depend on the machine's time zone.
function tx(id: string, type: InventoryTransaction['txType'], date: string, src: string, dst: string, qty: string, o: Partial<InventoryTransaction> = {}): InventoryTransaction {
  return {
    clientTxUuid: id, txType: type, txDateTime: date, sourceLocationId: src, destinationLocationId: dst,
    staffId: 'S1', referenceNumber: `REF-${id}`, syncStatus: 'PENDING', createdAt: date, modifiedAt: date,
    lines: [{ lineId: `${id}-1`, materialCode: 'MAT-0005', materialName: 'Cement', quantity: qty, unit: 'BAGS' }], ...o,
  };
}
const blockA = { block: 'A', subBlock: 'S1', mrfNumber: 'MRF-1', drrCode: 'D1' };
const ledger = [
  tx('o', 'OPENING_STOCK', '2026-10-18T09:00:00', 'SUPPLIER', 'LOC-CENTRAL', '100'),
  tx('d1', 'DISPATCH', '2026-10-20T10:00:00', 'LOC-CENTRAL', 'LOC-BLOCK-A', '30', blockA),
  tx('d2', 'DISPATCH', '2026-10-21T10:00:00', 'LOC-CENTRAL', 'LOC-BLOCK-A', '10', blockA),
  tx('r1', 'RETURN', '2026-10-21T12:00:00', 'LOC-BLOCK-A', 'LOC-CENTRAL', '4', blockA),
  tx('d3', 'DISPATCH', '2026-10-21T13:00:00', 'LOC-CENTRAL', 'LOC-OTHER', '5'),
];

ledger.find((t) => t.clientTxUuid === 'r1')!.lines[0].damagedQuantity = '1';

export function runDailyReportTests() {
  const b = dailyBalances(INITIAL_MATERIAL_CATALOGUE, ledger, 'LOC-CENTRAL', '2026-10-21').find((x) => x.code === 'MAT-0005')!;
  assert(b.start === '70' && b.close === '59', `balances ${b.start}/${b.close}`);
  const before = dailyBalances(INITIAL_MATERIAL_CATALOGUE, ledger, 'LOC-CENTRAL', '2026-10-17').find((x) => x.code === 'MAT-0005')!;
  assert(before.start === '0' && before.close === '0', 'nothing before the opening stock');

  const rows = mrfRecords(ledger, 'LOC-CENTRAL', '2026-10-21', null, null, '');
  assert(rows.length === 1 && rows[0].dispatchQty === '10' && rows[0].returnQty === '4' && rows[0].damagedQty === '1', 'one MRF row, other-warehouse dispatch excluded');
  assert(mrfRecords(ledger, 'LOC-CENTRAL', '2026-10-21', 'B', null, '').length === 0, 'block filter');
  assert(mrfRecords(ledger, 'LOC-CENTRAL', '2026-10-21', null, 'MAT-0006', '').length === 0, 'material filter');
  assert(mrfRecords(ledger, 'LOC-CENTRAL', '2026-10-21', null, null, 'cem').length === 1, 'search');

  const m = searchMrf(ledger, 'mrf-1');
  assert(m.length === 1 && m[0].lines[0].issued === '40' && m[0].lines[0].returned === '4', 'MRF search totals');
}
runDailyReportTests();
