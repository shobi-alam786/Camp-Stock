/**
 * End-to-end sync tests for the Windows app logic against a FAKE Kobo server.
 * The real KoboClient, XML builder, merge rules and sync engine run; only the HTTP transport is replaced.
 * Covers the test table of the synchronization fix (one material record = one Kobo submission).
 */
import { calculateCurrentStock, InventoryTransaction, INITIAL_MATERIAL_CATALOGUE } from '../types/inventory.ts';
import { buildBaselineRecords, buildSnapshotBaseline } from '../utils/catalogueOps.ts';
import { mergeRemote } from '../utils/syncRules.ts';
import { syncTransaction } from './syncEngine.ts';
import { koboClient, KoboServerConfig } from './koboClient.ts';

function assert(c: boolean, m: string) { if (!c) throw new Error(`Assertion failed: ${m}`); }

// ------------------------------------------------------------------ fake Kobo server
type Row = Record<string, any>;
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const one = (xml: string, tag: string) => { const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml); return m ? unesc(m[1]) : ''; };
const REPEAT_KEYS = ['material_code', 'material_name', 'quantity', 'damaged_quantity', 'unit', 'line_notes'];

class FakeKobo {
  forms: Record<string, Row[]> = { FORM_RECORDS: [], FORM_STOCK: [], FORM_HAND: [] };
  nextId = 1000;
  posts = 0; patches = 0;
  offline = false;
  loseNextPostResponse = false;
  patchNotFoundOnce = false;
  pageSize = 1000;

  rowsFor(uid: string) { return this.forms[uid]; }
  all(): Row[] { return Object.values(this.forms).flat(); }
  json(status: number, body: any) { return { status, json: async () => body, text: async () => JSON.stringify(body) }; }

  async fetch(url: string, init: any = {}): Promise<any> {
    if (this.offline) throw new Error('network down');
    const u = new URL(url);
    const method = init.method || 'GET';
    const m = /\/api\/v2\/assets\/([^/]+)\/(.*)$/.exec(u.pathname);
    if (method === 'POST' && u.pathname.endsWith('/submission')) return this.post(String(init.body));
    if (!m) return this.json(404, {});
    const [, uid, rest] = m;
    if (!this.forms[uid]) return this.json(404, {});
    if (rest === '' && method === 'GET') return this.json(200, { has_deployment: true, deployment__active: true, deployment__uuid: `dep-${uid}`, content: { settings: { id_string: `id_${uid}` } } });
    if (rest === 'data/bulk/' && method === 'PATCH') {
      if (this.patchNotFoundOnce) {
        this.patchNotFoundOnce = false;
        return this.json(404, { detail: 'Not found.' });
      }
      return this.bulk(uid, JSON.parse(init.body));
    }
    if (rest === 'data/' && method === 'GET') return this.list(uid, u);
    const one_ = /^data\/(\d+)\/$/.exec(rest);
    if (one_ && method === 'GET') { const r = this.forms[uid].find((x) => x._id === Number(one_[1])); return r ? this.json(200, r) : this.json(404, {}); }
    return this.json(404, {});
  }

  post(body: string) {
    this.posts++;
    const xml = body.slice(body.indexOf('<?xml'), body.lastIndexOf('--'));
    const formId = /<\?xml[^>]*\?><([A-Za-z0-9_]+) /.exec(xml)![1];
    const uid = formId.replace(/^id_/, '');
    const instanceId = one(xml, 'instanceID');
    const lines = [...xml.matchAll(/<material_lines>([\s\S]*?)<\/material_lines>/g)].map((x) => {
      const o: Row = {};
      for (const k of REPEAT_KEYS) { const v = one(x[1], k); if (v !== '' || k === 'material_code') o[`material_lines/${k}`] = (k === 'quantity' || k === 'damaged_quantity') ? parseFloat(v) : v; }
      return o;
    });
    const row: Row = { _id: this.nextId++, _uuid: instanceId.replace(/^uuid:/, ''), 'meta/instanceID': instanceId, _submission_time: new Date().toISOString(), material_lines: lines };
    for (const k of ['client_tx_uuid', 'tx_type', 'tx_date_time', 'source_location', 'destination_location', 'staff_id', 'ref_no', 'notes']) row[k] = one(xml, k);
    this.forms[uid].push(row);
    if (this.loseNextPostResponse) { this.loseNextPostResponse = false; throw new Error('timeout after the server accepted the submission'); }
    return { status: 201, json: async () => ({}), text: async () => '' };
  }

