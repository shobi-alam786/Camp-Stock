package com.campstock.inventory

import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.CatalogueOps
import com.campstock.inventory.model.StockCalculator
import com.campstock.inventory.sync.KoboRows
import com.campstock.inventory.sync.SyncRules
import com.campstock.inventory.sync.OpenRosaXml
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Exact quantity + "one material = one Kobo submission" rules, same scenarios as the Windows test
 * (src/services/koboSync.test.ts). A small in-memory Kobo and in-memory phones apply the shared rules
 * (CatalogueOps plans, SyncRules, KoboRows) the way KoboSyncManager does.
 */
class KoboUpdateSyncTest {
    private val loc = "LOC-CENTRAL"
    private val borak = MaterialEntity("MAT-0001", "Bamboo Borak", "PCS", true)
    private val treated = MaterialEntity("MAT-0045", "Treated Borak Bamboo", "PCS", true)

    /** In-memory Kobo form: rows as Kobo REST v2 JSON. */
    private class FakeKobo {
        val rows = ArrayList<JSONObject>()
        var nextId = 1000L
        var posts = 0
        var patches = 0
        fun post(item: TransactionWithLines) {
            posts++
            val t = item.transaction
            val lines = JSONArray()
            item.lines.forEach { l ->
                lines.put(JSONObject().put("material_lines/material_code", l.materialCode).put("material_lines/material_name", l.materialName)
                    .put("material_lines/quantity", l.quantity.toDouble()).put("material_lines/unit", l.unit))
            }
            rows.add(JSONObject().put("_id", nextId++).put("_uuid", t.clientTxUuid).put("meta/instanceID", "uuid:${t.clientTxUuid}")
                .put("_submission_time", Instant.now().toString()).put("client_tx_uuid", t.clientTxUuid).put("tx_type", t.txType)
                .put("tx_date_time", t.txDateTime).put("source_location", t.sourceLocationId).put("destination_location", t.destinationLocationId)
                .put("staff_id", t.staffId).put("ref_no", t.referenceNumber).put("notes", t.notes).put("material_lines", lines))
        }
        fun patch(id: Long, data: Map<String, String>) {
            patches++
            val r = rows.first { it.optLong("_id") == id }
            data.forEach { (k, v) ->
                if (k in setOf("material_name", "quantity", "unit", "line_notes", "damaged_quantity")) {
                    val arr = r.optJSONArray("material_lines")!!
                    for (i in 0 until arr.length()) arr.getJSONObject(i).put("material_lines/$k", if (k == "quantity") v.toDouble() else v)
                } else r.put(k, v)
            }
        }
        fun find(uuid: String) = rows.firstOrNull { it.optString("client_tx_uuid") == uuid }
    }

    private class Phone(val kobo: FakeKobo) {
        var ledger = listOf<TransactionWithLines>()
        fun apply(plan: CatalogueOps.StockPlan) {
            val item = TransactionWithLines(plan.tx, plan.lines)
            ledger = if (plan.replaces) ledger.map { if (it.transaction.clientTxUuid == plan.tx.clientTxUuid) item else it } else listOf(item) + ledger
        }
        fun sync() {
            // pull and merge
            for (row in kobo.rows.toList()) {
                val remote = KoboRows.toTransaction(row)
                val local = ledger.firstOrNull { it.transaction.clientTxUuid == remote.transaction.clientTxUuid }
                when (val d = SyncRules.decide(local, remote, Instant.now().toString())) {
                    SyncRules.Decision.Add -> ledger = listOf(remote) + ledger
                    is SyncRules.Decision.Replace -> ledger = ledger.map { if (it.transaction.clientTxUuid == remote.transaction.clientTxUuid) d.merged else it }
                    is SyncRules.Decision.Link -> ledger = ledger.map {
                        if (it.transaction.clientTxUuid != remote.transaction.clientTxUuid) it else
                            it.copy(transaction = it.transaction.copy(syncStatus = if (d.markSynced) "SYNCED" else it.transaction.syncStatus, koboSubmissionId = d.submissionId, koboInstanceId = d.instanceId))
                    }
                    else -> {}
                }
            }
            // send pending: CREATE -> POST, UPDATE -> PATCH the same submission
            for (item in ledger.filter { it.transaction.syncStatus != "SYNCED" }) {
                val t = item.transaction
                val done: TransactionEntity = when (SyncRules.actionFor(t)) {
                    SyncRules.Action.CREATE -> {
                        kobo.post(item)
                        val r = KoboRows.toTransaction(kobo.find(t.clientTxUuid)!!).transaction
                        t.copy(syncStatus = "SYNCED", koboSubmissionId = r.koboSubmissionId, koboInstanceId = r.koboInstanceId)
                    }
                    SyncRules.Action.UPDATE -> {
                        kobo.patch(t.koboSubmissionId!!, OpenRosaXml.updateData(item))
                        t.copy(syncStatus = "SYNCED")
                    }
                }
                ledger = ledger.map { if (it.transaction.clientTxUuid == t.clientTxUuid) it.copy(transaction = done) else it }
            }
        }
        fun stock(m: MaterialEntity) = StockCalculator.calculate(m.code, "LOC-CENTRAL", ledger).currentStock
        fun setStock(m: MaterialEntity, qty: String, at: String) {
            CatalogueOps.planStockCount(m, "LOC-CENTRAL", qty, "staff", ledger, Instant.parse(at))?.let { apply(it) }
        }
    }

    private fun koboQty(row: JSONObject, code: String): Double {
        val a = row.optJSONArray("material_lines")!!
        for (i in 0 until a.length()) { val l = a.getJSONObject(i); if (l.optString("material_lines/material_code") == code) return l.optString("material_lines/quantity").toDouble() }
        error("no line")
    }

