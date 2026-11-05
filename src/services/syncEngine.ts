/**
 * Camp Stock Inventory Management System
 * Sends ONE local record to Kobo: creates it first, then replaces its remote submission on edits.
 * The Kobo calls are passed in (KoboOps), so the rules can be tested without a network.
 */

import { InventoryTransaction } from '../types/inventory.ts';
import { applyRemote, sameContent } from '../utils/syncRules.ts';
import type { KoboServerConfig } from './koboClient.ts';

export interface KoboOps {
  submitTransaction(tx: InventoryTransaction, config: KoboServerConfig, ledger?: InventoryTransaction[]):
    Promise<{ success: boolean; submissionId?: number; instanceId?: string; error?: string; outcomeUnknown?: boolean; warning?: string }>;
  updateTransaction(tx: InventoryTransaction, config: KoboServerConfig):
    Promise<{ success: boolean; remote?: InventoryTransaction; submissionId?: number; instanceId?: string; error?: string; outcomeUnknown?: boolean; warning?: string; notFound?: boolean }>;
  findSubmissionByClientUuid(tx: InventoryTransaction, config: KoboServerConfig):
    Promise<{ found: boolean; submissionId?: number; instanceId?: string; remote?: InventoryTransaction; error?: string }>;
}

export type SyncOutcome = {
  kind: 'created' | 'updated' | 'linked' | 'remote_newer' | 'failed' | 'unknown';
  tx: InventoryTransaction;
  error?: string;
  warning?: string;
};

export async function syncTransaction(
  tx: InventoryTransaction, config: KoboServerConfig, kobo: KoboOps, ledger: InventoryTransaction[] = []
): Promise<SyncOutcome> {
  const now = new Date().toISOString();
  const failure = (cur: InventoryTransaction, error: string, unknown: boolean): SyncOutcome => ({
    kind: unknown ? 'unknown' : 'failed', error,
    tx: { ...cur, syncStatus: unknown ? 'OUTCOME_UNKNOWN' : 'FAILED', syncErrorMessage: error, lastSyncAttempt: now },
  });
  let cur = tx;

  // A record without a Kobo _id whose earlier send failed or timed out may already be on Kobo: look first, never post blindly.
  if (!cur.koboSubmissionId && (cur.syncStatus === 'OUTCOME_UNKNOWN' || cur.syncStatus === 'FAILED')) {
    const found = await kobo.findSubmissionByClientUuid(cur, config);
    if (found.error) return failure(cur, found.error, true);
    if (found.found) {
      cur = { ...cur, koboSubmissionId: found.submissionId, koboInstanceId: found.instanceId || cur.koboInstanceId };
      if (found.remote && sameContent(cur, found.remote)) {
        return { kind: 'linked', tx: { ...cur, syncStatus: 'SYNCED', syncErrorMessage: undefined, lastSyncAttempt: now } };
      }
    }
  }

  let note: string | undefined;
  if (cur.koboSubmissionId) {
    const r = await kobo.updateTransaction(cur, config);
    if (!r.success && r.notFound) {
      // The saved _id is not in THIS form (deleted, or first sent to another form). Look the record up by client_tx_uuid;
      // only when it is really absent from this form is it sent once as a new submission here.
      const found = await kobo.findSubmissionByClientUuid(cur, config);
      if (found.error) return failure(cur, found.error, true);
      const oldId = cur.koboSubmissionId;
      if (found.found && !found.submissionId) {
        return failure(cur, 'Kobo found this record by client ID but returned no submission ID. It was not re-sent to avoid a duplicate.', false);
      }
      if (found.found && found.submissionId === oldId) {
        return failure(cur, `Kobo still finds submission ${oldId} by client ID but rejected its update. The record was not re-sent to avoid a duplicate. Check the Kobo form and update permissions.`, false);
      }
      if (found.found && found.submissionId && found.submissionId !== oldId) {
        const again = await kobo.updateTransaction({ ...cur, koboSubmissionId: found.submissionId, koboInstanceId: found.instanceId || cur.koboInstanceId }, config);
        cur = { ...cur, koboSubmissionId: found.submissionId, koboInstanceId: found.instanceId || cur.koboInstanceId };
        if (!again.success) return failure(cur, again.error || 'Update failed.', !!again.outcomeUnknown);
        if (again.remote) return { kind: 'remote_newer', tx: applyRemote(cur, again.remote) };
        return { kind: 'updated', warning: again.warning, tx: { ...cur, syncStatus: 'SYNCED', syncErrorMessage: undefined, lastSyncAttempt: now } };
      }
      note = `Old Kobo submission ${oldId} is not in this form, so the record was sent again as a new submission here.`;
      cur = { ...cur, koboSubmissionId: undefined, koboInstanceId: `uuid:${cur.clientTxUuid}` };
    } else {
      const updatedIdentity = {
        ...cur,
        koboSubmissionId: r.submissionId ?? cur.koboSubmissionId,
        koboInstanceId: r.instanceId || cur.koboInstanceId,
      };
      if (!r.success) return failure(updatedIdentity, r.error || 'Update failed.', !!r.outcomeUnknown);
      if (r.remote) return { kind: 'remote_newer', tx: applyRemote(cur, r.remote) };
      return { kind: 'updated', warning: r.warning, tx: { ...updatedIdentity, syncStatus: 'SYNCED', syncErrorMessage: undefined, lastSyncAttempt: now } };
    }
  }

  const r = await kobo.submitTransaction(cur, config, ledger);
  if (!r.success) return failure(cur, r.error || 'Submission failed.', !!r.outcomeUnknown);
  return {
    kind: 'created', warning: [note, r.warning].filter(Boolean).join(' ') || undefined,
    tx: { ...cur, syncStatus: 'SYNCED', koboSubmissionId: r.submissionId, koboInstanceId: r.instanceId || cur.koboInstanceId, syncErrorMessage: undefined, lastSyncAttempt: now },
  };
}
