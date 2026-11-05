import { calculateCurrentStock, InventoryTransaction, INITIAL_MATERIAL_CATALOGUE } from '../types/inventory.ts';
import { buildSnapshotBaseline, findBaselineRecord } from './catalogueOps.ts';
import { mergeRemote, sameContent, syncActionFor } from './syncRules.ts';

function assert(c: boolean, m: string) { if (!c) throw new Error(`Assertion failed: ${m}`); }
const LOC = 'LOC-CENTRAL';
const m = { ...INITIAL_MATERIAL_CATALOGUE[0], unit: 'PCS', isUnitConfirmed: true };
const base = (over: Partial<InventoryTransaction>): InventoryTransaction => ({
  clientTxUuid: 'u', txType: 'STOCK_BASELINE', txDateTime: '2026-10-20T08:00:00.000Z', sourceLocationId: LOC, destinationLocationId: LOC, staffId: 's', referenceNumber: 'SNAP-1',
  lines: [{ lineId: 'u-line-1', materialCode: m.code, materialName: m.name, quantity: '585', unit: 'PCS' }], syncStatus: 'SYNCED', createdAt: '2026-10-20T08:00:00.000Z', modifiedAt: '2026-10-20T08:00:00.000Z', ...over,
});
const mv = (type: 'RECEIPT' | 'DISPATCH', qty: string, at: string, id: string): InventoryTransaction => ({
  clientTxUuid: id, txType: type, txDateTime: at, sourceLocationId: type === 'DISPATCH' ? LOC : 'SUP', destinationLocationId: type === 'DISPATCH' ? 'LOC-BLOCK-A' : LOC,
  staffId: 's', referenceNumber: id, lines: [{ lineId: id + '-l', materialCode: m.code, materialName: m.name, quantity: qty, unit: 'PCS' }], syncStatus: 'SYNCED', createdAt: at, modifiedAt: at,
});

export function runSyncRuleTests() {
  // snapshot baseline: exact quantity, only LATER movements count
  const ledger = [mv('DISPATCH', '100', '2026-10-19T08:00:00.000Z', 'old'), base({}), mv('DISPATCH', '25', '2026-10-21T08:00:00.000Z', 'new')];
  assert(calculateCurrentStock(m.code, LOC, ledger).currentStock === '560', 'snapshot 585 - later dispatch 25 = 560; earlier dispatch is already in the count');
  const c = calculateCurrentStock(m.code, LOC, ledger);
  assert(c.openingStock === '685' && c.currentStock === '560', 'opening column = value that makes the table add up');

  // legacy baseline (other reference prefix) keeps the old meaning: baseline + all movements
  const legacy = [mv('DISPATCH', '100', '2026-10-19T08:00:00.000Z', 'old'), base({ referenceNumber: 'STK-20261020-AB12', lines: [{ lineId: 'x', materialCode: m.code, materialName: m.name, quantity: '700', unit: 'PCS' }] })];
  assert(calculateCurrentStock(m.code, LOC, legacy).currentStock === '600', 'legacy baselines are not re-interpreted');

  // editing: same record, same identity, marked pending, nothing duplicated
  const synced = base({ koboSubmissionId: 77, koboInstanceId: 'uuid:abc' });
  const r = buildSnapshotBaseline({ material: m, locationId: LOC, desiredQty: '600', transactions: [synced], staff: 'Shobi', now: new Date('2026-10-22T08:00:00.000Z') })!;
  assert(r.replaces && r.tx.clientTxUuid === 'u' && r.tx.koboSubmissionId === 77 && r.tx.koboInstanceId === 'uuid:abc', 'edit keeps the record identity and Kobo ids');
  assert(r.tx.syncStatus === 'PENDING' && r.tx.lines[0].quantity === '600' && syncActionFor(r.tx) === 'UPDATE', 'edit is a pending UPDATE of the exact quantity');
  assert(buildSnapshotBaseline({ material: m, locationId: LOC, desiredQty: '585.0', transactions: [synced], staff: 's' }) === null, 'same quantity = nothing to do');
  assert(findBaselineRecord(m.code, LOC, [synced])?.clientTxUuid === 'u', 'finds the record to edit');
  const fresh = buildSnapshotBaseline({ material: m, locationId: LOC, desiredQty: '12.50', transactions: [], staff: 's' })!;
  assert(!fresh.replaces && fresh.tx.lines[0].quantity === '12.5' && syncActionFor(fresh.tx) === 'CREATE', 'first count = new record, exact value');

  // merge: edits from other devices arrive, local pending edits are protected, nothing is duplicated
  const remoteNewer = base({ koboSubmissionId: 77, koboInstanceId: 'uuid:abc', txDateTime: '2026-10-23T08:00:00.000Z', lines: [{ lineId: 'r', materialCode: m.code, materialName: m.name, quantity: '450', unit: 'PCS' }] });
  let res = mergeRemote([synced], [remoteNewer]);
  assert(res.records.length === 1 && res.updated === 1 && res.records[0].lines[0].quantity === '450' && res.records[0].syncStatus === 'SYNCED', 'synced local record takes the Kobo edit');
  res = mergeRemote([r.tx], [remoteNewer]);
  assert(res.records[0].lines[0].quantity === '450' && res.updated === 1, 'newer Kobo version beats an older pending local edit');
  const newerLocal = buildSnapshotBaseline({ material: m, locationId: LOC, desiredQty: '300', transactions: [synced], staff: 's', now: new Date('2026-10-24T08:00:00.000Z') })!.tx;
  res = mergeRemote([newerLocal], [remoteNewer]);
  assert(res.keptLocal === 1 && res.records[0].lines[0].quantity === '300' && res.records[0].syncStatus === 'PENDING', 'newer local edit is kept and will update Kobo');
  const pendingCreate = base({ syncStatus: 'OUTCOME_UNKNOWN' });
  res = mergeRemote([pendingCreate], [base({ koboSubmissionId: 5, koboInstanceId: 'uuid:u' })]);
  assert(res.records.length === 1 && res.records[0].syncStatus === 'SYNCED' && res.records[0].koboSubmissionId === 5, 'unknown outcome resolved by linking, no duplicate');
  assert(sameContent(base({}), base({ lines: [{ lineId: 'z', materialCode: m.code, materialName: '', quantity: '585.0000', unit: 'PCS' }] })), '585 equals 585.0000');
  console.log('✓ Sync rule tests passed.');
}
runSyncRuleTests();
