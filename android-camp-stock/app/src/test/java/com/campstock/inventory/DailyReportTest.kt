package com.campstock.inventory

import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.DailyReport
import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigDecimal
import java.time.LocalDate
import java.time.ZoneOffset

/** Same ledger as src/utils/dailyReport.test.ts on the Windows app. */
class DailyReportTest {
    private val utc = ZoneOffset.UTC

    private fun tx(id: String, type: String, date: String, src: String, dst: String, qty: String,
                   block: String = "", sub: String = "", mrf: String = "", drr: String = "") =
        TransactionWithLines(
            TransactionEntity(
                clientTxUuid = id, txType = type, txDateTime = date, sourceLocationId = src, destinationLocationId = dst,
                staffId = "S1", referenceNumber = "REF-$id", createdAt = date, modifiedAt = date,
                drrCode = drr, block = block, subBlock = sub, mrfNumber = mrf
            ),
            listOf(TransactionLineEntity("$id-1", id, "MAT-0005", "Cement", qty, "BAGS"))
        )

    private val ledger = listOf(
        tx("o", "OPENING_STOCK", "2026-10-18T09:00:00Z", "SUPPLIER", "LOC-CENTRAL", "100"),
        tx("d1", "DISPATCH", "2026-10-20T10:00:00Z", "LOC-CENTRAL", "LOC-BLOCK-A", "30", "A", "S1", "MRF-1", "D1"),
        tx("d2", "DISPATCH", "2026-10-21T10:00:00Z", "LOC-CENTRAL", "LOC-BLOCK-A", "10", "A", "S1", "MRF-1", "D1"),
        tx("r1", "RETURN", "2026-10-21T12:00:00Z", "LOC-BLOCK-A", "LOC-CENTRAL", "4", "A", "S1", "MRF-1", "D1").let { t ->
            t.copy(lines = t.lines.map { it.copy(damagedQuantity = "1") })
        },
        tx("d3", "DISPATCH", "2026-10-21T13:00:00Z", "LOC-CENTRAL", "LOC-OTHER", "5")
    )
    private val day = LocalDate.of(2026, 10, 21)
    private val cement = MaterialEntity("MAT-0005", "Cement", "BAGS", true)

    @Test fun startingAndClosingBalance() {
        val b = DailyReport.balances(listOf(cement), ledger, "LOC-CENTRAL", day, utc).single()
        assertEquals(0, BigDecimal(70).compareTo(b.start))
        assertEquals(0, BigDecimal(59).compareTo(b.close))
    }

    @Test fun nothingBeforeOpeningStock() {
        val b = DailyReport.balances(listOf(cement), ledger, "LOC-CENTRAL", LocalDate.of(2026, 10, 17), utc).single()
        assertEquals(0, BigDecimal.ZERO.compareTo(b.close))
    }

    @Test fun mrfRecordsGroupDispatchAndReturns() {
        val rows = DailyReport.mrfRecords(ledger, "LOC-CENTRAL", day, null, null, "", utc)
        assertEquals(1, rows.size)                                  // the other-warehouse dispatch is not an MRF record
        assertEquals(0, BigDecimal(10).compareTo(rows[0].dispatchQty))
        assertEquals(0, BigDecimal(4).compareTo(rows[0].returnQty))
        assertEquals(0, BigDecimal(1).compareTo(rows[0].damagedQty))
        assertEquals(0, DailyReport.mrfRecords(ledger, "LOC-CENTRAL", day, "B", null, "", utc).size)
        assertEquals(0, DailyReport.mrfRecords(ledger, "LOC-CENTRAL", day, null, "MAT-0006", "", utc).size)
        assertEquals(1, DailyReport.mrfRecords(ledger, "LOC-CENTRAL", day, null, null, "cem", utc).size)
    }

    @Test fun mrfSearchTotals() {
        val m = DailyReport.searchMrf(ledger, "mrf-1").single()
        assertEquals(0, BigDecimal(40).compareTo(m.lines[0].issued))
        assertEquals(0, BigDecimal(4).compareTo(m.lines[0].returned))
        assertEquals("D1", m.drrCode)
    }
}