    @Test
    fun exactQuantityUpdateInPlaceAndNoDuplicates() {
        val kobo = FakeKobo()
        val win = Phone(kobo)
        // a dispatch recorded before any count (stock -15): the old rule stored 600 for a typed 585
        win.ledger = listOf(TransactionWithLines(
            TransactionEntity("d1", "DISPATCH", "2026-10-20T08:00:00Z", loc, "LOC-BLOCK-A", "s", "D-1", syncStatus = "SYNCED", createdAt = "x", modifiedAt = "x"),
            listOf(TransactionLineEntity("d1-line-1", "d1", borak.code, borak.name, "15", "PCS"))
        ))
        assertEquals("-15", win.stock(borak))
        win.setStock(borak, "585", "2026-10-21T08:00:00Z")
        assertEquals("585", win.stock(borak))
        win.sync()
        assertEquals(1, kobo.rows.size)
        assertEquals(585.0, koboQty(kobo.rows[0], borak.code), 0.0)           // Android enters 585 -> Kobo shows 585
        val originalId = kobo.rows[0].optLong("_id")
        win.sync(); win.sync()
        assertEquals(1, kobo.posts)                                            // synchronize twice -> no duplicate

        win.setStock(borak, "600", "2026-10-22T08:00:00Z")                     // 585 -> 600 updates the original record
        win.sync()
        assertEquals(1, kobo.rows.size); assertEquals(originalId, kobo.rows[0].optLong("_id"))
        assertEquals(600.0, koboQty(kobo.rows[0], borak.code), 0.0); assertEquals(1, kobo.patches)

        val other = Phone(kobo)                                                // the other app receives it and changes 600 -> 450
        other.sync()
        assertEquals("600", other.stock(borak))
        other.setStock(borak, "450", "2026-10-23T08:00:00Z")
        other.sync()
        assertEquals(1, kobo.rows.size); assertEquals(450.0, koboQty(kobo.rows[0], borak.code), 0.0)
        win.sync()
        assertEquals("450", win.stock(borak))

        // edited in both apps while apart: the newest count wins, still ONE submission
        win.setStock(borak, "280", "2026-10-25T08:00:00Z")
        other.setStock(borak, "260", "2026-10-25T09:00:00Z")
        other.sync(); win.sync(); other.sync(); win.sync()
        assertEquals(1, kobo.rows.size); assertEquals(260.0, koboQty(kobo.rows[0], borak.code), 0.0)
        assertEquals("260", win.stock(borak)); assertEquals("260", other.stock(borak))

        // another material has its own submission and stays unchanged
        win.setStock(treated, "200", "2026-10-26T08:00:00Z"); win.sync()
        assertEquals(2, kobo.rows.size)
        win.setStock(borak, "261", "2026-10-27T08:00:00Z"); win.sync()
        assertEquals(200.0, koboQty(kobo.rows.first { it.optString("client_tx_uuid") != kobo.rows[0].optString("client_tx_uuid") }, treated.code), 0.0)
        assertEquals(2, kobo.rows.size)
    }

    @Test
    fun snapshotCountsOnlyLaterMovementsAndLegacyBaselinesKeepOldMeaning() {
        fun mv(id: String, type: String, q: String, at: String) = TransactionWithLines(
            TransactionEntity(id, type, at, if (type == "DISPATCH") loc else "SUP", if (type == "DISPATCH") "B" else loc, "s", id, syncStatus = "SYNCED", createdAt = at, modifiedAt = at),
            listOf(TransactionLineEntity("$id-l", id, borak.code, borak.name, q, "PCS")))
        fun base(ref: String, q: String) = TransactionWithLines(
            TransactionEntity("b", "STOCK_BASELINE", "2026-10-20T08:00:00Z", loc, loc, "s", ref, syncStatus = "SYNCED", createdAt = "x", modifiedAt = "x"),
            listOf(TransactionLineEntity("b-l", "b", borak.code, borak.name, q, "PCS")))
        val snap = listOf(mv("o", "DISPATCH", "100", "2026-10-19T08:00:00Z"), base("SNAP-1", "585"), mv("n", "DISPATCH", "25", "2026-10-21T08:00:00Z"))
        assertEquals("560", StockCalculator.calculate(borak.code, loc, snap).currentStock)
        assertEquals("560", StockCalculator.balancesFor(loc, snap)[borak.code]!!.stripTrailingZeros().toPlainString())
        val legacy = listOf(mv("o", "DISPATCH", "100", "2026-10-19T08:00:00Z"), base("STK-1", "700"))
        assertEquals("600", StockCalculator.calculate(borak.code, loc, legacy).currentStock)
        assertEquals("600", StockCalculator.balancesFor(loc, legacy)[borak.code]!!.stripTrailingZeros().toPlainString())
    }

    @Test
    fun pendingCreateFoundOnKoboIsLinkedNotPostedAgain() {
        val kobo = FakeKobo()
        val p = Phone(kobo)
        p.setStock(borak, "50.948", "2026-10-28T08:00:00Z")
        val lost = p.ledger[0]
        kobo.post(lost)                                                        // Kobo accepted it, the reply was lost
        p.ledger = listOf(lost.copy(transaction = lost.transaction.copy(syncStatus = "OUTCOME_UNKNOWN")))
        p.sync()
        assertEquals(1, kobo.posts); assertEquals(1, kobo.rows.size)
        assertEquals("SYNCED", p.ledger[0].transaction.syncStatus); assertNotNull(p.ledger[0].transaction.koboSubmissionId)
        assertNull(CatalogueOps.planStockCount(borak, loc, "50.9480", "s", p.ledger))   // same quantity: nothing to do
        assertTrue(SyncRules.sameContent(p.ledger[0], KoboRows.toTransaction(kobo.rows[0])))
    }
}
