package com.campstock.inventory.model

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.SupplierEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.IomExcel.Kind
import java.math.BigDecimal
import java.time.LocalDate

/**
 * Excel exports for the Camp Stock app itself (one file each, no extra libraries):
 *   1. Records             -> sheets: All records | Received | Dispatched | Returned
 *   2. Handover & Supplies -> sheets: Staff Handover | Supplies
 *   3. Stock balances      -> sheets: Material list | Starting Balance | Current Balance | Stock Adjustments | Daily Closing Balance
 *      (first three laid out like Stock_Records.xlsx)
 * Mirrors src/utils/appExcel.ts on the Windows app.
 */
object AppExcel {
    const val MAX_STOCK_DAYS = 366

    private class Col<T>(val header: String, val kind: Kind, val width: Int = 14, val get: (T) -> String)

    /** Columns that are empty in every row are left out unless [keepAll] is set. */
    private fun <T> makeSheet(name: String, cols: List<Col<T>>, rows: List<T>, keepAll: Boolean = false): XlsxWriter.Sheet {
        val picked = if (keepAll) cols else cols.filter { c -> rows.any { r -> c.get(r).isNotBlank() } }
        val use = if (picked.isEmpty()) cols.take(3) else picked
        return XlsxWriter.Sheet(
            name,
            use.map { it.header },
            rows.map { r -> use.map { c -> IomExcel.toCell(c.kind, c.get(r)) } },
            use.map { it.width }
        )
    }

    private fun day(iso: String): String = DailyReport.localDay(iso)?.toString() ?: iso.take(10)
    private fun joinNotes(vararg v: String): String = v.map { it.trim() }.filter { it.isNotEmpty() }.joinToString(" | ")

    // ---------- 1. Records ----------

    private class RecRow(
        val date: String, val type: String, val ref: String, val from: String, val to: String, val block: String, val subBlock: String,
        val mrf: String, val drr: String, val supplier: String, val po: String, val vehicle: String, val item: String, val unit: String,
        val qty: String, val damaged: String, val staff: String, val receivedBy: String, val issuedBy: String, val ackBy: String,
        val notes: String, val code: String, val sync: String, val kobo: String
    )

    private val TYPE_LABEL = mapOf("RECEIPT" to "Received", "DISPATCH" to "Dispatched", "RETURN" to "Returned")

    private fun recordRows(transactions: List<TransactionWithLines>, names: Map<String, String>): List<RecRow> {
        val out = ArrayList<RecRow>()
        for (item in transactions) {
            val t = item.transaction
            val type = TYPE_LABEL[t.txType] ?: continue
            for (l in item.lines) {
                out.add(
                    RecRow(
                        day(t.txDateTime), type, t.referenceNumber, names[t.sourceLocationId] ?: t.sourceLocationId,
                        names[t.destinationLocationId] ?: t.destinationLocationId, t.block, t.subBlock, t.mrfNumber, t.drrCode,
                        t.supplierName, t.poNumber, t.vehicleNumber, l.materialName.ifEmpty { l.materialCode }, l.unit, l.quantity,
                        if (t.txType == "RETURN" && DecimalSafe.parse(l.damagedQuantity).signum() != 0) l.damagedQuantity else "",
                        t.staffId, t.receivedBy, t.issuedBy, t.acknowledgementBy, joinNotes(t.notes, l.notes), l.materialCode,
                        t.syncStatus, t.koboSubmissionId?.toString() ?: ""
                    )
                )
            }
        }
        return out.sortedWith(compareBy({ it.date }, { it.ref }))
    }

