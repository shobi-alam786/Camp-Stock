package com.campstock.inventory.sync

import com.campstock.inventory.data.TransactionWithLines

object OpenRosaXml {
    fun escapeXml(s: String?): String {
        if (s == null) return ""
        return s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;")
    }

    /**
     * Builds OpenRosa 1.0 XML with Repeat Group tags for material lines.
     */
    fun build(item: TransactionWithLines, formId: String, formUuid: String = ""): String {
        val tx = item.transaction
        val instanceId = if (tx.koboInstanceId.isNotEmpty()) tx.koboInstanceId else "uuid:${tx.clientTxUuid}"

        val header = buildString {
            append("<client_tx_uuid>${escapeXml(tx.clientTxUuid)}</client_tx_uuid>")
            append("<tx_type>${escapeXml(tx.txType)}</tx_type>")
            append("<tx_date_time>${escapeXml(tx.txDateTime)}</tx_date_time>")
            append("<source_location>${escapeXml(tx.sourceLocationId)}</source_location>")
            append("<destination_location>${escapeXml(tx.destinationLocationId)}</destination_location>")
            append("<staff_id>${escapeXml(tx.staffId)}</staff_id>")
            append("<ref_no>${escapeXml(tx.referenceNumber)}</ref_no>")
            append("<notes>${escapeXml(tx.notes)}</notes>")
            append("<vehicle_number>${escapeXml(tx.vehicleNumber)}</vehicle_number>")
            append("<received_by>${escapeXml(tx.receivedBy)}</received_by>")
            append("<issued_by>${escapeXml(tx.issuedBy)}</issued_by>")
            append("<acknowledgement_by>${escapeXml(tx.acknowledgementBy)}</acknowledgement_by>")
            append("<drr_code>${escapeXml(tx.drrCode)}</drr_code>")
            append("<block>${escapeXml(tx.block)}</block>")
            append("<sub_block>${escapeXml(tx.subBlock)}</sub_block>")
            append("<mrf_number>${escapeXml(tx.mrfNumber)}</mrf_number>")
            append("<supplier_id>${escapeXml(tx.supplierId)}</supplier_id>")
            append("<supplier_name>${escapeXml(tx.supplierName)}</supplier_name>")
            append("<po_number>${escapeXml(tx.poNumber)}</po_number>")
            append("<handover_from_name>${escapeXml(tx.handoverFromName)}</handover_from_name>")
            append("<handover_from_phone>${escapeXml(tx.handoverFromPhone)}</handover_from_phone>")
            append("<handover_to_name>${escapeXml(tx.handoverToName)}</handover_to_name>")
            append("<handover_to_phone>${escapeXml(tx.handoverToPhone)}</handover_to_phone>")
            append("<handover_date>${escapeXml(tx.handoverDate)}</handover_date>")
        }

        val linesXml = buildString {
            for (line in item.lines) {
                append("<material_lines>")
                append("<material_code>${escapeXml(line.materialCode)}</material_code>")
                append("<material_name>${escapeXml(line.materialName)}</material_name>")
                append("<quantity>${escapeXml(line.quantity)}</quantity>")
                append("<damaged_quantity>${escapeXml(line.damagedQuantity)}</damaged_quantity>")
                append("<unit>${escapeXml(line.unit)}</unit>")
                append("<line_notes>${escapeXml(line.notes)}</line_notes>")
                append("</material_lines>")
            }
        }

        val formhub = if (formUuid.isNotBlank()) "<formhub><uuid>${escapeXml(formUuid)}</uuid></formhub>" else ""
        val meta = "<meta><instanceID>$instanceId</instanceID></meta>"

        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><$formId id=\"$formId\">$formhub$header$linesXml$meta</$formId>"
    }

    private fun tag(name: String, value: String?) = "<$name>${escapeXml(value)}</$name>"

    private fun wrap(formId: String, formUuid: String, instanceId: String, body: String): String {
        val formhub = if (formUuid.isNotBlank()) "<formhub><uuid>${escapeXml(formUuid)}</uuid></formhub>" else ""
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><$formId id=\"$formId\">$formhub$body<meta><instanceID>${escapeXml(instanceId)}</instanceID></meta></$formId>"
    }

    /**
     * The three Kobo forms and the record types each one holds:
     *   RECORDS  - "Camp Stock - Records": received, dispatched, returned
     *   HANDOVER - "Camp Stock - Staff Handover & Supplies": staff handovers
     *   STOCK    - "Camp Stock - Stock Balance": starting balance (baseline / opening) and stock adjustments
     */
    enum class FormGroup { RECORDS, HANDOVER, STOCK }

