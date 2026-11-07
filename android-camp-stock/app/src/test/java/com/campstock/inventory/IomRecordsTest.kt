package com.campstock.inventory

import com.campstock.inventory.model.IomRecords
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

class IomRecordsTest {
    private fun line(name: String, unit: String, qty: String) = mapOf(
        "rpt_items/items" to name, "rpt_items/unit" to unit, "rpt_items/quantity" to qty
    )

    private val sub29: Map<String, Any?> = mapOf(
        "_id" to 38479309, "entry_by" to "Shuly", "entry_date" to "2026-10-29", "inventory_type" to "Dispatched",
        "inventory_sub_type" to "Camp", "mrf_no" to "093233", "drr_code" to "C013-B-260723-113841",
        "rpt_items" to listOf(line("Cement", "Bag", "1.5"), line("Bricks", "Pcs", "150.0"))
    )
    private val sub2024: Map<String, Any?> = mapOf(
        "_id" to 11577995, "entry_by" to "Md Al Mamun ", "entry_date" to "2024-06-10", "inventory_type" to "Received",
        "inventory_sub_type" to "Warehouse", "warehouse" to "nhila_warehouse", "waybill_no" to "82693",
        "rpt_items" to listOf(line("Cement", "Bag", "200.0"))
    )

    @Test fun queryAndUrl() {
        assertEquals("{\"sd_storage\":\"13\",\"entry_date\":{\"\$gte\":\"2026-10-29\",\"\$lte\":\"2026-10-29\"}}", IomRecords.buildQuery("2026-10-29", "2026-10-29"))
        assertEquals("{\"sd_storage\":\"13\"}", IomRecords.buildQuery("", ""))
        val url = IomRecords.buildFirstUrl("https://kf.kobo.iom.int/", "aP3n8sFSQ8FJFpbpFduYd4", "2026-10-01", "2026-10-29")
        assertTrue(url.startsWith("https://kf.kobo.iom.int/api/v2/assets/aP3n8sFSQ8FJFpbpFduYd4/data/?"))
        assertTrue(url.contains("sd_storage"))
        assertEquals("https://kf.kobo.iom.int/x", IomRecords.safeNextUrl("http://kf.kobo.iom.int/x"))
        assertNull(IomRecords.safeNextUrl(null))
    }

    @Test fun parsesPastedDataUrl() {
        val p = IomRecords.parseDataUrl("https://kf.kobo.iom.int/api/v2/assets/aP3n8sFSQ8FJFpbpFduYd4/data/?limit=5&utm_source=chatgpt.com")
        assertEquals("https://kf.kobo.iom.int" to "aP3n8sFSQ8FJFpbpFduYd4", p)
        assertNull(IomRecords.parseDataUrl("not a url"))
    }

    @Test fun flattenExpandsLinesAndTrimsStaff() {
        val rows = IomRecords.flatten(sub29)
        assertEquals(2, rows.size)
        assertEquals("Cement", rows[0].item)
        assertEquals("150.0", rows[1].quantity)
        assertEquals("38479309#1", rows[1].rowKey)
        assertEquals("Md Al Mamun", IomRecords.flatten(sub2024)[0].entryBy)
        assertEquals(1, IomRecords.flatten(mapOf("_id" to 5, "entry_date" to "2026-01-01")).size)
        assertEquals(0, IomRecords.flatten(mapOf("entry_date" to "2026-01-01")).size)
    }

    @Test fun duplicatesAreSkippedByKoboId() {
        val a = IomRecords.merge(emptyList(), listOf(sub29, sub2024))
        assertEquals(3, a.rows.size); assertEquals(2, a.added)
        val b = IomRecords.merge(a.rows, listOf(sub29, sub29))
        assertEquals(3, b.rows.size); assertEquals(0, b.added); assertEquals(2, b.skipped)
    }

    @Test fun otherCampsAreIgnored() {
        val r = IomRecords.merge(emptyList(), listOf(sub29 + ("_id" to 1) + ("sd_storage" to "7"), sub29))
        assertEquals(1, r.added)
    }

    @Test fun filtersWork() {
        val all = IomRecords.merge(emptyList(), listOf(sub29, sub2024)).rows
        val none = IomRecords.Filters()
        assertEquals(2, IomRecords.filter(all, "2026-10-29", "2026-10-29", none).size)
        assertEquals(3, IomRecords.filter(all, "2024-01-01", "2026-12-31", none).size)
        assertEquals(1, IomRecords.filter(all, "", "", none.copy(type = "Received")).size)
        assertEquals(1, IomRecords.filter(all, "", "", none.copy(material = "brick")).size)
        assertEquals(0, IomRecords.filter(all, "", "", none.copy(material = "66")).size)
        assertEquals(2, IomRecords.filter(all, "", "", none.copy(search = "0932")).size)
        assertEquals(2, IomRecords.filter(all, "", "", none.copy(search = "c013-b")).size)
        assertEquals(0, IomRecords.filter(all, "", "", none.copy(search = "nothing")).size)
        assertFalse(IomRecords.inRange(all[0], "2026-10-30", ""))
    }

    @Test fun totalsAndCsv() {
        val all = IomRecords.merge(emptyList(), listOf(sub29, sub2024)).rows
        assertEquals(BigDecimal("201.5"), IomRecords.totals(all).first { it.item == "Cement" }.total)
        val csv = IomRecords.toCsv(all)
        assertEquals(4, csv.split("\r\n").size)
        assertTrue(csv.contains("38479309"))
        assertFalse(csv.lines().first().contains("Entry by"))
        assertFalse(csv.contains("Shuly"))
        assertTrue(csv.contains(",1.5,"))
        assertFalse(csv.lines().first().contains("Code"))
    }

    @Test fun decimalsAreExact() {
        fun row(q: String) = IomRecords.Row(1, "1#0", "2026-10-29", "", "Dispatched", "", "", "", "", "", "", "Cement", "Bag", q, "")
        assertEquals(BigDecimal("0.3"), IomRecords.totals(listOf(row("0.1"), row("0.2"))).single().total)
        assertEquals(BigDecimal("6.75"), IomRecords.totals(listOf(row("1.5"), row("2.25"), row("3"))).single().total)
        assertEquals(BigDecimal("150.0"), IomRecords.totals(listOf(row("150.0"))).single().total)
    }

    @Test fun lastZeroIsNeverDropped() {
        fun row(q: String) = IomRecords.Row(1, "1#0", "2026-10-29", "", "Dispatched", "", "", "", "", "", "", "Sand", "Kg", q, "")
        assertEquals("0.17", IomRecords.formatQty("0.17"))
        assertEquals("0.170", IomRecords.formatQty("0.170"))
        assertEquals("1.5", IomRecords.formatQty("1.5"))
        assertEquals("0.1700", IomRecords.formatQty("0.1700"))
        assertEquals("150.0", IomRecords.formatQty("150.0"))
        assertEquals("2.5", IomRecords.formatQty("2.5"))
        assertEquals("1.70", IomRecords.formatQty("1.70"))
        assertEquals("abc", IomRecords.formatQty("abc"))
        val t = IomRecords.totals(listOf(row("0.170"), row("0.250"))).single().total
        assertEquals("0.420", IomRecords.formatQty(t.toPlainString()))
        assertEquals("0.170", IomRecords.formatQty(IomRecords.totals(listOf(row("0.170"))).single().total.toPlainString()))
    }
}
