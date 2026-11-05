/**
 * Camp Stock Inventory Management System
 * Unified Kobo Client for Windows Desktop & Web
 */

import { buildFormXml, buildMultipartSubmission, buildCatalogueXml, buildUpdateData, parseKoboSubmissionJson, formGroupFor } from '../utils/koboXml.ts';
import { DecimalSafe, InventoryTransaction, MaterialCatalogueItem, instantOf } from '../types/inventory.ts';
import { sameContent } from '../utils/syncRules.ts';

// Asset UIDs are identifiers, not secrets (the API token is the secret).
export const DEFAULT_UID_CATALOGUE = 'axcwQUvw74V3PnskvpjWZ9';

export interface KoboServerConfig {
  serverUrl: string;
  /** "Camp Stock - Records" form UID (received, dispatched, returned). Also used for REST reads and the connection test. */
  formUid: string;
  /** Form ID / id_string - detected automatically from the asset API. */
  formId: string;
  token: string;
  /** "Camp Stock - Staff Handover & Supplies" form UID. */
  uidHandover?: string;
  /** "Camp Stock - Stock Balance" form UID (starting balance and stock adjustments). */
  uidStock?: string;
  /** "Camp Stock - Material Catalogue" form UID. */
  uidCatalogue?: string;
}

/** Which Kobo form a transaction type is sent to (blank = that form's UID is not set up yet). */
export function uidFor(txType: string, config: KoboServerConfig): string {
  const group = formGroupFor(txType);
  if (group === 'HANDOVER') return config.uidHandover || '';
  if (group === 'STOCK') return config.uidStock || '';
  return config.formUid;
}

interface ResolvedForm { uid: string; idString: string; uuid: string }
const base = (c: KoboServerConfig) => c.serverUrl.replace(/\/$/, '');

export class KoboClient {
  private getTauriFetch(): ((input: any, init?: any) => Promise<any>) | null {
    if (typeof window === 'undefined') return null;
    const win = window as any;
    if (win.__TAURI_INTERNALS__ && win.__TAURI__?.http?.fetch) {
      return win.__TAURI__.http.fetch;
    }
    return null;
  }

  /** Opens one form through the asset API and checks it is deployed. */
  private async resolveForm(
    uid: string, config: KoboServerConfig, tauriFetch: (input: any, init?: any) => Promise<any>
  ): Promise<{ form?: ResolvedForm; error?: string }> {
    if (!uid) return { error: 'A Kobo form UID is missing in Settings.' };
    const res = await tauriFetch(`${base(config)}/api/v2/assets/${encodeURIComponent(uid)}/?format=json`, {
      method: 'GET', headers: { Authorization: `Token ${config.token}` },
    });
    if (res.status === 401 || res.status === 403) return { error: `Token refused by Kobo (HTTP ${res.status}). Check API token.` };
    if (res.status !== 200) return { error: `Cannot open Kobo form ${uid} (HTTP ${res.status}). Check server, form UID and that the token's account can see the form.` };
    const asset = await res.json();
    const idString = asset?.content?.settings?.id_string;
    const uuid = asset?.deployment__uuid;
    if (asset?.has_deployment === false || asset?.deployment__active === false || !uuid || !idString) {
      return { error: `Kobo form ${uid} is not deployed. Deploy it in Kobo first.` };
    }
    return { form: { uid, idString, uuid } };
  }

  async testConnection(config: KoboServerConfig): Promise<{ success: boolean; message: string }> {
    try {
      const tauriFetch = this.getTauriFetch();
      if (!tauriFetch) {
        return {
          success: false,
          message: 'Not running inside the Windows app, so Kobo cannot be reached (browser CORS). Install and open the Windows app to test.',
        };
      }
      const forms: Array<[string, string]> = [
        ['Records', config.formUid],
        ['Staff Handover & Supplies', config.uidHandover || ''],
        ['Stock Balance', config.uidStock || ''],
        ['Material Catalogue', config.uidCatalogue || DEFAULT_UID_CATALOGUE],
      ];
      const results: string[] = [];
      let allOk = true;
      for (const [label, uid] of forms) {
        const r = await this.resolveForm(uid, config, tauriFetch);
        if (r.form) results.push(`${label}: OK (${r.form.idString})`);
        else { allOk = false; results.push(`${label}: ${r.error}`); }
      }
      return { success: allOk, message: results.join(' | ') };
    } catch (e: any) {
      return { success: false, message: `Connection test error: ${e?.message || 'Unknown'}` };
    }
  }