  bulk(uid: string, body: any) {
    this.patches++;
    const { submission_ids, data } = body.payload;
    let n = 0;
    for (const id of submission_ids) {
      const r = this.forms[uid].find((x) => x._id === Number(id));
      if (!r) continue;
      for (const [k, v] of Object.entries<string>(data)) {
        if (REPEAT_KEYS.includes(k)) r.material_lines.forEach((l: Row) => { l[`material_lines/${k}`] = (k === 'quantity' || k === 'damaged_quantity') ? parseFloat(v) : v; });
        else r[k] = v;
      }
      n++;
    }
    return this.json(200, { count: n, successes: n, failures: 0 });
  }

  list(uid: string, u: URL) {
    let rows = this.forms[uid];
    const q = u.searchParams.get('query');
    if (q) { const f = JSON.parse(q); rows = rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)); }
    const start = Number(u.searchParams.get('start') || 0);
    const limit = Math.min(Number(u.searchParams.get('limit') || 100), this.pageSize);
    return this.json(200, { count: rows.length, results: rows.slice(start, start + limit) });
  }
}

const kobo = new FakeKobo();
(globalThis as any).window = globalThis;
(globalThis as any).__TAURI_INTERNALS__ = {};
(globalThis as any).__TAURI__ = { http: { fetch: (url: string, init?: any) => kobo.fetch(url, init) } };

const config: KoboServerConfig = { serverUrl: 'https://kf.example.org', formUid: 'FORM_RECORDS', formId: 'x', token: 'T', uidHandover: 'FORM_HAND', uidStock: 'FORM_STOCK' };
const LOC = 'LOC-CENTRAL';
const borak = { ...INITIAL_MATERIAL_CATALOGUE[0], unit: 'PCS', isUnitConfirmed: true };      // Bamboo Borak
const treated = { ...INITIAL_MATERIAL_CATALOGUE[44], unit: 'PCS', isUnitConfirmed: true };  // Treated Borak Bamboo

// ------------------------------------------------------------------ fake devices (Windows or Android behave the same by the shared rules)
class Device {
  ledger: InventoryTransaction[] = [];
  constructor(public name: string) { }
  setStock(material: typeof borak, qty: string, at: string) {
    const r = buildSnapshotBaseline({ material, locationId: LOC, desiredQty: qty, transactions: this.ledger, staff: this.name, now: new Date(at) });
    if (!r) return;
    this.ledger = r.replaces ? this.ledger.map((t) => (t.clientTxUuid === r.tx.clientTxUuid ? r.tx : t)) : [r.tx, ...this.ledger];
  }
  /** Same steps as "Close day and sync": pull and merge, then send the pending records. */
  async sync(online = true) {
    if (!online) return;
    const pulled = await koboClient.fetchSubmissions(config, []);
    if (pulled.success && pulled.records) this.ledger = mergeRemote(this.ledger, pulled.records).records;
    for (const tx of this.ledger.filter((t) => t.syncStatus !== 'SYNCED')) {
      const out = await syncTransaction(tx, config, koboClient, this.ledger);
      this.ledger = this.ledger.map((t) => (t.clientTxUuid === tx.clientTxUuid ? out.tx : t));
    }
  }
  stock(material: typeof borak) { return calculateCurrentStock(material.code, LOC, this.ledger).currentStock; }
}
const qtyOf = (row: Row, code: string) => row.material_lines.find((l: Row) => l['material_lines/material_code'] === code)['material_lines/quantity'];
const stockRows = () => kobo.rowsFor('FORM_STOCK');

