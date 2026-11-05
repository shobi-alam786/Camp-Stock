import { InventoryTransaction } from '../types/inventory.ts';
import { buildOpenRosaXml, parseKoboSubmissionJson } from './koboXml.ts';
import {
  drrRows, drrSummaries, forDrr, subBlocksOf, mrfsOf, filterRows, totalsByMaterial, groupBySubBlockAndMrf, drrShareText, NO_SUB_BLOCK,
} from './drrReport.ts';

function assert(c: boolean, m: string) { if (!c) throw new Error(`Assertion failed: ${m}`); }

// Same ledger as the Android test (DispatchFeatureTest) so both apps are checked against the same numbers.
function tx(id: string, type: InventoryTransaction['txType'], src: string, dst: string, date: string,
  o: Partial<InventoryTransaction>, lines: Array<[string, string, string]>): InventoryTransaction {
  return {
    clientTxUuid: id, txType: type, txDateTime: date, sourceLocationId: src, destinationLocationId: dst,
    staffId: 'S1', referenceNumber: `REF-${id}`, syncStatus: 'PENDING', createdAt: date, modifiedAt: date,
    lines: lines.map(([code, qty, unit], i) => ({ lineId: `${id}-${i}`, materialCode: code, materialName: `Name ${code}`, quantity: qty, unit })),
    ...o,
  };
}

const ledger: InventoryTransaction[] = [
  tx('r1', 'RECEIPT', 'SUPPLIER', 'LOC-CENTRAL', '2026-10-12T08:00:00Z', { supplierName: 'M/S Azizi Enterprise', poNumber: '4500234802' }, [['MAT-0006', '11.442', 'CUM'], ['MAT-0004', '1000', 'PCS']]),
  tx('d1', 'DISPATCH', 'LOC-CENTRAL', 'LOC-BLOCK-B', '2026-10-13T08:00:00Z', { drrCode: 'DRR-1', block: 'B', subBlock: 'B1', mrfNumber: 'MRF-10' }, [['MAT-0006', '4', 'CUM'], ['MAT-0004', '300', 'PCS']]),
  tx('d2', 'DISPATCH', 'LOC-CENTRAL', 'LOC-BLOCK-B', '2026-10-14T08:00:00Z', { drrCode: 'DRR-1', block: 'B', subBlock: 'B1', mrfNumber: 'MRF-11' }, [['MAT-0006', '2.5', 'CUM']]),
  tx('d3', 'DISPATCH', 'LOC-CENTRAL', 'LOC-BLOCK-B', '2026-10-15T08:00:00Z', { drrCode: 'drr-1', block: 'B', subBlock: 'B2', mrfNumber: 'MRF-10' }, [['MAT-0004', '100', 'PCS']]),
  tx('d4', 'DISPATCH', 'LOC-CENTRAL', 'LOC-BLOCK-C', '2026-10-15T09:00:00Z', { drrCode: 'DRR-2', block: 'C', mrfNumber: 'MRF-20' }, [['MAT-0006', '1', 'CUM']]),
  tx('d5', 'DISPATCH', 'LOC-CENTRAL', 'LOC-OTHER', '2026-10-16T09:00:00Z', {}, [['MAT-0006', '0.5', 'CUM']]),
];

const rows = drrRows(ledger);
assert(rows.length === 5, 'only DRR dispatches are rows (d1 x2 lines + d2 + d3 + d4)');
assert(rows.find((r) => r.txUuid === 'd4')!.subBlock === NO_SUB_BLOCK, 'empty sub-block is labelled');
const r1 = forDrr(rows, 'DRR-1');
assert(r1.length === 4, 'DRR match is case-insensitive');
const sums = drrSummaries(rows);
assert(sums.length === 2 && sums.find((s) => s.drrCode.toLowerCase() === 'drr-1')!.dispatchCount === 3, 'summary counts dispatches');
assert(subBlocksOf(r1).join() === 'B1,B2', 'sub-blocks');
assert(mrfsOf(r1, 'B1').join() === 'MRF-10,MRF-11' && mrfsOf(r1, 'B2').join() === 'MRF-10', 'MRFs per sub-block');
assert(filterRows(r1, 'B1', null, '').length === 3, 'filter by sub-block');
assert(filterRows(r1, 'B1', 'MRF-10', '').length === 2, 'filter by sub-block + MRF');
assert(filterRows(r1, null, 'MRF-10', 'mat-0004').length === 2, 'filter by MRF + search');
assert(filterRows(r1, 'B2', 'MRF-11', '').length === 0, 'no match');
const totals = Object.fromEntries(totalsByMaterial(r1).map((t) => [t.materialCode, t.total]));
assert(totals['MAT-0006'] === '6.5' && totals['MAT-0004'] === '400', 'totals match the Android test');
const grouped = groupBySubBlockAndMrf(r1);
assert(grouped.map((g) => g.subBlock).join() === 'B1,B2' && grouped[0].mrfs.map((m) => m.mrf).join() === 'MRF-10,MRF-11', 'grouping');
assert(drrShareText('DRR-1', r1).includes('Sub-Block: B1'), 'share text');

