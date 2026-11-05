import type { InventoryTransaction } from '../types/inventory.ts';
import { INITIAL_MATERIAL_CATALOGUE, calculateCurrentStock } from '../types/inventory.ts';
import { buildOpeningBatch, buildHandover, buildOpeningChange, buildMovementStockBaselines, buildStockBaseline, handoverSnapshot, isValidPhone, newCustomMaterial, parseBulkMaterials, validateHandover } from './catalogueOps.ts';
import { buildOpenRosaXml, parseKoboSubmissionJson } from './koboXml.ts';

function assert(c: boolean, m: string) { if (!c) throw new Error(`Assertion failed: ${m}`); }

const LOC = 'LOC-CENTRAL';
const cement = { ...INITIAL_MATERIAL_CATALOGUE[4], unit: 'BAG', isUnitConfirmed: true };

export function runCatalogueOpsTests() {
  // --- new custom material with opening quantity shows in Opening and Current Stock
  const lamp = newCustomMaterial('  Solar   Lamp ', 'pcs');
  assert(lamp.name === 'Solar Lamp' && lamp.unit === 'PCS' && lamp.isCustom === true && lamp.code.startsWith('CUS-'), 'custom material');
  const t1 = buildOpeningChange({ material: lamp, locationId: LOC, desiredQty: '40', transactions: [], staff: 'Shobi' })!;
  let ledger: InventoryTransaction[] = [t1];
  let s = calculateCurrentStock(lamp.code, LOC, ledger);
  assert(s.openingStock === '40' && s.currentStock === '40', `opening 40 -> ${s.openingStock}/${s.currentStock}`);
  assert(calculateCurrentStock(lamp.code, 'LOC-BLOCK-A', ledger).currentStock === '0', 'other location unchanged');

  // --- raise, lower, and no change
  const up = buildOpeningChange({ material: lamp, locationId: LOC, desiredQty: '55.5', transactions: ledger, staff: 'S' })!;
  assert(up.lines[0].quantity === '15.5', 'delta up');
  ledger = [up, ...ledger];
  const down = buildOpeningChange({ material: lamp, locationId: LOC, desiredQty: '10', transactions: ledger, staff: 'S' })!;
  assert(down.lines[0].quantity === '-45.5', `delta down ${down.lines[0].quantity}`);
  ledger = [down, ...ledger];
  s = calculateCurrentStock(lamp.code, LOC, ledger);
  assert(s.openingStock === '10' && s.currentStock === '10', 'opening follows the typed number');
  assert(buildOpeningChange({ material: lamp, locationId: LOC, desiredQty: '10', transactions: ledger, staff: 'S' }) === null, 'no change = no record');

  // --- Current Stock follows opening when other movements exist
  const dispatch: InventoryTransaction = { ...t1, clientTxUuid: 'd', txType: 'DISPATCH', destinationLocationId: 'LOC-BLOCK-A', lines: [{ ...t1.lines[0], quantity: '4' }] };
  ledger = [dispatch, ...ledger];
  assert(calculateCurrentStock(lamp.code, LOC, ledger).currentStock === '6', 'current = opening - dispatch');

  // --- warehouse dispatch queues the resulting balance for the Kobo Stock Balance form
  const movement: InventoryTransaction = {
    ...dispatch,
    clientTxUuid: 'dispatch-snapshot-test',
    txDateTime: '2026-10-21T10:00:00.000Z',
    sourceLocationId: LOC,
    destinationLocationId: 'LOC-BLOCK-A',
    lines: [{ ...dispatch.lines[0], quantity: '4' }],
  };
  const movementSnapshots = buildMovementStockBaselines({
    movement,
    catalogue: [lamp],
    transactions: [t1],
    locationId: LOC,
    now: new Date('2026-10-21T10:01:00.000Z'),
  });
  assert(movementSnapshots.length === 1 && movementSnapshots[0].tx.txType === 'STOCK_BASELINE', 'dispatch queues one stock balance snapshot per material');
  assert(movementSnapshots[0].tx.lines[0].quantity === '36', `post-dispatch snapshot is 36, got ${movementSnapshots[0].tx.lines[0].quantity}`);
  assert(calculateCurrentStock(lamp.code, LOC, [movementSnapshots[0].tx, movement, t1]).currentStock === '36', 'snapshot and dispatch preserve the calculated balance');

  const more = buildOpeningChange({ material: lamp, locationId: LOC, desiredQty: '20', transactions: ledger, staff: 'S' })!;
  ledger = [more, ...ledger];
  assert(calculateCurrentStock(lamp.code, LOC, ledger).currentStock === '16', 'raising opening raises current');

  // --- catalogue edits replace the absolute current-stock baseline without altering movement history
  const baseline = buildStockBaseline({ material: lamp, locationId: LOC, desiredQty: '25', transactions: ledger, staff: 'S' })!;
  assert(baseline.txType === 'STOCK_BASELINE', 'catalogue edit uses STOCK_BASELINE');
  assert(calculateCurrentStock(lamp.code, LOC, [baseline, ...ledger]).currentStock === '25', 'catalogue edit sets exact current stock after movements');

  // --- bulk add makes one record
  const a = newCustomMaterial('A', 'PCS'), b = newCustomMaterial('B', 'KG'), c = newCustomMaterial('C', 'M');
  const batch = buildOpeningBatch({ items: [{ material: a, qty: '5' }, { material: b, qty: '0' }, { material: c, qty: '2.5' }], locationId: LOC, staff: 'S' })!;
  assert(batch.lines.length === 2 && batch.txType === 'STOCK_BASELINE', 'one record, zero rows skipped');
  assert(calculateCurrentStock(c.code, LOC, [batch]).currentStock === '2.5', 'batch opening counts');
  assert(buildOpeningBatch({ items: [{ material: b, qty: '0' }], locationId: LOC, staff: 'S' }) === null, 'all zero = nothing');

  // --- bulk text
  const rows = parseBulkMaterials('Cement, bag, 120\nSand;CUM;15,5\nGravel, , 3\nSolar Lamp, PCS, x\nsand, CUM, 1\n\nTape, ROLL', ['Solar Lamp']);
  assert(rows.length === 6, `rows ${rows.length}`);
  assert(!rows[0].error && rows[0].unit === 'BAG' && rows[0].qty === '120', 'row 1');
  assert(!rows[1].error && rows[1].qty === '15.5', 'comma decimal');
  assert(rows[2].error === 'Missing unit.', 'missing unit');
  assert(!!rows[3].error, 'existing name');
  assert(!!rows[4].error, 'repeated name in the same list');
  assert(!rows[5].error && rows[5].qty === '0', 'quantity optional');

  // --- staff handover
  assert(isValidPhone('+880 1817-239847') && !isValidPhone('12') && !isValidPhone('abc'), 'phone check');
  const base = { locationId: LOC, fromName: 'Ali', fromPhone: '01711111111', toName: 'Rahim', toPhone: '01822222222', date: '2026-10-20', notes: '' };
  assert(validateHandover(base) === '', 'valid handover');
  assert(validateHandover({ ...base, toName: '' }).includes('taking over'), 'missing name');
  assert(validateHandover({ ...base, fromPhone: '1' }).includes('handing over'), 'bad phone');
  assert(validateHandover({ ...base, date: '2999-01-01' }).includes('Date'), 'future date');

  const cat = [cement, { ...lamp }];
  const open = buildOpeningChange({ material: cement, locationId: LOC, desiredQty: '100', transactions: [], staff: 'S' })!;
  const full = [...ledger, open];
  const snap = handoverSnapshot(cat, LOC, full);
  assert(snap.length === 2 && snap.find((l) => l.material.code === cement.code)!.balance === '100', 'snapshot balances');
  const before = calculateCurrentStock(cement.code, LOC, full).currentStock;
  const ho = buildHandover(base, snap, new Date(2026, 9, 21, 10, 0, 0));
  assert(ho.txType === 'STAFF_HANDOVER' && ho.staffId === 'Ali' && ho.handoverToPhone === '01822222222', 'handover record');
  assert(ho.lines.length === 2 && ho.sourceLocationId === LOC && ho.destinationLocationId === LOC, 'handover lines/location');
  const after = [ho, ...full];
  assert(calculateCurrentStock(cement.code, LOC, after).currentStock === before, 'handover never changes stock');
  assert(handoverSnapshot(cat, LOC, after).length === 2, 'snapshot unchanged after handover');

  // --- Kobo XML round trip
  const xml = buildOpenRosaXml(ho);
  assert(xml.includes('<handover_from_name>Ali</handover_from_name>') && xml.includes('<handover_to_phone>01822222222</handover_to_phone>') && xml.includes('<handover_date>2026-10-20</handover_date>'), 'xml fields');
  assert(xml.includes('<tx_type>STAFF_HANDOVER</tx_type>') && (xml.match(/<material_lines>/g) || []).length === 2, 'xml type and lines');
  const parsed = parseKoboSubmissionJson({
    client_tx_uuid: ho.clientTxUuid, tx_type: 'STAFF_HANDOVER', tx_date_time: ho.txDateTime, source_location: LOC, destination_location: LOC,
    staff_id: 'Ali', ref_no: ho.referenceNumber, handover_from_name: 'Ali', handover_from_phone: '01711111111',
    handover_to_name: 'Rahim', handover_to_phone: '01822222222', handover_date: '2026-10-20',
    material_lines: [{ 'material_lines/material_code': cement.code, 'material_lines/quantity': '100', 'material_lines/unit': 'BAG', 'material_lines/material_name': 'Cement' }],
    _id: 9, _submission_time: '2026-10-21T10:00:00',
  });
  assert(parsed.handoverToName === 'Rahim' && parsed.handoverDate === '2026-10-20' && parsed.lines[0].quantity === '100', 'restore from Kobo');
}
runCatalogueOpsTests();
