package com.campstock.inventory

import com.campstock.inventory.data.LocationEntity
import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.BlockStock
import com.campstock.inventory.model.DrrReport
import com.campstock.inventory.model.ReportBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

class RemainingFeaturesTest {

    private fun tx(
        id: String, type: String, src: String, dst: String, date: String = "2026-10-20T08:00:00Z",
        drr: String = "", sub: String = "", mrf: String = "",
        vararg lines: Pair<String, String>
    ) = TransactionWithLines(
        TransactionEntity(
            clientTxUuid = id, txType = type, txDateTime = date, sourceLocationId = src, destinationLocationId = dst,
            staffId = "S", referenceNumber = "R-$id", createdAt = date, modifiedAt = date,
            drrCode = drr, subBlock = sub, mrfNumber = mrf
        ),
        lines.mapIndexed { i, l -> TransactionLineEntity("$id-$i", id, l.first, "Name ${l.first}", l.second, "PCS") }
    )

    @Test
    fun blockStockIsIssuedMinusReturned() {
        val blocks = setOf("LOC-BLOCK-A", "LOC-BLOCK-B")
        val list = listOf(
            tx("d1", "DISPATCH", "LOC-CENTRAL", "LOC-BLOCK-A", lines = arrayOf("M1" to "100", "M2" to "10")),
            tx("d2", "DISPATCH", "LOC-CENTRAL", "LOC-BLOCK-A", lines = arrayOf("M1" to "50")),
            tx("r1", "RETURN", "LOC-BLOCK-A", "LOC-CENTRAL", lines = arrayOf("M1" to "30")),
            tx("d3", "DISPATCH", "LOC-CENTRAL", "LOC-BLOCK-B", lines = arrayOf("M1" to "7")),
            tx("d4", "DISPATCH", "LOC-CENTRAL", "LOC-OTHER", lines = arrayOf("M1" to "999"))   // not a block
        )
        val rows = BlockStock.compute(list, blocks)
        val a1 = rows.first { it.blockId == "LOC-BLOCK-A" && it.materialCode == "M1" }
        assertEquals(0, BigDecimal("150").compareTo(a1.issued))
        assertEquals(0, BigDecimal("30").compareTo(a1.returned))
        assertEquals(0, BigDecimal("120").compareTo(a1.net))
        assertEquals(3, rows.size)                       // A/M1, A/M2, B/M1
    }

    @Test
    fun returnsReduceDrrTotals() {
        val list = listOf(
            tx("d1", "DISPATCH", "LOC-CENTRAL", "LOC-BLOCK-A", drr = "DRR-1", sub = "A1", mrf = "MRF-1", lines = arrayOf("M1" to "100")),
            tx("r1", "RETURN", "LOC-BLOCK-A", "LOC-CENTRAL", drr = "DRR-1", sub = "A1", mrf = "MRF-1", lines = arrayOf("M1" to "25"))
        )
        val rows = DrrReport.rows(list)
        assertEquals(2, rows.size)
        assertEquals(0, BigDecimal("75").compareTo(DrrReport.totalsByMaterial(rows).single().total))
        assertEquals(1, DrrReport.summaries(rows).single().dispatchCount)      // the return is not a dispatch
    }

    @Test
    fun countQuantityAllowsZero() {
        assertTrue(com.campstock.inventory.model.FormUtil.isValidCountQty("0"))
        assertTrue(com.campstock.inventory.model.FormUtil.isValidCountQty("12.5"))
        assertFalse(com.campstock.inventory.model.FormUtil.isValidCountQty("-1"))
        assertFalse(com.campstock.inventory.model.FormUtil.isValidCountQty(""))
        assertFalse(com.campstock.inventory.model.FormUtil.isValidQty("0"))
    }

    @Test
    fun csvEscapingAndStockFlags() {
        assertEquals("plain", ReportBuilder.csvCell("plain"))
        assertEquals("\"a,b\"", ReportBuilder.csvCell("a,b"))
        assertEquals("\"say \"\"hi\"\"\"", ReportBuilder.csvCell("say \"hi\""))
        val loc = LocationEntity("LOC-CENTRAL", "Central Camp Warehouse", "CENTRAL_WAREHOUSE", "CENTRAL")
        val mats = listOf(
            MaterialEntity("M1", "Sand", "CUM", true),
            MaterialEntity("M2", "Arm", "NEEDS_CONFIRMATION", false),
            MaterialEntity("M3", "Cement", "BAG", true)
        )
        val csv = ReportBuilder.stockSummary(loc, mats, mapOf("M1" to BigDecimal("3.442"), "M3" to BigDecimal("-2")))
        assertTrue(csv.contains("M1,Sand,CUM,3.442,"))
        assertTrue(csv.contains("UNIT NOT CONFIRMED"))
        assertTrue(csv.contains("NEGATIVE"))
        assertFalse(csv.contains("M1,Sand,CUM,3.442,NEGATIVE"))
    }
}
