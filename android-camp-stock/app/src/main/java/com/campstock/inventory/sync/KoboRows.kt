package com.campstock.inventory.sync

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import org.json.JSONObject

/** Turns one Kobo REST v2 submission (JSON) into a local record. Pure: no database, no network. */
object KoboRows {
    private val NUMBER = Regex("^-?\\d+(\\.\\d+)?$")

    private fun field(obj: JSONObject, group: String, name: String): String =
        obj.optString("$group/$name").ifEmpty { obj.optString(name) }

    /** Kobo may give decimals as numbers (585.0): keep the value, drop only a useless ".0". */
    fun cleanQty(text: String): String = if (NUMBER.matches(text.trim())) DecimalSafe.format(DecimalSafe.parse(text)) else text

    fun clientUuidOf(row: JSONObject): String {
        val koboId = row.optLong("_id")
        return row.optString("client_tx_uuid").ifEmpty {
            row.optString("meta/instanceID").replace("uuid:", "").ifEmpty { "kobo-$koboId" }
        }
    }

    fun toTransaction(row: JSONObject): TransactionWithLines {
        val koboId = row.optLong("_id")
        val uuid = clientUuidOf(row)
        val group = "material_lines"
        val raw = row.optJSONArray(group)
        val lines = ArrayList<TransactionLineEntity>()
        if (raw != null) {
            for (j in 0 until raw.length()) {
                val lo = raw.getJSONObject(j)
                lines.add(TransactionLineEntity(
                    lineId = "$uuid-line-${j + 1}", clientTxUuid = uuid,
                    materialCode = field(lo, group, "material_code"), materialName = field(lo, group, "material_name"),
                    quantity = cleanQty(field(lo, group, "quantity")), unit = field(lo, group, "unit"),
                    notes = field(lo, group, "line_notes"),
                    damagedQuantity = cleanQty(field(lo, group, "damaged_quantity").ifEmpty { "0" })
                ))
            }
        }
        val instance = row.optString("meta/instanceID").ifEmpty { row.optString("_uuid").let { if (it.isEmpty()) "" else "uuid:$it" } }
        val sub = row.optString("_submission_time")
        val tx = TransactionEntity(
            clientTxUuid = uuid, txType = row.optString("tx_type"),
            txDateTime = row.optString("tx_date_time").ifEmpty { sub },
            sourceLocationId = row.optString("source_location"), destinationLocationId = row.optString("destination_location"),
            staffId = row.optString("staff_id"), referenceNumber = row.optString("ref_no"), notes = row.optString("notes"),
            drrCode = row.optString("drr_code"), block = row.optString("block"), subBlock = row.optString("sub_block"),
            mrfNumber = row.optString("mrf_number"), supplierId = row.optString("supplier_id"),
            supplierName = row.optString("supplier_name"), poNumber = row.optString("po_number"),
            handoverFromName = row.optString("handover_from_name"), handoverFromPhone = row.optString("handover_from_phone"),
            handoverToName = row.optString("handover_to_name"), handoverToPhone = row.optString("handover_to_phone"),
            handoverDate = row.optString("handover_date"), vehicleNumber = row.optString("vehicle_number"),
            receivedBy = row.optString("received_by"), issuedBy = row.optString("issued_by"),
            acknowledgementBy = row.optString("acknowledgement_by"),
            syncStatus = "SYNCED", koboSubmissionId = if (koboId > 0) koboId else null, koboInstanceId = instance,
            createdAt = sub, modifiedAt = sub
        )
        return TransactionWithLines(tx, lines)
    }
}
