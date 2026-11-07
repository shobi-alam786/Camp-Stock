package com.campstock.inventory

import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.CatalogueOps
import com.campstock.inventory.model.StockCalculator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal
import java.time.LocalDate
import java.time.LocalTime

/** Same cases as src/utils/catalogueOps.test.ts on the Windows app. */
class CatalogueOpsTest {
    private val loc = "LOC-CENTRAL"
    private val lamp = MaterialEntity("CUS-AAAAAA", "Solar Lamp", "PCS", true, isCustom = true)
    private val cement = MaterialEntity("MAT-0005", "Cement", "BAG", true)

    private fun tx(id: String, type: String, src: String, dst: String, material: MaterialEntity, qty: String) =
        TransactionWithLines(
            TransactionEntity(
                clientTxUuid = id, txType = type, txDateTime = "2026-10-21T10:00:00Z", sourceLocationId = src,
                destinationLocationId = dst, staffId = "S", referenceNumber = "REF-$id", createdAt = "2026-10-21T10:00:00Z",
                modifiedAt = "2026-10-21T10:00:00Z"
            ),
            listOf(TransactionLineEntity("$id-1", id, material.code, material.name, qty, material.unit))
        )

    private fun cur(m: MaterialEntity, l: String, led: List<TransactionWithLines>) = StockCalculator.calculate(m.code, l, led)

    @Test fun openingChangeRaisesAndLowersCurrentStock() {
        var led = listOf(tx("o1", "OPENING_STOCK", loc, loc, lamp, "40"))
        assertEquals("40", cur(lamp, loc, led).openingStock)
        assertEquals("40", cur(lamp, loc, led).currentStock)
        assertEquals("0", cur(lamp, "LOC-BLOCK-A", led).currentStock)

        val up = CatalogueOps.openingDelta("55.5", CatalogueOps.openingFor(lamp.code, loc, led))
        assertEquals("15.5", up.stripTrailingZeros().toPlainString())
        led = listOf(tx("o2", "OPENING_STOCK", loc, loc, lamp, up.toPlainString())) + led

        val down = CatalogueOps.openingDelta("10", CatalogueOps.openingFor(lamp.code, loc, led))
        assertEquals("-45.5", down.stripTrailingZeros().toPlainString())
        led = listOf(tx("o3", "OPENING_STOCK", loc, loc, lamp, down.toPlainString())) + led
        assertEquals("10", cur(lamp, loc, led).openingStock)
        assertEquals("10", cur(lamp, loc, led).currentStock)

        assertEquals(0, CatalogueOps.openingDelta("10", CatalogueOps.openingFor(lamp.code, loc, led)).signum())

        led = listOf(tx("d", "DISPATCH", loc, "LOC-BLOCK-A", lamp, "4")) + led
        assertEquals("6", cur(lamp, loc, led).currentStock)
        led = listOf(tx("o4", "OPENING_STOCK", loc, loc, lamp, "10")) + led
        assertEquals("16", cur(lamp, loc, led).currentStock)
    }

    @Test fun openingBalancesMatchesCalculator() {
        val led = listOf(
            tx("o1", "OPENING_STOCK", loc, loc, lamp, "40"),
            tx("o2", "OPENING_STOCK", loc, loc, cement, "7.5"),
            tx("d", "DISPATCH", loc, "LOC-BLOCK-A", lamp, "4")
        )
        val m = CatalogueOps.openingBalances(loc, led)
        assertEquals(0, BigDecimal("40").compareTo(m[lamp.code]))
        assertEquals(0, BigDecimal("7.5").compareTo(m[cement.code]))
        assertTrue(CatalogueOps.openingBalances("LOC-BLOCK-A", led).isEmpty())
    }

    @Test fun bulkTextIsChecked() {
        val rows = CatalogueOps.parseBulk(
            "Cement, bag, 120\nSand;CUM;15,5\nGravel, , 3\nSolar Lamp, PCS, x\nsand, CUM, 1\n\nTape, ROLL",
            listOf("Solar Lamp")
        )
        assertEquals(6, rows.size)
        assertNull(rows[0].error); assertEquals("BAG", rows[0].unit); assertEquals("120", rows[0].qty)
        assertNull(rows[1].error); assertEquals("15.5", rows[1].qty)
        assertEquals("Missing unit.", rows[2].error)
        assertTrue(rows[3].error != null)
        assertTrue(rows[4].error != null)
        assertNull(rows[5].error); assertEquals("0", rows[5].qty)
    }

    @Test fun phoneAndHandoverValidation() {
        assertTrue(CatalogueOps.isValidPhone("+880 1817-239847"))
        assertTrue(!CatalogueOps.isValidPhone("12") && !CatalogueOps.isValidPhone("abc"))
        val today = LocalDate.of(2026, 10, 21)
        val noon = LocalTime.NOON
        val ok = CatalogueOps.HandoverInput("Ali", "01711111111", "Rahim", "01822222222", "2026-10-20")
        assertEquals("", CatalogueOps.validateHandover(ok, today, noon))
        assertTrue(CatalogueOps.validateHandover(ok.copy(toName = ""), today, noon).contains("taking over"))
        assertTrue(CatalogueOps.validateHandover(ok.copy(fromPhone = "1"), today, noon).contains("handing over"))
        assertTrue(CatalogueOps.validateHandover(ok.copy(date = "2999-01-01"), today, noon).contains("Date"))
        assertTrue(CatalogueOps.validateHandover(ok.copy(toName = "ali", toPhone = "0171 111 1111"), today, noon).contains("same person"))
    }

    @Test fun handoverSnapshotListsBalancesAndNeverChangesStock() {
        val led = listOf(
            tx("o1", "OPENING_STOCK", loc, loc, cement, "100"),
            tx("o2", "OPENING_STOCK", loc, loc, lamp, "10"),
            tx("d", "DISPATCH", loc, "LOC-BLOCK-A", lamp, "10")   // lamp back to 0: not in the snapshot
        )
        val snap = CatalogueOps.handoverSnapshot(listOf(cement, lamp), loc, led)
        assertEquals(1, snap.size)
        assertEquals(cement.code, snap[0].first.code)
        assertEquals(0, BigDecimal(100).compareTo(snap[0].second))

        val ho = tx("h", "STAFF_HANDOVER", loc, loc, cement, "100")
        val after = listOf(ho) + led
        assertEquals("100", cur(cement, loc, after).currentStock)
        assertEquals(1, CatalogueOps.handoverSnapshot(listOf(cement, lamp), loc, after).size)
        assertEquals(0, BigDecimal(100).compareTo(StockCalculator.balancesFor(loc, after)[cement.code]))
    }
}
