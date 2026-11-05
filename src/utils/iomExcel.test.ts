import { flattenSubmission } from './iomRecords.ts';
import { iomSheets, iomWorkbook, excelDateSerial } from './iomExcel.ts';

const assert = (c: unknown, m: string) => { if (!c) throw new Error('FAIL: ' + m); };
const rows = [
  ...flattenSubmission({ _id: 1, sd_storage: '13', entry_date: '2026-06-28', inventory_type: 'Dispatched', mrf_no: '34215', drr_code: 'C013-D-1', waybill_no: 'W1',
    rpt_items: [{ 'rpt_items/items': 'Sand', 'rpt_items/unit': 'Cum', 'rpt_items/quantity': '0.170', 'rpt_items/code': '68' }] }),
  ...flattenSubmission({ _id: 2, entry_date: '2026-06-28', inventory_type: 'Received', supplier: 'Ayan Corporation', po_number: '0042', grn_number: '77',
    rpt_items: [{ 'rpt_items/items': 'Cement', 'rpt_items/unit': 'Bag', 'rpt_items/quantity': '100' }] }),
  ...flattenSubmission({ _id: 3, entry_date: '2026-06-28', inventory_type: 'Returned', mrf_no: '34873',
    rpt_items: [{ 'rpt_items/items': 'Bricks', 'rpt_items/unit': 'Pcs', 'rpt_items/quantity': '200' }] }),
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
console.log('iomExcel tests passed');
