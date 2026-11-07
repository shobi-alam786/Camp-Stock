import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { flattenSubmission } from './iomRecords.ts';
import { iomSheets, iomWorkbook, excelDateSerial, parseIomBalanceSheet } from './iomExcel.ts';
import { buildXlsx } from './xlsxWriter.ts';

const assert = (c: unknown, m: string) => { if (!c) throw new Error('FAIL: ' + m); };
const rows = [
  ...flattenSubmission({
    _id: 1, sd_storage: '13', entry_date: '2026-06-28', inventory_type: 'Dispatched', mrf_no: '34215', drr_code: 'C013-D-1', waybill_no: 'W1',
    rpt_items: [{ 'rpt_items/items': 'Sand', 'rpt_items/unit': 'Cum', 'rpt_items/quantity': '0.170', 'rpt_items/code': '68' }]
  }),
  ...flattenSubmission({
    _id: 2, entry_date: '2026-06-28', inventory_type: 'Received', supplier: 'Ayan Corporation', po_number: '0042', grn_number: '77',
    rpt_items: [{ 'rpt_items/items': 'Cement', 'rpt_items/unit': 'Bag', 'rpt_items/quantity': '100' }]
  }),
  ...flattenSubmission({
    _id: 3, entry_date: '2026-06-28', inventory_type: 'Returned', mrf_no: '34873',
    rpt_items: [{ 'rpt_items/items': 'Bricks', 'rpt_items/unit': 'Pcs', 'rpt_items/quantity': '200' }]
  }),
];
const s = iomSheets(rows);
assert(s.map((x) => x.name).join('|') === 'All records|Received|Dispatched|Returned', 'sheet names');
assert(s[0].rows.length === 3 && s[1].rows.length === 1 && s[2].rows.length === 1 && s[3].rows.length === 1, 'row counts');
assert(s[1].header.includes('Supplier') && !s[1].header.includes('MRF'), 'received columns');
assert(s[2].header.includes('Waybill') && !s[2].header.includes('Supplier'), 'dispatched columns');
const q = s[2].rows[0][s[2].header.indexOf('Quantity')];
assert(q && q.t === 'n' && q.v === '0.170' && q.scale === 3, 'quantity keeps trailing zero');
const po = s[1].rows[0][s[1].header.indexOf('PO number')];
assert(po && po.t === 's' && po.v === '0042', 'leading zeros kept as text');
assert(excelDateSerial('2026-06-28') === 46201, 'date serial');
const bytes = iomWorkbook(rows);
assert(bytes[0] === 0x50 && bytes[1] === 0x4b, 'zip signature');
assert(iomWorkbook([]).length > 0, 'empty workbook still builds');
const balanceWorkbook = buildXlsx([{
  name: 'BALANCE - CAMP', header: ['code', 'category', 'sub_category', 'items', 'unit', 'C013', 'TOTAL'], widths: [], rows: [
    [{ t: 'n', v: '1', scale: 0 }, { t: 's', v: 'Equipment' }, { t: 's', v: 'Compactor' }, { t: 's', v: 'Steel compactor' }, { t: 's', v: 'Pcs' }, { t: 'n', v: '7', scale: 0 }, { t: 'n', v: '7', scale: 0 }],
    [{ t: 'n', v: '2', scale: 0 }, { t: 's', v: 'Equipment' }, { t: 's', v: 'Tools' }, { t: 's', v: 'Zero quantity tool' }, { t: 's', v: 'Pcs' }, { t: 'n', v: '0', scale: 0 }, { t: 'n', v: '0', scale: 0 }],
    [{ t: 'n', v: '3', scale: 0 }, { t: 's', v: 'Equipment' }, { t: 's', v: 'Tools' }, { t: 's', v: 'Blank quantity tool' }, { t: 's', v: 'Pcs' }, null, null],
  ]
}]);
const importedBalance = parseIomBalanceSheet(balanceWorkbook);
assert(importedBalance.length === 3 && importedBalance[0].item === 'Steel compactor', 'balance sheet materials parsed');
assert(importedBalance[0].campQuantity === '7' && importedBalance[0].totalQuantity === '7', 'camp and total quantities parsed');
assert(importedBalance[1].totalQuantity === '0', 'zero cached TOTAL is preserved');
assert(importedBalance[2].totalQuantity === '', 'blank cached TOTAL is preserved');
let missingBalanceSheet = false;
try { parseIomBalanceSheet(buildXlsx([{ name: 'Other', header: ['items', 'unit', 'C013'], widths: [], rows: [] }])); }
catch { missingBalanceSheet = true; }
assert(missingBalanceSheet, 'missing balance worksheet rejected');

// The real workbook is optional for other checkouts; when present, verify its cached formula results directly.
if (existsSync('26CSR.xlsx')) {
  const actual = parseIomBalanceSheet(new Uint8Array(readFileSync('26CSR.xlsx')));
  assert(actual.length === 472, 'actual workbook has 472 Camp 13 material rows');
  assert(actual[0].item === 'Roller compacter' && actual[0].unit === 'Pcs' && actual[0].totalQuantity === '0', 'actual workbook first cached total');
  assert(actual[1].item === 'Steel compactor (manual)' && actual[1].unit === 'Pcs' && actual[1].totalQuantity === '7', 'actual workbook second cached total');
  assert(actual.filter((r) => r.totalQuantity === '0').length === 348, 'actual workbook zero cached totals preserved');
  assert(actual.filter((r) => r.totalQuantity !== '' && r.totalQuantity !== '0').length === 124, 'actual workbook nonzero cached totals preserved');
  assert(actual.every((r) => r.totalQuantity !== ''), 'actual workbook has no blank TOTAL values');
  const projectionHash = createHash('sha256').update(actual.map((r) => `${r.item}\t${r.unit}\t${r.totalQuantity}`).join('\n')).digest('hex');
  assert(projectionHash === '59b46a6d49337250e59c73782450f6e6ad4865905a7b5eb7d981fc8339472773', 'actual workbook projection matches the cross-platform fixture');
}
console.log('iomExcel tests passed');