// returns reduce DRR totals
const withReturn = [...ledger, tx('x1', 'RETURN', 'LOC-BLOCK-B', 'LOC-CENTRAL', '2026-10-17T08:00:00Z', { drrCode: 'DRR-1', block: 'B', subBlock: 'B1', mrfNumber: 'MRF-10' }, [['MAT-0004', '50', 'PCS']])];
const net = Object.fromEntries(totalsByMaterial(forDrr(drrRows(withReturn), 'DRR-1')).map((t) => [t.materialCode, t.total]));
assert(net['MAT-0004'] === '350', 'return of 50 reduces 400 to 350');
assert(drrSummaries(drrRows(withReturn)).find((s) => s.drrCode === 'DRR-1')!.dispatchCount === 3, 'a return is not a dispatch');

// XML carries the new fields and every line; JSON parses back
const xml = buildOpenRosaXml(ledger[1]);
assert(xml.includes('<drr_code>DRR-1</drr_code>') && xml.includes('<sub_block>B1</sub_block>') && xml.includes('<mrf_number>MRF-10</mrf_number>'), 'xml header fields');
assert((xml.match(/<material_lines>/g) || []).length === 2 && xml.includes('<material_name>Name MAT-0006</material_name>'), 'xml lines');
const rx = buildOpenRosaXml(tx('r9', 'RECEIPT', 'SUPPLIER', 'LOC-CENTRAL', '2026-10-12T08:00:00Z', { supplierName: 'A & B <Ltd>', poNumber: '45' }, [['MAT-0006', '1', 'CUM']]));
assert(rx.includes('<supplier_name>A &amp; B &lt;Ltd&gt;</supplier_name>') && rx.includes('<po_number>45</po_number>'), 'xml supplier escaping');
const parsed = parseKoboSubmissionJson({
  client_tx_uuid: 'd1', tx_type: 'DISPATCH', tx_date_time: '2026-10-13T08:00:00Z', source_location: 'LOC-CENTRAL', destination_location: 'LOC-BLOCK-B',
  drr_code: 'DRR-1', block: 'B', sub_block: 'B1', mrf_number: 'MRF-10', _id: 5,
  material_lines: [{ 'material_lines/material_code': 'MAT-0006', 'material_lines/material_name': 'Sand', 'material_lines/quantity': '4', 'material_lines/unit': 'CUM' }],
});
assert(parsed.drrCode === 'DRR-1' && parsed.subBlock === 'B1' && parsed.mrfNumber === 'MRF-10' && parsed.lines[0].materialName === 'Sand', 'kobo json parse');

console.log('✓ DRR report, return netting, XML fields and JSON parsing verified.');

import { isValidQty, dateToIso } from './form.ts';
assert(isValidQty('11.442') && isValidQty('1000') && !isValidQty('0') && !isValidQty('-5') && !isValidQty('1.23456') && !isValidQty('abc') && !isValidQty(''), 'qty validation');
const noon = new Date(2026, 9, 21, 12, 0, 0);
assert(dateToIso('2026-10-20', noon) !== null && dateToIso('2026-10-21', noon) !== null, 'past and today allowed');
assert(dateToIso('2026-10-22', noon) === null && dateToIso('20/10/2026', noon) === null && dateToIso('2026-02-31', noon) === null, 'future / bad dates rejected');
console.log('✓ Form validation verified.');
