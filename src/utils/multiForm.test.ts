import { buildFormXml, formGroupFor, buildCatalogueXml, parseKoboSubmissionJson } from './koboXml.ts';
import { dispatchDetailsRows } from './dispatchDetails.ts';
import { findDuplicates } from './duplicateCheck.ts';
import { uidFor } from '../services/koboClient.ts';

function check(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }
const base: any = { sourceLocationId: 'LOC-CENTRAL', destinationLocationId: 'LOC-BLOCK-A', staffId: 'S', referenceNumber: 'R', syncStatus: 'PENDING', createdAt: '', modifiedAt: '' };
const disp: any = { ...base, clientTxUuid: 'd1', txType: 'DISPATCH', txDateTime: '2026-10-23T06:47:15', drrCode: 'C013-A', mrfNumber: '123321', subBlock: 'A01', lines: [{ materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '10', unit: 'PCS' }] };
const ret: any = { ...base, clientTxUuid: 'r1', txType: 'RETURN', txDateTime: '2026-10-27T09:00:00', drrCode: 'c013-a', mrfNumber: '123321', subBlock: 'A01', lines: [{ materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '4', damagedQuantity: '1', unit: 'PCS' }] };
const rec: any = { ...base, clientTxUuid: 'c1', txType: 'RECEIPT', txDateTime: '2026-10-22T08:00:00', supplierName: 'A & B <Ltd>', lines: [{ materialCode: 'MAT-0002', materialName: 'Tarp', quantity: '7', unit: 'PCS' }] };
const adj: any = { ...base, clientTxUuid: 'a1', txType: 'ADJUSTMENT_POS', txDateTime: '2026-10-22T08:00:00', lines: [{ materialCode: 'MAT-0002', quantity: '1', unit: 'PCS' }] };

// routing: three forms
const cfg: any = { serverUrl: 'x', formUid: 'RECORDS', formId: 'x', token: 't', uidHandover: 'HAND', uidStock: 'STOCK' };
check(['RECEIPT', 'DISPATCH', 'RETURN'].every((t) => uidFor(t, cfg) === 'RECORDS'), 'received/dispatched/returned -> Records form');
check(uidFor('STAFF_HANDOVER', cfg) === 'HAND', 'handover -> Staff Handover & Supplies form');
check(['STOCK_BASELINE', 'OPENING_STOCK', 'ADJUSTMENT_POS', 'ADJUSTMENT_NEG'].every((t) => uidFor(t, cfg) === 'STOCK'), 'starting balance + adjustments -> Stock form');
check(uidFor('STAFF_HANDOVER', { ...cfg, uidHandover: undefined }) === '', 'unset form UID is blank, never another form');
check(formGroupFor('RETURN') === 'RECORDS' && formGroupFor('STAFF_HANDOVER') === 'HANDOVER' && formGroupFor('ADJUSTMENT_NEG') === 'STOCK', 'groups');

