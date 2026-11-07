package com.campstock.inventory.model

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.TransactionWithLines

/**
 * Finds drafts that look like a record that already exists (on this phone or pulled from Kobo).
 * Kobo only rejects the *same* record id twice; two people typing the same dispatch create two different
 * records, so this is the only guard against that. It is a warning, never a block.
 */
object DuplicateCheck {
    data class Hit(val draftUuid: String, val message: String)

    private fun lineSig(l: com.campstock.inventory.data.TransactionLineEntity): String =
        listOf(l.materialName.ifBlank { l.materialCode }.trim().lowercase(),
            DecimalSafe.format(DecimalSafe.parse(l.quantity)), DecimalSafe.format(DecimalSafe.parse(l.damagedQuantity)))
            .joinToString("~")

    /** Same kind of record about the same thing: DRR+MRF for dispatch/return, GRN/PO+supplier for receipts, same day+places otherwise. */
    private fun signature(t: TransactionWithLines): String {
        val x = t.transaction
        val who = when (x.txType) {
            "DISPATCH", "RETURN" -> listOf(x.drrCode.trim().lowercase(), x.mrfNumber.trim().lowercase())
            "RECEIPT" -> listOf(x.referenceNumber.trim().lowercase(), x.poNumber.trim().lowercase(), x.supplierName.trim().lowercase())
            else -> listOf(x.txDateTime.take(10), x.sourceLocationId, x.destinationLocationId)
        }
        return (listOf(x.txType) + who + t.lines.map { lineSig(it) }.sorted()).joinToString("|")
    }

    fun find(all: List<TransactionWithLines>, drafts: List<TransactionWithLines>): List<Hit> {
        val hits = ArrayList<Hit>()
        for (d in drafts) {
            if (d.lines.isEmpty()) continue
            val sig = signature(d)
            val twin = all.firstOrNull { it.transaction.clientTxUuid != d.transaction.clientTxUuid && signature(it) == sig }
                ?: continue
            val x = d.transaction
            val what = when (x.txType) {
                "DISPATCH", "RETURN" -> "${x.txType} ${x.drrCode} / MRF ${x.mrfNumber}"
                "RECEIPT" -> "RECEIPT ${x.referenceNumber}"
                else -> x.txType
            }
            hits.add(Hit(x.clientTxUuid, "$what: same materials and quantities already recorded on ${twin.transaction.txDateTime.take(10)}"))
        }
        return hits
    }
}
