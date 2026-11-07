package com.campstock.inventory

import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.DrrReport
import com.campstock.inventory.model.FormUtil
import com.campstock.inventory.model.StockCalculator
import com.campstock.inventory.sync.OpenRosaXml
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal
import java.time.LocalDate
import java.time.LocalTime

class DispatchFeatureTest {

    private fun tx(
        id: String, type: String, src: String, dst: String, date: String,
        drr: String = "", block: String = "", sub: String = "", mrf: String = "",
        supplier: String = "", po: String = "",
        vararg lines: Triple<String, String, String>   // code, qty, unit
    ) = TransactionWithLines(
        TransactionEntity(
            clientTxUuid = id, txType = type, txDateTime = date,
            sourceLocationId = src, destinationLocationId = dst,
            staffId = "S1", referenceNumber = "REF-$id",
            createdAt = date, modifiedAt = date,
            drrCode = drr, block = block, subBlock = sub, mrfNumber = mrf,
            supplierId = if (supplier.isEmpty()) "" else "SUP-1", supplierName = supplier, poNumber = po
        ),
        lines.mapIndexed { i, l -> TransactionLineEntity("$id-$i", id, l.first, "Name ${l.first}", l.second, l.third) }
    )

    private val ledger = listOf(
        tx("r1", "RECEIPT", "SUPPLIER", "LOC-CENTRAL", "2026-10-12T08:00:00Z", supplier = "M/S Azizi Enterprise", po = "4500234802",
            lines = arrayOf(Triple("MAT-0006", "11.442", "CUM"), Triple("MAT-0004", "1000", "PCS"))),
        tx("d1", "DISPATCH", "LOC-CENTRAL", "LOC-BLOCK-B", "2026-10-13T08:00:00Z", "DRR-1", "B", "B1", "MRF-10",
            lines = arrayOf(Triple("MAT-0006", "4", "CUM"), Triple("MAT-0004", "300", "PCS"))),
        tx("d2", "DISPATCH", "LOC-CENTRAL", "LOC-BLOCK-B", "2026-10-14T08:00:00Z", "DRR-1", "B", "B1", "MRF-11",
            lines = arrayOf(Triple("MAT-0006", "2.5", "CUM"))),
        tx("d3", "DISPATCH", "LOC-CENTRAL", "LOC-BLOCK-B", "2026-10-15T08:00:00Z", "drr-1", "B", "B2", "MRF-10",
            lines = arrayOf(Triple("MAT-0004", "100", "PCS"))),
        tx("d4", "DISPATCH", "LOC-CENTRAL", "LOC-BLOCK-C", "2026-10-15T09:00:00Z", "DRR-2", "C", "", "MRF-20",
            lines = arrayOf(Triple("MAT-0006", "1", "CUM"))),
        tx("d5", "DISPATCH", "LOC-CENTRAL", "LOC-OTHER", "2026-10-16T09:00:00Z",   // no DRR: not in DRR report
            lines = arrayOf(Triple("MAT-0006", "0.5", "CUM")))
    )

    @Test
    fun balancesMatchPerMaterialCalculation() {
        val bal = StockCalculator.balancesFor("LOC-CENTRAL", ledger)
        // sand: 11.442 - 4 - 2.5 - 1 - 0.5 = 3.442 ; bricks: 1000 - 300 - 100 = 600
        assertEquals(0, BigDecimal("3.442").compareTo(bal["MAT-0006"]))
        assertEquals(0, BigDecimal("600").compareTo(bal["MAT-0004"]))
        for (code in listOf("MAT-0006", "MAT-0004")) {
            val single = StockCalculator.calculate(code, "LOC-CENTRAL", ledger).currentStock
            assertEquals(0, BigDecimal(single).compareTo(bal[code]))
        }
    }

    @Test
    fun drrRowsOnlyIncludeDrrDispatches() {
        val rows = DrrReport.rows(ledger)
        assertEquals(5, rows.size)                 // d1 (2 lines) + d2 + d3 + d4
        assertTrue(rows.none { it.txUuid == "d5" || it.txUuid == "r1" })
        assertEquals(DrrReport.NO_SUB_BLOCK, rows.first { it.txUuid == "d4" }.subBlock)
    }

