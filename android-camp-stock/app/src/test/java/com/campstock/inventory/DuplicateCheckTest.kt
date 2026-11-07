package com.campstock.inventory

import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.DuplicateCheck
import com.campstock.inventory.model.ReportBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

class DuplicateCheckTest {
    private fun tx(id: String, type: String, qty: String, damaged: String = "0", drr: String = "C013-A") = TransactionWithLines(
        TransactionEntity(clientTxUuid = id, txType = type, txDateTime = "2026-10-23T06:47:15Z", sourceLocationId = "LOC-CENTRAL",
            destinationLocationId = "LOC-BLOCK-A", staffId = "S", referenceNumber = "R", drrCode = drr, mrfNumber = "123321",
            createdAt = "x", modifiedAt = "x"),
        listOf(TransactionLineEntity("$id-1", id, "MAT-0001", "Bamboo Borak", qty, "PCS", damagedQuantity = damaged))
    )

    @Test fun sameDispatchFromAnotherDeviceIsFlagged() {
        val a = tx("d1", "DISPATCH", "10")
        val b = tx("d2", "DISPATCH", "10")
        assertEquals(1, DuplicateCheck.find(listOf(a, b), listOf(b)).size)
    }

    @Test fun differentQuantityOrReturnIsNotFlagged() {
        val a = tx("d1", "DISPATCH", "10")
        assertEquals(0, DuplicateCheck.find(listOf(a, tx("d3", "DISPATCH", "11")), listOf(tx("d3", "DISPATCH", "11"))).size)
        val r = tx("r1", "RETURN", "4", "1")
        assertEquals(0, DuplicateCheck.find(listOf(a, r), listOf(r)).size)
    }

    @Test fun dispatchDetailsMergesDispatchAndReturnByName() {
        val rows = ReportBuilder.dispatchDetailRows(listOf(tx("d1", "DISPATCH", "10"), tx("r1", "RETURN", "4", "1", "c013-a")))
        assertEquals(1, rows.size)
        assertEquals(0, BigDecimal(10).compareTo(rows[0].dispatched))
        assertEquals(0, BigDecimal(4).compareTo(rows[0].returned))
        assertEquals(0, BigDecimal(1).compareTo(rows[0].damaged))
        assertTrue(ReportBuilder.dispatchDetails(listOf(tx("d1", "DISPATCH", "10"))).startsWith("Dispatch Date,DRR CODE,MRF,Materials"))
    }
}