    private val REC_COLS: List<Col<RecRow>> = listOf(
        Col<RecRow>("Date", Kind.DATE, 12) { it.date },
        Col<RecRow>("Type", Kind.TEXT, 12) { it.type },
        Col<RecRow>("Reference", Kind.ID, 18) { it.ref },
        Col<RecRow>("From", Kind.TEXT, 22) { it.from },
        Col<RecRow>("To", Kind.TEXT, 22) { it.to },
        Col<RecRow>("Block", Kind.TEXT, 8) { it.block },
        Col<RecRow>("Sub block", Kind.TEXT, 10) { it.subBlock },
        Col<RecRow>("MRF", Kind.ID) { it.mrf },
        Col<RecRow>("DRR", Kind.TEXT, 24) { it.drr },
        Col<RecRow>("Supplier", Kind.TEXT, 26) { it.supplier },
        Col<RecRow>("PO number", Kind.ID) { it.po },
        Col<RecRow>("Vehicle", Kind.TEXT) { it.vehicle },
        Col<RecRow>("Item", Kind.TEXT, 42) { it.item },
        Col<RecRow>("Unit", Kind.TEXT, 10) { it.unit },
        Col<RecRow>("Quantity", Kind.QTY, 12) { it.qty },
        Col<RecRow>("Damaged qty", Kind.QTY, 12) { it.damaged },
        Col<RecRow>("Staff", Kind.TEXT, 22) { it.staff },
        Col<RecRow>("Received by", Kind.TEXT, 20) { it.receivedBy },
        Col<RecRow>("Issued by", Kind.TEXT, 20) { it.issuedBy },
        Col<RecRow>("Acknowledged by", Kind.TEXT, 20) { it.ackBy },
        Col<RecRow>("Notes", Kind.TEXT, 30) { it.notes },
        Col<RecRow>("Material code", Kind.TEXT, 14) { it.code },
        Col<RecRow>("Sync status", Kind.TEXT, 12) { it.sync },
        Col<RecRow>("Kobo ID", Kind.ID) { it.kobo }
    )

    fun recordsSheets(transactions: List<TransactionWithLines>, names: Map<String, String>): List<XlsxWriter.Sheet> {
        val rows = recordRows(transactions, names)
        return listOf(
            makeSheet("All records", REC_COLS, rows),
            makeSheet("Received", REC_COLS, rows.filter { it.type == "Received" }),
            makeSheet("Dispatched", REC_COLS, rows.filter { it.type == "Dispatched" }),
            makeSheet("Returned", REC_COLS, rows.filter { it.type == "Returned" })
        )
    }

    fun recordsWorkbook(transactions: List<TransactionWithLines>, names: Map<String, String>): ByteArray =
        XlsxWriter.build(recordsSheets(transactions, names))

    // ---------- 2. Staff Handover & Supplies ----------

    private class HandRow(
        val date: String, val ref: String, val location: String, val fromName: String, val fromPhone: String,
        val toName: String, val toPhone: String, val item: String, val unit: String, val qty: String, val notes: String
    )

    private fun handoverRows(transactions: List<TransactionWithLines>, names: Map<String, String>): List<HandRow> {
        val out = ArrayList<HandRow>()
        for (item in transactions) {
            val t = item.transaction
            if (t.txType != "STAFF_HANDOVER") continue
            val locId = t.sourceLocationId.ifEmpty { t.destinationLocationId }
            val date = t.handoverDate.ifEmpty { day(t.txDateTime) }
            val loc = names[locId] ?: locId
            if (item.lines.isEmpty()) {
                out.add(HandRow(date, t.referenceNumber, loc, t.handoverFromName, t.handoverFromPhone, t.handoverToName, t.handoverToPhone, "", "", "", t.notes))
            }
            for (l in item.lines) {
                out.add(HandRow(date, t.referenceNumber, loc, t.handoverFromName, t.handoverFromPhone, t.handoverToName, t.handoverToPhone,
                    l.materialName.ifEmpty { l.materialCode }, l.unit, l.quantity, t.notes))
            }
        }
        return out.sortedWith(compareBy({ it.date }, { it.ref }))
    }