    @Test
    fun drrCodeMatchIsCaseInsensitive() {
        val rows = DrrReport.rows(ledger)
        assertEquals(4, DrrReport.forDrr(rows, "DRR-1").size)
        assertEquals(2, DrrReport.summaries(rows).size)
        assertEquals(3, DrrReport.summaries(rows).first { it.drrCode.equals("DRR-1", true) }.dispatchCount)
    }

    @Test
    fun filterBySubBlockAndMrf() {
        val rows = DrrReport.forDrr(DrrReport.rows(ledger), "DRR-1")
        assertEquals(listOf("B1", "B2"), DrrReport.subBlocksOf(rows))
        assertEquals(listOf("MRF-10", "MRF-11"), DrrReport.mrfsOf(rows, "B1"))
        assertEquals(listOf("MRF-10"), DrrReport.mrfsOf(rows, "B2"))
        assertEquals(3, DrrReport.filter(rows, "B1", null, "").size)
        assertEquals(2, DrrReport.filter(rows, "B1", "MRF-10", "").size)
        // search matches the material name ("Name MAT-0004") or code, here only bricks lines of MRF-10: d1 + d3
        assertEquals(2, DrrReport.filter(rows, null, "MRF-10", "MAT-0004").size)
        assertEquals(0, DrrReport.filter(rows, "B2", "MRF-11", "").size)
        assertEquals(2, DrrReport.filter(rows, null, null, "mat-0004").size)   // case-insensitive
    }

    @Test
    fun totalsAndSubBlockGrouping() {
        val rows = DrrReport.forDrr(DrrReport.rows(ledger), "DRR-1")
        val totals = DrrReport.totalsByMaterial(rows).associate { it.materialCode to it.total }
        assertEquals(0, BigDecimal("6.5").compareTo(totals["MAT-0006"]))
        assertEquals(0, BigDecimal("400").compareTo(totals["MAT-0004"]))
        val grouped = DrrReport.groupBySubBlockAndMrf(rows)
        assertEquals(listOf("B1", "B2"), grouped.keys.toList())
        assertEquals(listOf("MRF-10", "MRF-11"), grouped["B1"]!!.keys.toList())
        assertTrue(DrrReport.shareText("DRR-1", rows).contains("Sub-Block: B1"))
    }

    @Test
    fun quantityAndDateValidation() {
        assertTrue(FormUtil.isValidQty("11.442"))
        assertTrue(FormUtil.isValidQty("1000"))
        assertFalse(FormUtil.isValidQty("0"))
        assertFalse(FormUtil.isValidQty("-5"))
        assertFalse(FormUtil.isValidQty("1.23456"))
        assertFalse(FormUtil.isValidQty("abc"))
        assertFalse(FormUtil.isValidQty(""))
        val today = LocalDate.of(2026, 10, 21)
        assertNotNull(FormUtil.dateToIsoInstant("2026-10-20", today, LocalTime.NOON))
        assertNull(FormUtil.dateToIsoInstant("2026-10-22", today, LocalTime.NOON))
        assertNull(FormUtil.dateToIsoInstant("20/10/2026", today, LocalTime.NOON))
    }

    @Test
    fun dispatchXmlCarriesDrrFieldsAndAllLines() {
        val xml = OpenRosaXml.build(ledger[1], "camp_stock_transactions")
        assertTrue(xml.contains("<drr_code>DRR-1</drr_code>"))
        assertTrue(xml.contains("<block>B</block>"))
        assertTrue(xml.contains("<sub_block>B1</sub_block>"))
        assertTrue(xml.contains("<mrf_number>MRF-10</mrf_number>"))
        assertEquals(2, "<material_lines>".toRegex().findAll(xml).count())
        assertTrue(xml.contains("<material_name>Name MAT-0006</material_name>"))
    }

    @Test
    fun receiptXmlCarriesSupplierAndEscapes() {
        val r = tx("r9", "RECEIPT", "SUPPLIER", "LOC-CENTRAL", "2026-10-12T08:00:00Z", supplier = "A & B <Ltd>", po = "45",
            lines = arrayOf(Triple("MAT-0006", "1", "CUM")))
        val xml = OpenRosaXml.build(r, "camp_stock_transactions")
        assertTrue(xml.contains("<supplier_name>A &amp; B &lt;Ltd&gt;</supplier_name>"))
        assertTrue(xml.contains("<po_number>45</po_number>"))
    }
}
