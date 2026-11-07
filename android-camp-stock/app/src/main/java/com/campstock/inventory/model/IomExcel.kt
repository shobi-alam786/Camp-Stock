package com.campstock.inventory.model

import com.campstock.inventory.model.XlsxWriter.Cell
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Excel export of IOM Stock Records: one workbook, four sheets
 *   All records | Received | Dispatched | Returned
 * Columns that are empty for a sheet are left out. Quantities are real numbers that keep the decimals Kobo supplied.
 */
object IomExcel {
    enum class Kind { TEXT, ID, DATE, QTY }
    private class Col(val header: String, val kind: Kind, val width: Int = 14, val get: (IomRecords.Row) -> String)

    private val COLS = listOf(
        Col("Kobo ID", Kind.ID) { it.koboId.toString() },
        Col("Entry by", Kind.TEXT, 24) { it.entryBy },
        Col("Entry date", Kind.DATE, 12) { it.entryDate },
        Col("Type", Kind.TEXT, 12) { it.inventoryType },
        Col("Sub type", Kind.TEXT, 12) { it.inventorySubType },
        Col("MRF", Kind.ID) { it.mrfNo },
        Col("DRR", Kind.TEXT, 24) { it.drrCode },
        Col("Category", Kind.TEXT, 16) { it.category },
        Col("Sub category", Kind.TEXT, 24) { it.subCategory },
        Col("Item", Kind.TEXT, 42) { it.item },
        Col("Unit", Kind.TEXT, 10) { it.unit },
        Col("Quantity", Kind.QTY, 12) { it.quantity },
        Col("Waybill", Kind.ID) { it.waybillNo },
        Col("Camp", Kind.TEXT) { it.camp },
        Col("Warehouse", Kind.TEXT) { it.warehouse },
        Col("Supplier", Kind.TEXT, 26) { it.supplier },
        Col("PO number", Kind.ID) { it.poNumber },
        Col("GRN number", Kind.ID) { it.grnNumber },
        Col("PRF number", Kind.ID) { it.prfNumber },
        Col("Project", Kind.TEXT) { it.project },
        Col("Code", Kind.ID) { it.code },
        Col("Sub storage", Kind.TEXT, 14) { it.subStorage },
        Col("Casting yard", Kind.TEXT) { it.castingYard },
        Col("Description", Kind.TEXT, 30) { it.description }
    )

    private val DATE = Regex("""^(\d{4})-(\d{2})-(\d{2})""")
    private val ID = Regex("""^[1-9]\d{0,14}$|^0$""")
    private val QTY = Regex("""^[+-]?(\d{1,15})(?:\.(\d{1,6}))?$""")
    private val EPOCH = LocalDate.of(1899, 12, 30)

    fun excelDateSerial(text: String): Int? {
        val m = DATE.find(text) ?: return null
        return runCatching { ChronoUnit.DAYS.between(EPOCH, LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())).toInt() }.getOrNull()
    }

    fun toCell(kind: Kind, raw: String): Cell? {
        val v = raw.trim()
        if (v.isEmpty()) return null
        return when (kind) {
            Kind.DATE -> excelDateSerial(v)?.let { Cell.Date(it) } ?: Cell.Text(v)
            Kind.ID -> if (ID.matches(v)) Cell.Num(v, 0) else Cell.Text(v)
            Kind.QTY -> {
                val n = v.replace(",", "")
                val m = QTY.matchEntire(n)
                if (m != null) Cell.Num(n.removePrefix("+"), m.groupValues[2].length) else Cell.Text(v)
            }
            Kind.TEXT -> Cell.Text(raw)
        }
    }

    private fun sheetFor(name: String, rows: List<IomRecords.Row>): XlsxWriter.Sheet {
        val used = COLS.filter { c -> rows.any { c.get(it).isNotBlank() } }
            .ifEmpty { COLS.filter { it.header in setOf("Entry date", "Type", "Item", "Unit", "Quantity") } }
        return XlsxWriter.Sheet(name, used.map { it.header }, rows.map { r -> used.map { toCell(it.kind, it.get(r)) } }, used.map { it.width })
    }

    fun sheets(rows: List<IomRecords.Row>): List<XlsxWriter.Sheet> {
        fun typed(t: String) = rows.filter { it.inventoryType.trim().equals(t, ignoreCase = true) }
        return listOf(
            sheetFor("All records", rows),
            sheetFor("Received", typed("received")),
            sheetFor("Dispatched", typed("dispatched")),
            sheetFor("Returned", typed("returned"))
        )
    }

    fun workbook(rows: List<IomRecords.Row>): ByteArray = XlsxWriter.build(sheets(rows))
}