    private val HAND_COLS: List<Col<HandRow>> = listOf(
        Col<HandRow>("Date", Kind.DATE, 12) { it.date },
        Col<HandRow>("Reference", Kind.TEXT, 18) { it.ref },
        Col<HandRow>("Location", Kind.TEXT, 22) { it.location },
        Col<HandRow>("Handed over by", Kind.TEXT, 24) { it.fromName },
        Col<HandRow>("Phone (from)", Kind.TEXT, 16) { it.fromPhone },
        Col<HandRow>("Taken over by", Kind.TEXT, 24) { it.toName },
        Col<HandRow>("Phone (to)", Kind.TEXT, 16) { it.toPhone },
        Col<HandRow>("Item", Kind.TEXT, 42) { it.item },
        Col<HandRow>("Unit", Kind.TEXT, 10) { it.unit },
        Col<HandRow>("Balance handed over", Kind.QTY, 18) { it.qty },
        Col<HandRow>("Notes", Kind.TEXT, 30) { it.notes }
    )

    private class SupRow(
        val supplier: String, val phone: String, val contact: String, val status: String, val supNotes: String,
        val date: String, val po: String, val ref: String, val item: String, val unit: String, val qty: String, val receivedAt: String
    )

    /** Supplier list plus every delivery. A supplier with no delivery still gets one row; deliveries from an unlisted supplier keep their name. */
    private fun supplyRows(suppliers: List<SupplierEntity>, transactions: List<TransactionWithLines>, names: Map<String, String>): List<SupRow> {
        val out = ArrayList<SupRow>()
        val deliveries = transactions.filter { it.transaction.txType == "RECEIPT" }
        fun supplierOf(t: com.campstock.inventory.data.TransactionEntity): SupplierEntity? = suppliers.firstOrNull { s ->
            (t.supplierId.isNotEmpty() && s.supplierId == t.supplierId) ||
                (t.supplierId.isEmpty() && t.supplierName.isNotBlank() && s.name.trim().equals(t.supplierName.trim(), ignoreCase = true))
        }
        fun deliveryRows(item: TransactionWithLines, s: SupplierEntity?): List<SupRow> {
            val t = item.transaction
            val name = s?.name ?: t.supplierName.ifEmpty { "(no supplier)" }
            val phone = s?.phone ?: ""
            val contact = s?.contactPerson ?: ""
            val status = if (s == null) "" else if (s.isActive) "Active" else "Inactive"
            val sNotes = s?.notes ?: ""
            val date = day(t.txDateTime)
            val at = names[t.destinationLocationId] ?: t.destinationLocationId
            if (item.lines.isEmpty()) return listOf(SupRow(name, phone, contact, status, sNotes, date, t.poNumber, t.referenceNumber, "", "", "", at))
            return item.lines.map { l ->
                SupRow(name, phone, contact, status, sNotes, date, t.poNumber, t.referenceNumber, l.materialName.ifEmpty { l.materialCode }, l.unit, l.quantity, at)
            }
        }
        for (s in suppliers) {
            val mine = deliveries.filter { supplierOf(it.transaction)?.supplierId == s.supplierId }
            if (mine.isEmpty()) {
                out.add(SupRow(s.name, s.phone, s.contactPerson, if (s.isActive) "Active" else "Inactive", s.notes, "", "", "", "", "", "", ""))
            } else {
                for (d in mine) out.addAll(deliveryRows(d, s))
            }
        }
        for (d in deliveries) if (supplierOf(d.transaction) == null) out.addAll(deliveryRows(d, null))
        return out.sortedWith(compareBy({ it.supplier.lowercase() }, { it.date }, { it.ref }))
    }

