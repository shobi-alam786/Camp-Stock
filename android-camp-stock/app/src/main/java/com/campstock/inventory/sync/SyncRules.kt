package com.campstock.inventory.sync

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.BaselineRules

/**
 * Shared synchronization rules (plain Kotlin, unit-testable). The Windows app implements the SAME rules in
 * src/utils/syncRules.ts - keep the two in step.
 *
 * One record = one Kobo submission:
 *  - no Kobo _id yet  -> CREATE (POST). The record has never been confirmed on Kobo.
 *  - has a Kobo _id   -> UPDATE (PATCH that same submission). The local record keeps the Kobo _id (koboSubmissionId)
 *    and _uuid (koboInstanceId) for its whole life.
 */
object SyncRules {
    enum class Action { CREATE, UPDATE }

    fun actionFor(tx: TransactionEntity): Action = if ((tx.koboSubmissionId ?: 0L) > 0L) Action.UPDATE else Action.CREATE

    private fun scaled(v: String) = DecimalSafe.parse(v).toPlainString()

    /** Same date/time, reference, staff and the same material quantities (numeric, so "585" = "585.0"). */
    fun sameContent(a: TransactionWithLines, b: TransactionWithLines): Boolean {
        val x = a.transaction
        val y = b.transaction
        if (BaselineRules.instant(x.txDateTime) != BaselineRules.instant(y.txDateTime)) return false
        if (x.referenceNumber.trim() != y.referenceNumber.trim() || x.staffId.trim() != y.staffId.trim()) return false
        if (a.lines.size != b.lines.size) return false
        fun key(t: TransactionWithLines) = t.lines.map { "${it.materialCode.trim()}|${scaled(it.quantity)}|${scaled(it.damagedQuantity)}" }.sorted()
        return key(a) == key(b)
    }

    /** The Kobo version replaces the editable content of the local record. Identity and local-only fields stay. */
    fun applyRemote(local: TransactionWithLines, remote: TransactionWithLines, nowIso: String): TransactionWithLines {
        val l = local.transaction
        val r = remote.transaction
        val tx = l.copy(
            txDateTime = r.txDateTime.ifEmpty { l.txDateTime }, staffId = r.staffId.ifEmpty { l.staffId },
            referenceNumber = r.referenceNumber.ifEmpty { l.referenceNumber }, notes = r.notes,
            syncStatus = "SYNCED", koboSubmissionId = r.koboSubmissionId ?: l.koboSubmissionId,
            koboInstanceId = r.koboInstanceId.ifEmpty { l.koboInstanceId }, syncErrorMessage = "", modifiedAt = nowIso
        )
        val lines = remote.lines.mapIndexed { i, line ->
            val old = local.lines.getOrNull(i)
            line.copy(
                lineId = old?.lineId ?: line.lineId, clientTxUuid = l.clientTxUuid,
                materialName = line.materialName.ifEmpty { old?.materialName ?: "" }, unit = line.unit.ifEmpty { old?.unit ?: "" }
            )
        }
        return TransactionWithLines(tx, lines)
    }

    sealed class Decision {
        /** On Kobo, new to this phone. */
        object Add : Decision()
        /** The Kobo version replaces the local content (edit made elsewhere, or newer than a pending local edit). */
        data class Replace(val merged: TransactionWithLines) : Decision()
        /** Local record learns its Kobo _id/_uuid; [markSynced] when nothing is left to send. */
        data class Link(val submissionId: Long?, val instanceId: String, val markSynced: Boolean) : Decision()
        /** A newer local edit stays and will update Kobo at the next sync. */
        object KeepLocal : Decision()
        object Nothing : Decision()
    }

    /**
     * What to do with one Kobo record when it is pulled. Never creates a second local record for the same client_tx_uuid.
     *  - unknown record                        -> Add
     *  - local SYNCED, Kobo differs            -> Replace (this is how another device's edit arrives)
     *  - local pending CREATE, found on Kobo   -> Link: an earlier send really worked, no second POST
     *  - local pending UPDATE, Kobo differs    -> newer date/time wins (a stock-count edit sets a new date/time)
     */
    fun decide(local: TransactionWithLines?, remote: TransactionWithLines, nowIso: String): Decision {
        if (local == null) return Decision.Add
        val l = local.transaction
        val r = remote.transaction
        val same = sameContent(local, remote)
        val pending = l.syncStatus != "SYNCED"
        if (!pending) {
            if (!same) return Decision.Replace(applyRemote(local, remote, nowIso))
            if (l.koboSubmissionId != r.koboSubmissionId || (l.koboInstanceId.isEmpty() && r.koboInstanceId.isNotEmpty())) {
                return Decision.Link(r.koboSubmissionId, r.koboInstanceId.ifEmpty { l.koboInstanceId }, false)
            }
            return Decision.Nothing
        }
        if (actionFor(l) == Action.CREATE) return Decision.Link(r.koboSubmissionId, r.koboInstanceId.ifEmpty { l.koboInstanceId }, same)
        return when {
            same -> Decision.Link(r.koboSubmissionId ?: l.koboSubmissionId, r.koboInstanceId.ifEmpty { l.koboInstanceId }, true)
            BaselineRules.instant(r.txDateTime) > BaselineRules.instant(l.txDateTime) -> Decision.Replace(applyRemote(local, remote, nowIso))
            else -> Decision.KeepLocal
        }
    }
}