// Records form: dispatch / return / receipt carry only the Records fields
const dx = buildFormXml(disp, 'camp_stock_records', 'U1');
check(dx.startsWith('<?xml') && dx.includes('<camp_stock_records id="camp_stock_records">') && dx.includes('<formhub><uuid>U1</uuid></formhub>'), 'records wrapper');
check(dx.includes('<drr_code>C013-A</drr_code>') && dx.includes('<mrf_number>123321</mrf_number>') && dx.includes('<sub_block>A01</sub_block>') && dx.includes('<damaged_quantity>0</damaged_quantity>'), 'dispatch fields');
check(!dx.includes('handover_') && !dx.includes('<dispatch_details>'), 'no handover fields, no old dispatch sheet');
const rx = buildFormXml(ret, 'camp_stock_records', 'U1');
check(rx.includes('<tx_type>RETURN</tx_type>') && rx.includes('<quantity>4</quantity><damaged_quantity>1</damaged_quantity>'), 'return quantities');
const cx = buildFormXml(rec, 'camp_stock_records', 'U2');
check(cx.includes('A &amp; B &lt;Ltd&gt;') && cx.includes('<material_lines>') && cx.includes('<supplier_name>'), 'receipt xml + escaping');
// Handover form
const ho: any = { ...base, clientTxUuid: 'h1', txType: 'STAFF_HANDOVER', txDateTime: '2026-10-22T08:00:00', handoverFromName: 'Ali', handoverToName: 'Sami', handoverDate: '2026-10-22', lines: [{ materialCode: 'MAT-0002', materialName: 'Tarp', quantity: '7', unit: 'PCS' }] };
const hx = buildFormXml(ho, 'camp_stock_handover', 'U5');
check(hx.includes('<handover_from_name>Ali</handover_from_name>') && !hx.includes('<drr_code>') && !hx.includes('<damaged_quantity>') && hx.includes('<quantity>7</quantity>'), 'handover xml');
// Stock form
const sx = buildFormXml(adj, 'camp_stock_stock', 'U3');
check(sx.includes('<camp_stock_stock id="camp_stock_stock">') && sx.includes('<tx_type>ADJUSTMENT_POS</tx_type>') && !sx.includes('<drr_code>') && !sx.includes('<damaged_quantity>'), 'stock xml');
const bx = buildFormXml({ ...adj, txType: 'STOCK_BASELINE' }, 'camp_stock_stock', 'U3');
check(bx.includes('<tx_type>STOCK_BASELINE</tx_type>'), 'baseline goes to stock form');
// pulling any of the three forms back gives the same record
const back = parseKoboSubmissionJson({ _id: 9, client_tx_uuid: 'h1', tx_type: 'STAFF_HANDOVER', tx_date_time: '2026-10-22T08:00:00', source_location: 'LOC-CENTRAL', destination_location: 'LOC-CENTRAL', handover_from_name: 'Ali', handover_to_name: 'Sami', material_lines: [{ 'material_lines/material_code': 'MAT-0002', 'material_lines/quantity': '7', 'material_lines/unit': 'PCS' }] }, 'TX');
check(back.txType === 'STAFF_HANDOVER' && back.handoverFromName === 'Ali' && back.lines[0].quantity === '7', 'handover restore');
// catalogue
const kx = buildCatalogueXml('camp_stock_catalogue', 'U4', 'x1', { code: 'MAT-0001', name: 'Bamboo', unit: 'PCS', isUnitConfirmed: false, isActive: false }, 'app');
check(kx.includes('<unit_confirmed>no</unit_confirmed><status>inactive</status>'), 'catalogue flags');
// restore round-trip for dispatch form (dispatch + return)
const cat = [{ code: 'MAT-0001', name: 'Bamboo Borak', unit: 'PCS' }];
const row = (type: string, dq: string, rq: string) => ({ _id: 1, client_tx_uuid: type, tx_type: type, tx_date_time: '2026-10-27T09:00:00', sub_block: 'A01', dispatch_details: [{ 'dispatch_details/drr_code': 'C013-A', 'dispatch_details/mrf_number': '123321', 'dispatch_details/materials': 'bamboo borak', 'dispatch_details/dispatch_qty': dq, 'dispatch_details/returned_qty': rq, 'dispatch_details/damaged_qty': '1' }] });
const pd = parseKoboSubmissionJson(row('DISPATCH', '10', '0'), 'DISPATCH', cat);  // old Dispatch-form rows still parse (data pulled earlier)
const pr = parseKoboSubmissionJson(row('RETURN', '0', '4'), 'DISPATCH', cat);
check(pd.lines[0].quantity === '10' && pr.lines[0].quantity === '4' && pr.lines[0].damagedQuantity === '1' && pd.drrCode === 'C013-A' && pd.subBlock === 'A01' && pd.lines[0].materialCode === 'MAT-0001' && pd.lines[0].unit === 'PCS', 'dispatch form restore finds code + unit by material name');
const prc = parseKoboSubmissionJson({ _id: 2, client_tx_uuid: 'c1', tx_date_time: 'x', material_lines: [{ 'material_lines/material_code': 'M', 'material_lines/quantity': '3' }] }, 'RECEIPT');
check(prc.txType === 'RECEIPT' && prc.lines[0].quantity === '3', 'receipt restore');
// report: restored ledger -> Dispatch Details merges dispatch + return
const rows = dispatchDetailsRows([pd, pr]);
check(rows.length === 1 && rows[0][4] === '10' && rows[0][5] === '4' && rows[0][6] === '1', 'dispatch details report merges restored rows');
// duplicate warning: same dispatch typed twice (two devices) is flagged; a different quantity is not
const twinDisp: any = { ...disp, clientTxUuid: 'd2' };
check(findDuplicates([disp, twinDisp], [twinDisp]).length === 1, 'identical dispatch from another device is flagged');
check(findDuplicates([disp, { ...disp, clientTxUuid: 'd3', lines: [{ ...disp.lines[0], quantity: '11' }] }], [disp]).length === 0, 'different quantity is not a duplicate');
check(findDuplicates([disp, ret], [ret]).length === 0, 'a return is not a duplicate of its dispatch');
console.log('multiForm tests passed');