    private val SUP_COLS: List<Col<SupRow>> = listOf(
        Col<SupRow>("Supplier", Kind.TEXT, 28) { it.supplier },
        Col<SupRow>("Phone", Kind.TEXT, 16) { it.phone },
        Col<SupRow>("Contact person", Kind.TEXT, 22) { it.contact },
        Col<SupRow>("Status", Kind.TEXT, 10) { it.status },
        Col<SupRow>("Supplier notes", Kind.TEXT, 24) { it.supNotes },
        Col<SupRow>("Delivery date", Kind.DATE, 13) { it.date },
        Col<SupRow>("PO number", Kind.ID) { it.po },
        Col<SupRow>("GRN / Reference", Kind.ID, 18) { it.ref },
        Col<SupRow>("Item", Kind.TEXT, 42) { it.item },
        Col<SupRow>("Unit", Kind.TEXT, 10) { it.unit },
        Col<SupRow>("Quantity", Kind.QTY, 12) { it.qty },
        Col<SupRow>("Received at", Kind.TEXT, 22) { it.receivedAt }
    )

    fun handoverSuppliersSheets(transactions: List<TransactionWithLines>, suppliers: List<SupplierEntity>, names: Map<String, String>): List<XlsxWriter.Sheet> = listOf(
        makeSheet("Staff Handover", HAND_COLS, handoverRows(transactions, names)),
        makeSheet("Supplies", SUP_COLS, supplyRows(suppliers, transactions, names))
    )

    fun handoverSuppliersWorkbook(transactions: List<TransactionWithLines>, suppliers: List<SupplierEntity>, names: Map<String, String>): ByteArray =
        XlsxWriter.build(handoverSuppliersSheets(transactions, suppliers, names))

    // ---------- 3. Stock balances ----------

    fun daysBetween(from: LocalDate, to: LocalDate): List<LocalDate> {
        val out = ArrayList<LocalDate>()
        var d = from
        while (!d.isAfter(to) && out.size < MAX_STOCK_DAYS) { out.add(d); d = d.plusDays(1) }
        return out
    }

    class StockLine(val code: String, val name: String, val unit: String, val start: BigDecimal, val closes: List<BigDecimal>)

    private class Ev(val day: LocalDate, val time: String, val kind: Int, val q: BigDecimal, val snap: Boolean = false) // kind: 0 legacy opening, 1 baseline, 2 movement

    /**
     * Balance of every material at one location at the END of each day, same rule as the Current Stock screen:
     * newest stock baseline (else legacy opening) + all receipts, returns and adjustments, minus dispatches.
     * start = balance at the end of the day before [from].
     */
    fun stockSeries(
        materials: List<MaterialEntity>, transactions: List<TransactionWithLines>, locationId: String, from: LocalDate, to: LocalDate,
        includeAll: Boolean = false
    ): Pair<List<LocalDate>, List<StockLine>> {
        val days = daysBetween(from, to)
        val events = HashMap<String, MutableList<Ev>>()
        fun push(code: String, e: Ev) { events.getOrPut(code) { ArrayList() }.add(e) }
        for (item in transactions) {
            val t = item.transaction
            val d = DailyReport.localDay(t.txDateTime) ?: continue
            for (l in item.lines) {
                val q = DecimalSafe.parse(l.quantity)
                when (t.txType) {
                    "STOCK_BASELINE" -> if (t.destinationLocationId == locationId) push(l.materialCode, Ev(d, t.txDateTime, 1, q, BaselineRules.isSnapshot(t.txType, t.referenceNumber)))
                    "OPENING_STOCK" -> if (t.destinationLocationId == locationId) push(l.materialCode, Ev(d, t.txDateTime, 0, q))
                    else -> {
                        val sign = DailyReport.sign(t, locationId)
                        if (sign == 0) continue
                        val net = if (t.txType == "RETURN") q.subtract(DecimalSafe.parse(l.damagedQuantity)) else q
                        push(l.materialCode, Ev(d, t.txDateTime, 2, if (sign > 0) net else net.negate()))
                    }
                }
            }
        }
        fun balanceAt(evs: List<Ev>, day: LocalDate): BigDecimal {
            var legacy = BigDecimal.ZERO
            var move = BigDecimal.ZERO
            var base: Ev? = null
            for (e in evs) {
                if (e.day.isAfter(day)) continue
                when (e.kind) {
                    0 -> legacy = legacy.add(e.q)
                    2 -> move = move.add(e.q)
                    else -> { val b = base; if (b == null || BaselineRules.instant(e.time) >= BaselineRules.instant(b.time)) base = e }
                }
            }
            val b = base
            if (b != null && b.snap) {
                // snapshot baseline: exact quantity entered + only the movements dated after it
                val at = BaselineRules.instant(b.time)
                return evs.filter { it.kind == 2 && !it.day.isAfter(day) && BaselineRules.instant(it.time) > at }
                    .fold(b.q) { acc, e -> acc.add(e.q) }
            }
            return (if (b != null) b.q else legacy).add(move)
        }
        val dayBefore = from.minusDays(1)
        val lines = ArrayList<StockLine>()
        for (m in materials) {
            val evs = events[m.code] ?: emptyList<Ev>()
            val start = balanceAt(evs, dayBefore)
            val closes = days.map { balanceAt(evs, it) }
            val moved = evs.any { !it.day.isBefore(from) && !it.day.isAfter(to) }
            if (includeAll || start.signum() != 0 || moved || closes.any { it.signum() != 0 }) lines.add(StockLine(m.code, m.name, m.unit, start, closes))
        }
        return days to lines
    }

