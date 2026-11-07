package com.campstock.inventory.model

import java.math.BigDecimal
import java.net.URLEncoder

/**
 * IOM Stock Records (read-only). Pure logic with no Android or org.json types, so it is unit-testable on the JVM:
 * build the Kobo query, flatten submissions into one row per material, drop duplicates by Kobo _id, and filter.
 * Nothing here touches Camp Stock records or balances.
 */
object IomRecords {
    const val DEFAULT_SERVER = "https://kf.kobo.iom.int"
    const val DEFAULT_UID = "aP3n8sFSQ8FJFpbpFduYd4"
    const val STORAGE_CODE = "13"
    const val PAGE_SIZE = 500

    data class Row(
        val koboId: Long,
        val rowKey: String,
        val entryDate: String,
        val entryBy: String,
        val inventoryType: String,
        val inventorySubType: String,
        val mrfNo: String,
        val drrCode: String,
        val warehouse: String,
        val waybillNo: String,
        val category: String,
        val item: String,
        val unit: String,
        val quantity: String,
        val subStorage: String,
        // Extra Kobo fields, filled when the form returns them (Received uses supplier / PO / GRN / PRF).
        val subCategory: String = "",
        val camp: String = "",
        val supplier: String = "",
        val poNumber: String = "",
        val grnNumber: String = "",
        val prfNumber: String = "",
        val project: String = "",
        val code: String = "",
        val castingYard: String = "",
        val description: String = ""
    )

    data class Filters(
        val material: String = "",
        val type: String = "",
        /** One search box: matches the DRR code or the MRF number. */
        val search: String = ""
    )

    data class MergeResult(val rows: List<Row>, val added: Int, val skipped: Int)
    data class Total(val item: String, val unit: String, val total: BigDecimal)

    private val ISO_DAY = Regex("""\d{4}-\d{2}-\d{2}""")
    fun isIsoDay(s: String) = ISO_DAY.matches(s)

    /** Kobo "query" parameter: Camp 13 storage plus an inclusive entry_date range (ISO dates compare correctly as text). */
    fun buildQuery(from: String, to: String): String {
        val range = buildList {
            if (isIsoDay(from)) add("\"\$gte\":\"$from\"")
            if (isIsoDay(to)) add("\"\$lte\":\"$to\"")
        }
        val dateClause = if (range.isEmpty()) "" else ",\"entry_date\":{${range.joinToString(",")}}"
        return "{\"sd_storage\":\"$STORAGE_CODE\"$dateClause}"
    }

    fun buildFirstUrl(server: String, uid: String, from: String, to: String, limit: Int = PAGE_SIZE): String {
        val base = server.trim().trimEnd('/')
        val q = URLEncoder.encode(buildQuery(from, to), "UTF-8")
        return "$base/api/v2/assets/${URLEncoder.encode(uid.trim(), "UTF-8")}/data/?format=json&limit=$limit&query=$q"
    }

    /** Accepts a pasted Kobo data URL (https://server/api/v2/assets/UID/data/...) and returns (server, uid). */
    fun parseDataUrl(text: String): Pair<String, String>? {
        val m = Regex("""^(https?://[^/\s]+)/api/v2/assets/([A-Za-z0-9]+)(?:/|\?|$)""", RegexOption.IGNORE_CASE).find(text.trim()) ?: return null
        return m.groupValues[1].replaceFirst("http://", "https://") to m.groupValues[2]
    }

    /** The server sometimes hands back http:// in `next`; keep everything on https. */
    fun safeNextUrl(next: String?): String? {
        val s = next?.trim().orEmpty()
        if (s.isEmpty() || s == "null") return null
        return if (s.startsWith("http://", ignoreCase = true)) "https://" + s.substring(7) else s
    }

    private fun str(v: Any?): String = (v?.toString() ?: "").let { if (it == "null") "" else it.trim() }

    /** Reads a field from the line first, then the submission; a group prefix such as `grp/camp` is accepted too. */
    private fun pick(name: String, vararg sources: Map<*, *>?): String {
        for (src in sources) {
            if (src == null) continue
            for (k in listOf(name, "rpt_items/$name")) if (src[k] != null) return str(src[k])
            val key = src.keys.firstOrNull { it is String && it.endsWith("/$name") }
            if (key != null) return str(src[key])
        }
        return ""
    }