export async function runKoboSyncTests() {
  // --- 1. Quantity: the exact number typed is stored (old rule stored 600 for 585 when the ledger held a movement)
  const win = new Device('windows');
  win.ledger = [{
    clientTxUuid: 'disp-1', txType: 'DISPATCH', txDateTime: '2026-10-20T08:00:00.000Z', sourceLocationId: LOC, destinationLocationId: 'LOC-BLOCK-A',
    staffId: 's', referenceNumber: 'D-1', lines: [{ lineId: 'l1', materialCode: borak.code, materialName: borak.name, quantity: '15', unit: 'PCS' }],
    syncStatus: 'SYNCED', createdAt: '2026-10-20T08:00:00.000Z', modifiedAt: '2026-10-20T08:00:00.000Z',
  }];
  assert(win.stock(borak) === '-15', 'stock before count');
  win.setStock(borak, '585', '2026-10-21T08:00:00.000Z');
  assert(win.stock(borak) === '585', `Windows shows 585 after the count, got ${win.stock(borak)}`);
  assert(win.ledger.find((t) => t.txType === 'STOCK_BASELINE')!.lines[0].quantity === '585', 'baseline holds the typed quantity');
  await win.sync();
  assert(stockRows().length === 1 && qtyOf(stockRows()[0], borak.code) === 585, `Kobo shows 585 (windows enters 585)`);
  const originalId = stockRows()[0]._id;
  const rec = win.ledger.find((t) => t.txType === 'STOCK_BASELINE')!;
  assert(rec.koboSubmissionId === originalId && rec.syncStatus === 'SYNCED', 'local record maps to the Kobo _id');
  assert(rec.koboInstanceId === `uuid:${stockRows()[0]._uuid}`, 'local record keeps the Kobo _uuid');

  // --- 2. Synchronize twice: nothing new
  await win.sync(); await win.sync();
  assert(stockRows().length === 1 && kobo.posts === 1, `no duplicate after syncing twice (rows ${stockRows().length}, posts ${kobo.posts})`);

  // --- 3. Windows changes 585 -> 600: the original record is updated
  win.setStock(borak, '600', '2026-10-22T08:00:00.000Z');
  assert(win.ledger.filter((t) => t.txType === 'STOCK_BASELINE').length === 1, 'still ONE local record');
  await win.sync();
  assert(stockRows().length === 1 && stockRows()[0]._id === originalId && qtyOf(stockRows()[0], borak.code) === 600, 'Kobo record 585 -> 600 in place');
  assert(kobo.posts === 1 && kobo.patches === 1, `one POST, one PATCH (posts ${kobo.posts}, patches ${kobo.patches})`);

  // --- 4. Second device (Android rules) receives the change, edits 600 -> 450: original record updates, Windows receives it
  const and = new Device('android');
  await and.sync();
  assert(and.ledger.length === 1 && and.stock(borak) === '600', 'device 2 got the record with 600 after sync');
  and.setStock(borak, '450', '2026-10-23T08:00:00.000Z');
  await and.sync();
  assert(stockRows().length === 1 && stockRows()[0]._id === originalId && qtyOf(stockRows()[0], borak.code) === 450, 'Kobo record 600 -> 450 in place');
  await win.sync();
  assert(win.stock(borak) === '450' && win.ledger.filter((t) => t.txType === 'STOCK_BASELINE').length === 1, 'Windows sees 450 after sync, no second record');

  // --- 5. Edit offline, synchronize later
  win.setStock(borak, '300', '2026-10-24T08:00:00.000Z');
  kobo.offline = true; await win.sync(false);
  const out = await syncTransaction(win.ledger.find((t) => t.txType === 'STOCK_BASELINE')!, config, koboClient, win.ledger);
  assert(out.kind === 'unknown' && out.tx.koboSubmissionId === originalId, 'offline update keeps the Kobo id and stays queued');
  win.ledger = win.ledger.map((t) => (t.clientTxUuid === out.tx.clientTxUuid ? out.tx : t));
  kobo.offline = false; await win.sync();
  assert(stockRows().length === 1 && stockRows()[0]._id === originalId && qtyOf(stockRows()[0], borak.code) === 300, 'offline edit reached the ORIGINAL record');

  // --- 6. Same record edited in both apps while apart: newest count wins, still one submission
  win.setStock(borak, '280', '2026-10-25T08:00:00.000Z');       // older edit, made on Windows
  and.setStock(borak, '260', '2026-10-25T09:00:00.000Z');       // newer edit, made on Android (its copy is still 450 -> pull first)
  await and.sync(); await win.sync();
  assert(stockRows().length === 1 && qtyOf(stockRows()[0], borak.code) === 260, `newest edit wins (Kobo ${qtyOf(stockRows()[0], borak.code)})`);
  await and.sync(); await win.sync();
  assert(win.stock(borak) === '260' && and.stock(borak) === '260' && stockRows().length === 1, 'both devices agree, one submission');

  // --- 7. Changing one material leaves the others alone (one material = one submission)
  win.setStock(treated, '200', '2026-10-26T08:00:00.000Z');
  await win.sync();
  assert(stockRows().length === 2, 'second material has its own submission');
  const treatedRow = () => stockRows().find((r) => r.material_lines[0]['material_lines/material_code'] === treated.code)!;
  win.setStock(borak, '261', '2026-10-27T08:00:00.000Z');
  await win.sync();
  assert(qtyOf(treatedRow(), treated.code) === 200 && stockRows().length === 2, 'other material unchanged');
  assert(qtyOf(stockRows().find((r) => r._id === originalId)!, borak.code) === 261, 'edited material changed');

  // --- 8. Response lost after Kobo accepted a NEW record: the retry finds it, never posts again
  const dev3 = new Device('windows-2');
  const sand = { ...INITIAL_MATERIAL_CATALOGUE[5], unit: 'CUM', isUnitConfirmed: true };
  dev3.setStock(sand, '50.948', '2026-10-28T08:00:00.000Z');
  kobo.loseNextPostResponse = true;
  const before = kobo.posts;
  const lost = await syncTransaction(dev3.ledger[0], config, koboClient);
  assert(lost.kind === 'unknown' && kobo.posts === before + 1, 'first attempt: outcome unknown');
  dev3.ledger = [lost.tx];
  await dev3.sync();
  assert(kobo.posts === before + 1 && stockRows().length === 3, `retry did not post again (rows ${stockRows().length})`);
  assert(qtyOf(stockRows().find((r) => r.material_lines[0]['material_lines/material_code'] === sand.code)!, sand.code) === 50.948, 'decimals stay exact');
  assert(dev3.ledger[0].syncStatus === 'SYNCED' && !!dev3.ledger[0].koboSubmissionId, 'retry linked the existing submission');

  // --- 9. Bulk add: one record per material
  const recs = buildBaselineRecords({ items: [{ material: borak, qty: '5' }, { material: treated, qty: '0' }, { material: sand, qty: '2.5' }], locationId: LOC, staff: 's' });
  assert(recs.length === 2 && recs.every((r) => r.lines.length === 1), 'one record per material, zero rows skipped');

  // --- 10. Paging: more rows than one page are all read
  kobo.pageSize = 2;
  const pulled = await koboClient.fetchSubmissions(config, []);
  assert(pulled.success && pulled.records!.length === 3, `all pages read (${pulled.records?.length})`);
  kobo.pageSize = 1000;

  // --- 11. PATCH 404 while UUID lookup still finds the same submission: keep queued, never create a duplicate
  win.setStock(borak, '263', '2026-10-28T08:30:00.000Z');
  const pending404 = win.ledger.find((t) => t.txType === 'STOCK_BASELINE' && t.lines[0].materialCode === borak.code)!;
  kobo.patchNotFoundOnce = true;
  const postsBefore404 = kobo.posts;
  const patch404 = await syncTransaction(pending404, config, koboClient, win.ledger);
  assert(patch404.kind === 'failed' && patch404.tx.koboSubmissionId === originalId, 'PATCH 404 with matching UUID stays queued with its existing Kobo ID');
  assert(kobo.posts === postsBefore404, 'PATCH 404 with matching UUID never creates a duplicate submission');
  const retry404 = await syncTransaction(patch404.tx, config, koboClient, win.ledger);
  assert(retry404.kind === 'updated' && retry404.tx.syncStatus === 'SYNCED', 'the same record can be updated on a later successful retry');
  assert(kobo.posts === postsBefore404, 'successful retry updates without creating a submission');

  // --- 12. The saved _id is not in this form (wrong form first, or deleted): found by client_tx_uuid or re-sent ONCE, never stuck
  const stray = stockRows().findIndex((r) => r._id === originalId);
  const [removed] = stockRows().splice(stray, 1);
  win.setStock(borak, '262', '2026-10-28T09:00:00.000Z');
  await win.sync();
  const rec2 = win.ledger.find((t) => t.txType === 'STOCK_BASELINE' && t.lines[0].materialCode === borak.code)!;
  assert(rec2.syncStatus === 'SYNCED' && rec2.koboSubmissionId !== originalId && !!rec2.koboSubmissionId, 'missing submission: record re-sent once and re-linked');
  assert(stockRows().filter((r) => r.material_lines[0]['material_lines/material_code'] === borak.code).length === 1, 'still one row for the material');
  const posts11 = kobo.posts;
  await win.sync(); await win.sync();
  assert(kobo.posts === posts11, 'no further posts');
  void removed;

  console.log('✓ Kobo sync tests passed (exact quantity, update in place, no duplicates, offline, conflicts, retries).');
}

runKoboSyncTests().catch((e) => { console.error(e); process.exit(1); });