    private class DayRow(val day: String, val l: StockLine, val close: BigDecimal)

    private class Info(val no: String, val category: String, val sub: String, val sql: String, val rank: Int)

    /** Item-list details for a material: list number (else the app code), category, sub-category. */
    private fun info(code: String, name: String): Info {
        val i = MaterialInfoTable.of(name)
        return if (i != null) Info(i.no.toString(), i.category, i.subCategory, i.subCategorySql, i.no) else Info(code, "", "", "", Int.MAX_VALUE)
    }

    class AdjRow(val date: String, val ref: String, val code: String, val name: String, val unit: String, val dir: String, val qty: String, val staff: String, val notes: String)

    /** Stock adjustments (added / removed) at one location inside the date range. */
    fun adjustmentRows(transactions: List<TransactionWithLines>, locationId: String, from: LocalDate, to: LocalDate): List<AdjRow> {
        val out = ArrayList<AdjRow>()
        for (item in transactions) {
            val t = item.transaction
            if (t.txType != "ADJUSTMENT_POS" && t.txType != "ADJUSTMENT_NEG") continue
            if (t.sourceLocationId != locationId && t.destinationLocationId != locationId) continue
            val d = DailyReport.localDay(t.txDateTime) ?: continue
            if (d.isBefore(from) || d.isAfter(to)) continue
            for (l in item.lines) {
                val q = DecimalSafe.format(DecimalSafe.parse(l.quantity))
                out.add(
                    AdjRow(
                        d.toString(), t.referenceNumber, l.materialCode, l.materialName, l.unit,
                        if (t.txType == "ADJUSTMENT_POS") "Added" else "Removed",
                        if (t.txType == "ADJUSTMENT_NEG") "-$q" else q,
                        t.staffId, joinNotes(t.notes, l.notes)
                    )
                )
            }
        }
        return out.sortedWith(compareBy<AdjRow> { it.date }.thenBy { it.ref })
    }

