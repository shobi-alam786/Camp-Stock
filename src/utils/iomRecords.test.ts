import {
  buildQuery, buildFirstUrl, safeNextUrl, flattenSubmission, mergeSubmissions, filterRows, EMPTY_FILTERS,
  totalsByMaterial, sumDecimals, inRange, parseDataUrl, formatQty,
} from './iomRecords.ts';

function assert(c: boolean, m: string) { if (!c) throw new Error(`Assertion failed: ${m}`); }

const sub29 = {
  _id: 38479309, sd_storage: '13', entry_by: 'Shuly', entry_date: '2026-10-29', inventory_type: 'Dispatched',
  inventory_sub_type: 'Camp', mrf_no: '093233', drr_code: 'C013-B-260723-113841',
  rpt_items: [
    { 'rpt_items/items': 'Cement', 'rpt_items/unit': 'Bag', 'rpt_items/quantity': '1.5', 'rpt_items/sub_storage': 'Main Storage' },
    { 'rpt_items/items': 'Bricks', 'rpt_items/unit': 'Pcs', 'rpt_items/quantity': '150.0', 'rpt_items/sub_storage': 'Main Storage' },
  ],
};
const sub2024 = {
  _id: 11577995, entry_by: 'Md Al Mamun ', entry_date: '2024-06-10', inventory_type: 'Received', inventory_sub_type: 'Warehouse',
  warehouse: 'nhila_warehouse', waybill_no: '82693',
  rpt_items: [{ 'rpt_items/items': 'Cement', 'rpt_items/unit': 'Bag', 'rpt_items/quantity': '200.0' }],
};

export function runIomRecordsTests() {
  // query
  const q = JSON.parse(buildQuery('2026-10-29', '2026-10-29'));
  assert(q.sd_storage === '13' && q.entry_date.$gte === '2026-10-29' && q.entry_date.$lte === '2026-10-29', 'single day query');
  assert(!('entry_date' in JSON.parse(buildQuery('', ''))), 'no dates = no entry_date clause');
  const url = buildFirstUrl('https://kf.kobo.iom.int/', 'aP3n8sFSQ8FJFpbpFduYd4', '2026-10-01', '2026-10-29');
  assert(url.startsWith('https://kf.kobo.iom.int/api/v2/assets/aP3n8sFSQ8FJFpbpFduYd4/data/?'), 'url base');
  assert(decodeURIComponent(url).includes('"sd_storage":"13"'), 'url carries filter');
  assert(safeNextUrl('http://kf.kobo.iom.int/x') === 'https://kf.kobo.iom.int/x' && safeNextUrl(null) === null, 'next url');

  const p = parseDataUrl('https://kf.kobo.iom.int/api/v2/assets/aP3n8sFSQ8FJFpbpFduYd4/data/?limit=5&query=%7B%22sd_storage%22%3A%2213%22%7D&utm_source=chatgpt.com');
  assert(p?.server === 'https://kf.kobo.iom.int' && p?.uid === 'aP3n8sFSQ8FJFpbpFduYd4', 'parse data url');
  assert(parseDataUrl('not a url') === null, 'bad url');

  // flatten: one row per material, staff name trimmed
  const rows = flattenSubmission(sub29);
  assert(rows.length === 2 && rows[0].item === 'Cement' && rows[1].quantity === '150.0', 'expands rpt_items');
  assert(rows[0].rowKey === '38479309#0' && rows[1].rowKey === '38479309#1', 'row keys');
  assert(flattenSubmission(sub2024)[0].entryBy === 'Md Al Mamun', 'trims staff name');
  assert(flattenSubmission({ _id: 5, entry_date: '2026-01-01' }).length === 1, 'empty submission kept');
  assert(flattenSubmission({ entry_date: '2026-01-01' }).length === 0, 'no _id ignored');

  // dedupe by _id
  const a = mergeSubmissions([], [sub29, sub2024]);
  assert(a.rows.length === 3 && a.added === 2 && a.skipped === 0, 'first merge');
  const b = mergeSubmissions(a.rows, [sub29, sub29]);
  assert(b.rows.length === 3 && b.added === 0 && b.skipped === 2, 'duplicates skipped');

  const other = mergeSubmissions([], [{ ...sub29, _id: 1, sd_storage: '7' }, sub29]);
  assert(other.added === 1 && other.rows.every((r) => r.koboId === 38479309), 'other camps ignored');

  // filters
  const all = a.rows;
  assert(filterRows(all, '2026-10-29', '2026-10-29', EMPTY_FILTERS).length === 2, 'single day');
  assert(filterRows(all, '2024-01-01', '2026-12-31', EMPTY_FILTERS).length === 3, 'range');
  assert(filterRows(all, '', '', { ...EMPTY_FILTERS, type: 'Received' }).length === 1, 'type');
  assert(filterRows(all, '', '', { ...EMPTY_FILTERS, material: 'brick' }).length === 1, 'material');
  assert(filterRows(all, '', '', { ...EMPTY_FILTERS, material: '66' }).length === 0, 'material code is no longer searched');
  assert(filterRows(all, '', '', { ...EMPTY_FILTERS, search: '0932' }).length === 2, 'search finds MRF');
  assert(filterRows(all, '', '', { ...EMPTY_FILTERS, search: 'c013-b' }).length === 2, 'search finds DRR code');
  assert(filterRows(all, '', '', { ...EMPTY_FILTERS, search: 'nothing' }).length === 0, 'search no match');
  assert(!inRange(all[0], '2026-10-30', ''), 'range guard');

  // totals
  const t = totalsByMaterial(all);
  assert(t.find((x) => x.item === 'Cement')!.total === '201.5', 'cement total keeps three decimals');
  assert(t.find((x) => x.item === 'Bricks')!.total === '150.0', 'whole totals are shown as stored');
  assert(sumDecimals(['0.1', '0.2']) === '0.3', '0.1 + 0.2 is exactly 0.3');
  assert(sumDecimals(['1.5', '2.25', '3']) === '6.75', 'mixed decimals');
  assert(sumDecimals(['10.00', '5.50']) === '15.50', 'trailing zeros kept');
  assert(sumDecimals(['-1.5', '0.25']) === '-1.25', 'negative result');
  assert(sumDecimals(['abc', '2.5']) === '2.5', 'non-numbers skipped');
  assert(sumDecimals(['0.0001', '0.0002']) === '0.0003', 'small decimals kept');
  assert(formatQty('0.17') === '0.17' && formatQty('0.170') === '0.170' && formatQty('1.5') === '1.5', 'source decimal representation preserved');
  assert(formatQty('0.1700') === '0.1700' && formatQty('150.0') === '150.0' && formatQty('abc') === 'abc', 'longer decimals and whole numbers untouched');
  assert(formatQty('2.5') === '2.5' && formatQty('1.70') === '1.70', 'Kobo trailing-zero representation preserved exactly');
  assert(totalsByMaterial(flattenSubmission({ _id: 9, entry_date: '2026-01-01', rpt_items: [{ 'rpt_items/items': 'Sand', 'rpt_items/unit': 'Kg', 'rpt_items/quantity': '0.170' }] }))[0].total === '0.170', 'total keeps the last 0');

}

runIomRecordsTests();
console.log('iomRecords tests passed');