  async submitTransaction(
    tx: InventoryTransaction,
    config: KoboServerConfig,
    ledger: InventoryTransaction[] = []
  ): Promise<{ success: boolean; submissionId?: number; instanceId?: string; error?: string; outcomeUnknown?: boolean; warning?: string }> {
    try {
      if (!config.token || !config.formUid) {
        return { success: false, error: 'Kobo token or Form Asset UID is missing in Settings.' };
      }
      const tauriFetch = this.getTauriFetch();
      if (!tauriFetch) {
        return { success: false, error: 'Not running inside the Windows app: submission was NOT sent to Kobo.' };
      }

      // The form UUID (deployment__uuid) goes into <formhub><uuid> and is how Kobo finds the form;
      // the XML root is the form's real id_string. Both come from the asset API.
      const { form, error } = await this.resolveForm(uidFor(tx.txType, config), config, tauriFetch);
      if (!form) return { success: false, error: `${error} Transaction was not submitted.` };

      const xml = buildFormXml(tx, form.idString, form.uuid);
      // Kobo's OpenRosa endpoint is hosted on the legacy KoboCAT host for the
      // Global server. Keep the endpoint slash-less: /submission/ returns 404.
      const submissionUrl = `${config.serverUrl.replace(/^https:\/\/kf\./, 'https://kc.').replace(/\/$/, '')}/submission`;
      const res = await this.postXml(xml, submissionUrl, config, tauriFetch);
      if (res.status === 201 || res.status === 202) {
        // Remember which Kobo submission this record is (_id / _uuid), so later edits update it instead of adding another one.
        // Best effort: when this lookup fails the record is still sent; the next pull links the ids by client_tx_uuid.
        const found = await this.findSubmissionByClientUuid(tx, config);
        if (!found.found) return { success: true };
        const mismatch = found.remote ? this.quantityMismatch(tx, found.remote) : '';
        return { success: true, submissionId: found.submissionId, instanceId: found.instanceId, warning: mismatch || undefined };
      }
      let detail = '';
      try { detail = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); } catch {}
      return { success: false, error: `Kobo rejected submission (HTTP ${res.status}) ${detail}`.trim() };
    } catch (e: any) {
      // A timeout may occur after Kobo accepted the submission. Never treat it as safe to blindly retry.
      return { success: false, outcomeUnknown: true, error: `Submission outcome unknown; check Kobo before retrying. ${e?.message || 'Network exception'}` };
    }
  }

  private async postXml(
    xml: string, submissionUrl: string, config: KoboServerConfig, tauriFetch: (input: any, init?: any) => Promise<any>
  ): Promise<{ status: number; text: () => Promise<string> }> {
    const boundary = `----CampStockBoundary${Date.now()}`;
    return tauriFetch(submissionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.token}`,
        'X-OpenRosa-Version': '1.0',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: buildMultipartSubmission(xml, boundary),
    });
  }

  /** Downloads EVERY submission of one Kobo form, page by page (Kobo returns at most 1000 per request). */
  private async fetchRows(uid: string, config: KoboServerConfig, tauriFetch: (input: any, init?: any) => Promise<any>): Promise<Record<string, any>[]> {
    const PAGE = 1000;
    const all: Record<string, any>[] = [];
    for (let start = 0, guard = 0; guard < 500; guard++) {
      const url = `${base(config)}/api/v2/assets/${encodeURIComponent(uid)}/data/?format=json&limit=${PAGE}&start=${start}`;
      const res = await tauriFetch(url, { method: 'GET', headers: { Authorization: `Token ${config.token}` } });
      if (res.status !== 200) throw new Error(`Kobo form ${uid} answered HTTP ${res.status}`);
      const payload = await res.json();
      const rows = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : null;
      if (!rows) throw new Error('Kobo response did not contain a records list.');
      all.push(...rows);
      const total = Number(payload?.count);
      start += rows.length;
      if (rows.length === 0) break;
      if (Number.isFinite(total)) { if (start >= total) break; } else if (rows.length < PAGE) break;
    }
    return all;
  }

  /** Newest catalogue record per material code. */
  private latestCatalogue(rows: Record<string, any>[]): Map<string, Record<string, any>> {
    const latest = new Map<string, Record<string, any>>();
    [...rows]
      .sort((a, b) => String(a._submission_time || '').localeCompare(String(b._submission_time || '')) || Number(a._id) - Number(b._id))
      .forEach((r) => { const code = String(r.material_code || '').trim(); if (code) latest.set(code, r); });
    return latest;
  }

  /** Newest current-stock record per material and warehouse. Legacy rows without location are central-warehouse rows. */
  private latestStockCatalogue(rows: Record<string, any>[], locationId: string): Map<string, Record<string, any>> {
    const latest = new Map<string, Record<string, any>>();
    [...rows].sort((a, b) => String(a._submission_time || '').localeCompare(String(b._submission_time || '')) || Number(a._id) - Number(b._id))
      .forEach((r) => {
        const code = String(r.material_code || '').trim();
        const loc = String(r.location_id || 'LOC-CENTRAL').trim();
        if (code && loc === locationId) latest.set(code, r);
      });
    return latest;
  }

  /** Material Catalogue (Kobo) -> list of catalogue items (newest record per code). */
  async fetchCatalogue(config: KoboServerConfig): Promise<{ success: boolean; items?: MaterialCatalogueItem[]; error?: string }> {
    const tauriFetch = this.getTauriFetch();
    if (!tauriFetch) return { success: false, error: 'Catalogue download requires the installed Windows app.' };
    try {
      const rows = await this.fetchRows(config.uidCatalogue || DEFAULT_UID_CATALOGUE, config, tauriFetch);
      const originalCode = /^MAT-00(0[1-9]|[1-3][0-9]|4[0-5])$/;
      const items = Array.from(this.latestCatalogue(rows).entries()).map(([code, r]) => ({
        code,
        name: String(r.material_name || code).trim(),
        unit: String(r.unit || 'NEEDS_CONFIRMATION').trim() as MaterialCatalogueItem['unit'],
        isUnitConfirmed: String(r.unit_confirmed).toLowerCase() === 'yes',
        notes: r.notes || undefined,
        isCustom: !originalCode.test(code),
        isActive: String(r.status).toLowerCase() !== 'inactive',
      }));
      return { success: true, items };
    } catch (e: any) {
      return { success: false, error: `Catalogue download failed: ${e?.message || 'Network exception'}` };
    }
  }

  /** This computer -> Material Catalogue (Kobo): sends only materials that are new or differ from Kobo's newest record. */
  async uploadCatalogue(
    local: MaterialCatalogueItem[], config: KoboServerConfig, locationId = 'LOC-CENTRAL', currentStocks: Record<string, string> = {}
  ): Promise<{ success: boolean; sent: number; same: number; error?: string }> {
    const tauriFetch = this.getTauriFetch();
    if (!tauriFetch) return { success: false, sent: 0, same: 0, error: 'Catalogue upload requires the installed Windows app.' };
    try {
      const uid = config.uidCatalogue || DEFAULT_UID_CATALOGUE;
      const { form, error } = await this.resolveForm(uid, config, tauriFetch);
      if (!form) return { success: false, sent: 0, same: 0, error };
      const rows = await this.fetchRows(uid, config, tauriFetch);
      const remote = this.latestStockCatalogue(rows, locationId);
      const submissionUrl = `${config.serverUrl.replace(/^https:\/\/kf\./, 'https://kc.').replace(/\/$/, '')}/submission`;
      let sent = 0;
      let same = 0;
      for (const m of local) {
        const stock = currentStocks[m.code] ?? '0';
        const r = remote.get(m.code);
        const metadataSame = !!r && String(r.material_name) === m.name && String(r.unit) === m.unit &&
          String(r.unit_confirmed).toLowerCase() === (m.isUnitConfirmed ? 'yes' : 'no') &&
          String(r.status).toLowerCase() === (m.isActive === false ? 'inactive' : 'active');
        const stockSame = !!r && String(r.current_stock ?? '0') === stock && String(r.location_id || 'LOC-CENTRAL') === locationId;
        if (metadataSame && stockSame) { same++; continue; }
        if (r) {
          const res = await tauriFetch(`${base(config)}/api/v2/assets/${encodeURIComponent(uid)}/data/bulk/`, {
            method: 'PATCH',
            headers: { Authorization: `Token ${config.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: { submission_ids: [String(r._id)], data: {
              material_name: m.name, unit: m.unit, unit_confirmed: m.isUnitConfirmed ? 'yes' : 'no',
              status: m.isActive === false ? 'inactive' : 'active', notes: m.notes || '', updated_by: 'windows-app',
              location_id: locationId, current_stock: stock,
            } } }),
          });
          if (res.status >= 200 && res.status < 300) sent++;
          else return { success: false, sent, same, error: `Catalogue update stopped after ${sent}: HTTP ${res.status}` };
        } else {
          const recordUuid = (globalThis.crypto as any)?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const res = await this.postXml(buildCatalogueXml(form.idString, form.uuid, recordUuid, m, 'windows-app', locationId, stock), submissionUrl, config, tauriFetch);
          if (res.status === 201 || res.status === 202) sent++;
          else return { success: false, sent, same, error: `Catalogue upload stopped after ${sent}: HTTP ${res.status}` };
        }
      }
      return { success: true, sent, same };
    } catch (e: any) {
      return { success: false, sent: 0, same: 0, error: `Catalogue upload failed: ${e?.message || 'Network exception'}` };
    }
  }

  async fetchSubmissions(config: KoboServerConfig, catalogue: ReadonlyArray<{ code: string; name: string; unit: string }> = []): Promise<{ success: boolean; records?: InventoryTransaction[]; error?: string }> {
    const tauriFetch = this.getTauriFetch();
    if (!tauriFetch) return { success: false, error: 'Restore requires the installed Windows app; browser preview cannot make the authenticated Kobo request.' };
    if (!config.token || !config.formUid) return { success: false, error: 'Kobo token or Form Asset UID is missing in Settings.' };
    try {
      // The three forms; a form whose UID is not entered yet is skipped.
      const uids = [config.formUid, config.uidHandover || '', config.uidStock || ''].filter((u) => u.trim());
      const records: InventoryTransaction[] = [];
      for (const uid of uids) {
        const rows = await this.fetchRows(uid, config, tauriFetch);
        records.push(...rows.map((r) => parseKoboSubmissionJson(r, 'TX', catalogue)));
      }
      return { success: true, records };
    } catch (e: any) {
      return { success: false, error: `Kobo restore error: ${e?.message || 'Network exception'}` };
    }
  }

  /** Compares the quantities Kobo holds with the local record. Empty text = identical. */
  private quantityMismatch(tx: InventoryTransaction, remote: InventoryTransaction): string {
    for (const l of tx.lines) {
      const r = remote.lines.find((x) => x.materialCode === l.materialCode);
      if (!r) return `Kobo has no line for ${l.materialCode}.`;
      try {
        if (DecimalSafe.compare(l.quantity, r.quantity) !== 0) return `Kobo stored ${r.quantity} for ${l.materialCode} but ${l.quantity} was entered.`;
      } catch { return `Kobo quantity "${r.quantity}" for ${l.materialCode} could not be checked.`; }
    }
    return '';
  }

  /** Finds the Kobo submission of a record by its client_tx_uuid. Gives back its _id, _uuid and content. */
  async findSubmissionByClientUuid(tx: InventoryTransaction, config: KoboServerConfig):
    Promise<{ found: boolean; submissionId?: number; instanceId?: string; remote?: InventoryTransaction; error?: string }> {
    const tauriFetch = this.getTauriFetch();
    if (!tauriFetch) return { found: false, error: 'Remote verification requires the installed Windows app.' };
    if (!config.token || !config.formUid) return { found: false, error: 'Kobo configuration is incomplete.' };
    try {
      const query = encodeURIComponent(JSON.stringify({ client_tx_uuid: tx.clientTxUuid }));
      const url = `${config.serverUrl.replace(/\/$/, '')}/api/v2/assets/${encodeURIComponent(uidFor(tx.txType, config))}/data/?format=json&limit=10&query=${query}`;
      const res = await tauriFetch(url, { method: 'GET', headers: { Authorization: `Token ${config.token}` } });
      if (res.status !== 200) return { found: false, error: `Remote duplicate check failed (HTTP ${res.status}); do not retry yet.` };
      const payload = await res.json();
      const rows = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
      const match = rows.find((r: Record<string, any>) => r.client_tx_uuid === tx.clientTxUuid);
      if (!match) return { found: false };
      const remote = parseKoboSubmissionJson(match, 'TX');
      return { found: true, submissionId: Number(match._id) || undefined, instanceId: remote.koboInstanceId, remote };
    } catch (e: any) {
      return { found: false, error: `Remote duplicate check error: ${e?.message || 'Network exception'}` };
    }
  }

  /** Reads ONE submission by its Kobo _id. 404 = it no longer exists on Kobo. */
  private async fetchSubmissionById(uid: string, id: number, config: KoboServerConfig, tauriFetch: (input: any, init?: any) => Promise<any>):
    Promise<{ status: number; row?: Record<string, any> }> {
    const res = await tauriFetch(`${base(config)}/api/v2/assets/${encodeURIComponent(uid)}/data/${id}/?format=json`, { method: 'GET', headers: { Authorization: `Token ${config.token}` } });
    if (res.status !== 200) return { status: res.status };
    return { status: 200, row: await res.json() };
  }

  /**
   * Updates the EXISTING Kobo submission of a single-material record (found by its Kobo _id); never posts a new one.
   * If Kobo holds a NEWER version of the record (edited on another device), nothing is sent and that version is returned as `remote`.
   */
  async updateTransaction(tx: InventoryTransaction, config: KoboServerConfig):
    Promise<{ success: boolean; remote?: InventoryTransaction; error?: string; outcomeUnknown?: boolean; warning?: string; notFound?: boolean }> {
    const tauriFetch = this.getTauriFetch();
    if (!tauriFetch) return { success: false, error: 'Not running inside the Windows app: the update was NOT sent to Kobo.' };
    if (!config.token) return { success: false, error: 'Kobo token is missing in Settings.' };
    if (!tx.koboSubmissionId) return { success: false, error: 'This record has no Kobo submission id yet.' };
    if (tx.lines.length !== 1) return { success: false, error: 'Only single-material records can be updated in place on Kobo.' };
    try {
      const uid = uidFor(tx.txType, config);
      if (!uid) return { success: false, error: 'A Kobo form UID is missing in Settings.' };
      const before = await this.fetchSubmissionById(uid, tx.koboSubmissionId, config, tauriFetch);
      if (before.status === 404) return { success: false, notFound: true, error: `Kobo submission ${tx.koboSubmissionId} is not in this form.` };
      if (before.status === 401 || before.status === 403) return { success: false, error: `Token refused by Kobo (HTTP ${before.status}). Check API token.` };
      if (before.status !== 200 || !before.row) return { success: false, error: `Cannot read Kobo submission ${tx.koboSubmissionId} (HTTP ${before.status}).` };
      const current = parseKoboSubmissionJson(before.row, 'TX');
      if (current.clientTxUuid !== tx.clientTxUuid) {
        return { success: false, error: `Kobo submission ${tx.koboSubmissionId} belongs to a different record. Nothing was sent.` };
      }
      if (!sameContent(tx, current) && instantOf(current.txDateTime) > instantOf(tx.txDateTime)) return { success: true, remote: current };
      if (sameContent(tx, current)) return { success: true };

      const res = await tauriFetch(`${base(config)}/api/v2/assets/${encodeURIComponent(uid)}/data/bulk/`, {
        method: 'PATCH',
        headers: { Authorization: `Token ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { submission_ids: [String(tx.koboSubmissionId)], data: buildUpdateData(tx) } }),
      });
      if (res.status < 200 || res.status >= 300) {
        let detail = ''; try { detail = (await res.text()).slice(0, 200); } catch {}
        return { success: false, error: `Kobo rejected the update (HTTP ${res.status}) ${detail}`.trim() };
      }
      try { const body = await res.json(); if (Number(body?.failures) > 0) return { success: false, error: `Kobo did not update the submission: ${JSON.stringify(body?.results ?? body).slice(0, 200)}` }; } catch { /* body is optional */ }

      // Read it back: the exact quantity must be what Kobo now holds.
      const after = await this.fetchSubmissionById(uid, tx.koboSubmissionId, config, tauriFetch);
      const mismatch = after.row ? this.quantityMismatch(tx, parseKoboSubmissionJson(after.row, 'TX')) : '';
      return { success: true, warning: mismatch || undefined };
    } catch (e: any) {
      // The PATCH is idempotent, so a retry after an unknown outcome is safe.
      return { success: false, outcomeUnknown: true, error: `Update outcome unknown; it is safe to retry. ${e?.message || 'Network exception'}` };
    }
  }

}

export const koboClient = new KoboClient();