    fun stockSheets(
        materials: List<MaterialEntity>, transactions: List<TransactionWithLines>, locationId: String, from: LocalDate, to: LocalDate
    ): List<XlsxWriter.Sheet> {
        val (days, used) = stockSeries(materials, transactions, locationId, from, to)
        val every = stockSeries(materials, transactions, locationId, from, to, includeAll = true).second
        fun f(v: BigDecimal) = DecimalSafe.format(v)
        // every material, in item-list order (materials without a list number go last, by name)
        val all = every.sortedWith(compareBy<StockLine> { info(it.code, it.name).rank }.thenBy { it.name })
        fun closeOf(l: StockLine) = l.closes.lastOrNull() ?: l.start
        fun inf(l: StockLine) = info(l.code, l.name)

        val list = makeSheet(
            "Material list",
            listOf(
                Col<StockLine>("code", Kind.ID, 8) { inf(it).no },
                Col<StockLine>("category", Kind.TEXT, 16) { inf(it).category },
                Col<StockLine>("sub_category", Kind.TEXT, 24) { inf(it).sub },
                Col<StockLine>("sub_category_sql", Kind.TEXT, 22) { inf(it).sql },
                Col<StockLine>("items_smsd", Kind.TEXT, 42) { it.name },
                Col<StockLine>("unit", Kind.TEXT, 10) { it.unit }
            ),
            all, keepAll = true
        )
        fun head(): List<Col<StockLine>> = listOf(
            Col<StockLine>("code", Kind.ID, 8) { inf(it).no },
            Col<StockLine>("category", Kind.TEXT, 16) { inf(it).category },
            Col<StockLine>("sub_category", Kind.TEXT, 24) { inf(it).sub },
            Col<StockLine>("items", Kind.TEXT, 42) { it.name },
            Col<StockLine>("unit", Kind.TEXT, 10) { it.unit }
        )
        val starting = makeSheet(
            "Starting Balance",
            head() + listOf(
                Col<StockLine>("Starting Balance", Kind.QTY, 16) { f(it.start) },
                Col<StockLine>("Closing Balance", Kind.QTY, 16) { f(closeOf(it)) }
            ),
            all, keepAll = true
        )
        val current = makeSheet(
            "Current Balance",
            head() + listOf(Col<StockLine>("Balance", Kind.QTY, 14) { f(closeOf(it)) }),
            all, keepAll = true
        )
        val adjustments = makeSheet(
            "Stock Adjustments",
            listOf(
                Col<AdjRow>("Date", Kind.DATE, 12) { it.date },
                Col<AdjRow>("Reference", Kind.ID, 16) { it.ref },
                Col<AdjRow>("code", Kind.ID, 8) { info(it.code, it.name).no },
                Col<AdjRow>("category", Kind.TEXT, 16) { info(it.code, it.name).category },
                Col<AdjRow>("sub_category", Kind.TEXT, 24) { info(it.code, it.name).sub },
                Col<AdjRow>("items", Kind.TEXT, 42) { it.name },
                Col<AdjRow>("unit", Kind.TEXT, 10) { it.unit },
                Col<AdjRow>("Adjustment", Kind.TEXT, 12) { it.dir },
                Col<AdjRow>("Quantity", Kind.QTY, 12) { it.qty },
                Col<AdjRow>("Staff", Kind.TEXT, 18) { it.staff },
                Col<AdjRow>("Reason / notes", Kind.TEXT, 36) { it.notes }
            ),
            adjustmentRows(transactions, locationId, from, to), keepAll = true
        )
        val dayRows = ArrayList<DayRow>()
        days.forEachIndexed { i, d -> for (l in used) dayRows.add(DayRow(d.toString(), l, l.closes[i])) }
        val daily = makeSheet(
            "Daily Closing Balance",
            listOf(
                Col<DayRow>("Date", Kind.DATE, 12) { it.day },
                Col<DayRow>("code", Kind.ID, 8) { inf(it.l).no },
                Col<DayRow>("Item", Kind.TEXT, 42) { it.l.name },
                Col<DayRow>("Unit", Kind.TEXT, 10) { it.l.unit },
                Col<DayRow>("Closing Balance", Kind.QTY, 16) { f(it.close) }
            ),
            dayRows, keepAll = true
        )
        return listOf(list, starting, current, adjustments, daily)
    }

    fun stockWorkbook(materials: List<MaterialEntity>, transactions: List<TransactionWithLines>, locationId: String, from: LocalDate, to: LocalDate): ByteArray =
        XlsxWriter.build(stockSheets(materials, transactions, locationId, from, to))
}