    /** One submission -> one row per material line. A submission with no lines still yields one row so it is not lost. */
    fun flatten(sub: Map<String, Any?>): List<Row> {
        val id = (sub["_id"] as? Number)?.toLong() ?: str(sub["_id"]).toLongOrNull() ?: return emptyList()
        val date = str(sub["entry_date"]).ifEmpty { str(sub["today"]) }
        val items = (sub["rpt_items"] as? List<*>)?.filterIsInstance<Map<*, *>>().orEmpty()
        fun row(i: Int, it: Map<*, *>?) = Row(
            koboId = id, rowKey = "$id#$i", entryDate = date,
            entryBy = str(sub["entry_by"]), inventoryType = str(sub["inventory_type"]), inventorySubType = str(sub["inventory_sub_type"]),
            mrfNo = str(sub["mrf_no"]), drrCode = str(sub["drr_code"]), warehouse = str(sub["warehouse"]), waybillNo = str(sub["waybill_no"]),
            category = str(it?.get("rpt_items/category")), item = str(it?.get("rpt_items/items")), unit = str(it?.get("rpt_items/unit")),
            quantity = str(it?.get("rpt_items/quantity")), subStorage = str(it?.get("rpt_items/sub_storage")),
            subCategory = str(it?.get("rpt_items/sub_category")),
            camp = pick("camp", it, sub), supplier = pick("supplier", it, sub), poNumber = pick("po_number", it, sub),
            grnNumber = pick("grn_number", it, sub), prfNumber = pick("prf_number", it, sub), project = pick("project", it, sub),
            code = pick("code", it, sub), castingYard = pick("casting_yard", it, sub), description = pick("description", it, sub)
        )
        return if (items.isEmpty()) listOf(row(0, null)) else items.mapIndexed { i, it -> row(i, it) }
    }

    /** Merge new submissions into the existing rows. A Kobo _id already present is skipped, so paging twice never duplicates. */
    fun merge(existing: List<Row>, incoming: List<Map<String, Any?>>): MergeResult {
        val seen = existing.map { it.koboId }.toHashSet()
        val out = existing.toMutableList()
        var added = 0
        var skipped = 0
        for (sub in incoming) {
            val id = (sub["_id"] as? Number)?.toLong() ?: str(sub["_id"]).toLongOrNull() ?: continue
            // Camp 13 only: a submission that names another storage is never shown, whatever the server returned.
            if (sub.containsKey("sd_storage") && str(sub["sd_storage"]) != STORAGE_CODE) continue
            if (!seen.add(id)) { skipped++; continue }
            added++
            out.addAll(flatten(sub))
        }
        return MergeResult(out, added, skipped)
    }

    fun inRange(row: Row, from: String, to: String): Boolean {
        if (isIsoDay(from) && row.entryDate < from) return false
        if (isIsoDay(to) && row.entryDate > to) return false
        return true
    }

    private fun has(hay: String, needle: String) = needle.isBlank() || hay.contains(needle.trim(), ignoreCase = true)

    fun filter(rows: List<Row>, from: String, to: String, f: Filters): List<Row> = rows.filter { r ->
        inRange(r, from, to) &&
            has(r.item, f.material) &&
            (f.type.isEmpty() || r.inventoryType == f.type) &&
            (has(r.mrfNo, f.search) || has(r.drrCode, f.search))
    }

    fun distinct(rows: List<Row>, pick: (Row) -> String): List<String> =
        rows.map(pick).filter { it.isNotEmpty() }.distinct().sortedBy { it.lowercase() }

    /** Display the quantity exactly as Kobo supplied it; do not normalize or pad decimal places. */
    fun formatQty(text: String): String = text

    /** Totals per material and unit, using exact decimal arithmetic. The total keeps its trailing zeros (0.170 + 0.250 = 0.420). */
    fun totals(rows: List<Row>): List<Total> {
        val map = LinkedHashMap<Pair<String, String>, BigDecimal>()
        for (r in rows) {
            val q = r.quantity.trim().replace(",", "").toBigDecimalOrNull() ?: continue
            map.merge(r.item to r.unit, q) { a, b -> a + b }
        }
        return map.map { (k, v) -> Total(k.first, k.second, v) }
            .sortedBy { it.item.lowercase() }
    }

    fun toCsv(rows: List<Row>): String {
        fun esc(v: String) = if (v.any { it == ',' || it == '"' || it == '\n' }) "\"" + v.replace("\"", "\"\"") + "\"" else v
        val head = "Entry date,Type,Sub type,MRF,DRR,Warehouse,Waybill,Category,Item,Unit,Quantity,Sub storage,Kobo ID"
        val body = rows.map { r ->
            listOf(r.entryDate, r.inventoryType, r.inventorySubType, r.mrfNo, r.drrCode, r.warehouse, r.waybillNo,
                r.category, r.item, r.unit, formatQty(r.quantity), r.subStorage, r.koboId.toString()).joinToString(",") { esc(it) }
        }
        return (listOf(head) + body).joinToString("\r\n")
    }
}