    fun formGroupFor(txType: String): FormGroup = when (txType) {
        "STAFF_HANDOVER" -> FormGroup.HANDOVER
        "STOCK_BASELINE", "OPENING_STOCK", "ADJUSTMENT_POS", "ADJUSTMENT_NEG" -> FormGroup.STOCK
        else -> FormGroup.RECORDS
    }

    /** Builds the submission for whichever of the three forms the transaction belongs to. Only that form's fields are sent. */
    fun buildForForm(item: TransactionWithLines, formId: String, formUuid: String): String {
        val tx = item.transaction
        val group = formGroupFor(tx.txType)
        val instanceId = if (tx.koboInstanceId.isNotEmpty()) tx.koboInstanceId else "uuid:${tx.clientTxUuid}"
        val header = StringBuilder()
        header.append(tag("client_tx_uuid", tx.clientTxUuid)).append(tag("tx_type", tx.txType)).append(tag("tx_date_time", tx.txDateTime))
            .append(tag("source_location", tx.sourceLocationId)).append(tag("destination_location", tx.destinationLocationId))
            .append(tag("staff_id", tx.staffId)).append(tag("ref_no", tx.referenceNumber))
        when (group) {
            FormGroup.RECORDS -> header
                .append(tag("notes", tx.notes)).append(tag("vehicle_number", tx.vehicleNumber))
                .append(tag("received_by", tx.receivedBy)).append(tag("issued_by", tx.issuedBy)).append(tag("acknowledgement_by", tx.acknowledgementBy))
                .append(tag("drr_code", tx.drrCode)).append(tag("block", tx.block)).append(tag("sub_block", tx.subBlock)).append(tag("mrf_number", tx.mrfNumber))
                .append(tag("supplier_id", tx.supplierId)).append(tag("supplier_name", tx.supplierName)).append(tag("po_number", tx.poNumber))
            FormGroup.HANDOVER -> header
                .append(tag("notes", tx.notes))
                .append(tag("handover_from_name", tx.handoverFromName)).append(tag("handover_from_phone", tx.handoverFromPhone))
                .append(tag("handover_to_name", tx.handoverToName)).append(tag("handover_to_phone", tx.handoverToPhone))
                .append(tag("handover_date", tx.handoverDate))
            FormGroup.STOCK -> header.append(tag("notes", tx.notes))
        }
        val lines = item.lines.joinToString("") { l ->
            "<material_lines>" + tag("material_code", l.materialCode) + tag("material_name", l.materialName) + tag("quantity", l.quantity) +
                (if (group == FormGroup.RECORDS) tag("damaged_quantity", l.damagedQuantity.ifBlank { "0" }) else "") +
                tag("unit", l.unit) + tag("line_notes", l.notes) + "</material_lines>"
        }
        return wrap(formId, formUuid, instanceId, header.toString() + lines)
    }

    /**
     * Fields sent when an EXISTING single-material Kobo submission is updated (bulk PATCH by _id).
     * Identity fields (client_tx_uuid, tx_type, material_code, locations) are never changed.
     */
    fun updateData(item: TransactionWithLines): Map<String, String> {
        val tx = item.transaction
        val l = item.lines.first()
        val data = linkedMapOf(
            "tx_date_time" to tx.txDateTime, "staff_id" to tx.staffId, "ref_no" to tx.referenceNumber, "notes" to tx.notes,
            "material_name" to l.materialName, "quantity" to l.quantity, "unit" to l.unit, "line_notes" to l.notes
        )
        if (formGroupFor(tx.txType) == FormGroup.RECORDS) data["damaged_quantity"] = l.damagedQuantity.ifBlank { "0" }
        return data
    }

    /** "Camp Stock - Material Catalogue" form: one record per create/change; the newest record per code wins. */
    fun buildCatalogueRecord(
        formId: String, formUuid: String, recordUuid: String, code: String, name: String, unit: String,
        unitConfirmed: Boolean, active: Boolean, notes: String, updatedBy: String,
        locationId: String = "LOC-CENTRAL", currentStock: String = "0"
    ): String = wrap(
        formId, formUuid, "uuid:$recordUuid",
        tag("client_tx_uuid", recordUuid) + tag("material_code", code) + tag("material_name", name) + tag("unit", unit) +
            tag("unit_confirmed", if (unitConfirmed) "yes" else "no") + tag("status", if (active) "active" else "inactive") +
            tag("notes", notes) + tag("updated_by", updatedBy) + tag("location_id", locationId) + tag("current_stock", currentStock)
    )
}
