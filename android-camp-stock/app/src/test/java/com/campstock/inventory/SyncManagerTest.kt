package com.campstock.inventory

import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.sync.KoboSyncManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncManagerTest {

    @Test
    fun testBuildOpenRosaXmlMultiLine() {
        val tx = TransactionWithLines(
            transaction = TransactionEntity(
                clientTxUuid = "550e8400-e29b-41d4-a716-446655440099",
                txType = "DISPATCH",
                txDateTime = "2026-10-20T10:00:00Z",
                sourceLocationId = "LOC-CENTRAL",
                destinationLocationId = "LOC-BLOCK-A",
                staffId = "Staff-1",
                referenceNumber = "DSP-100",
                notes = "Test dispatch",
                createdAt = "2026-10-20T10:00:00Z",
                modifiedAt = "2026-10-20T10:00:00Z"
            ),
            lines = listOf(
                TransactionLineEntity("l-1", "550e8400-e29b-41d4-a716-446655440099", "MAT-0001", "Bamboo Borak", "50.0000", "PCS"),
                TransactionLineEntity("l-2", "550e8400-e29b-41d4-a716-446655440099", "MAT-0013", "Nails 1 in", "5.0000", "KG")
            )
        )

        val xml = KoboSyncManager.buildOpenRosaXml(tx, "camp_stock_transactions")
        assertTrue(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?><camp_stock_transactions id=\"camp_stock_transactions\">"))
        assertTrue(xml.contains("<client_tx_uuid>550e8400-e29b-41d4-a716-446655440099</client_tx_uuid>"))
        assertTrue(xml.contains("<material_code>MAT-0001</material_code>"))
        assertTrue(xml.contains("<material_code>MAT-0013</material_code>"))
        assertTrue(xml.contains("<instanceID>uuid:550e8400-e29b-41d4-a716-446655440099</instanceID>"))

        // Verify count of repeat group tags
        val count = "<material_lines>".toRegex().findAll(xml).count()
        assertEquals(2, count)
    }
}
