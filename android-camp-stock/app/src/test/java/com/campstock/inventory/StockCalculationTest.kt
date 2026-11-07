package com.campstock.inventory

import com.campstock.inventory.data.*
import com.campstock.inventory.model.StockCalculator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StockCalculationTest {

    @Test
    fun testDecimalSafeArithmetic() {
        assertEquals("0.3", DecimalSafe.add("0.1", "0.2"))
        assertEquals("0.0001", DecimalSafe.subtract("1.0000", "0.9999"))
        assertEquals(0, DecimalSafe.compare("10.5", "10.5000"))
        assertTrue(DecimalSafe.compare("10.5001", "10.5") > 0)
    }

    @Test
    fun testStockCalculationFormula() {
        // Mock transaction history:
        // Opening: 100
        // Receipts: 50
        // Dispatches: 30
        // Return from site: 10
        // Positive Adj: 5
        // Negative Adj: 2
        // Expected Central Stock = 100 + 50 + 10 - 30 + 5 - 2 = 133
        val txs = listOf(
            TransactionWithLines(
                transaction = TransactionEntity(
                    clientTxUuid = "tx-1",
                    txType = "OPENING_STOCK",
                    txDateTime = "2026-10-20T08:00:00Z",
                    sourceLocationId = "",
                    destinationLocationId = "LOC-CENTRAL",
                    staffId = "Staff-1",
                    referenceNumber = "OP-001",
                    createdAt = "2026-10-20T08:00:00Z",
                    modifiedAt = "2026-10-20T08:00:00Z"
                ),
                lines = listOf(TransactionLineEntity("l-1", "tx-1", "MAT-0001", "Bamboo Borak", "100.0000", "PCS"))
            ),
            TransactionWithLines(
                transaction = TransactionEntity(
                    clientTxUuid = "tx-2",
                    txType = "RECEIPT",
                    txDateTime = "2026-10-20T09:00:00Z",
                    sourceLocationId = "SUPPLIER",
                    destinationLocationId = "LOC-CENTRAL",
                    staffId = "Staff-1",
                    referenceNumber = "GRN-001",
                    createdAt = "2026-10-20T09:00:00Z",
                    modifiedAt = "2026-10-20T09:00:00Z"
                ),
                lines = listOf(TransactionLineEntity("l-2", "tx-2", "MAT-0001", "Bamboo Borak", "50.0000", "PCS"))
            ),
            TransactionWithLines(
                transaction = TransactionEntity(
                    clientTxUuid = "tx-3",
                    txType = "DISPATCH",
                    txDateTime = "2026-10-20T10:00:00Z",
                    sourceLocationId = "LOC-CENTRAL",
                    destinationLocationId = "FIELD",
                    staffId = "Staff-2",
                    referenceNumber = "DSP-001",
                    createdAt = "2026-10-20T10:00:00Z",
                    modifiedAt = "2026-10-20T10:00:00Z"
                ),
                lines = listOf(TransactionLineEntity("l-3", "tx-3", "MAT-0001", "Bamboo Borak", "30.0000", "PCS"))
            ),
            TransactionWithLines(
                transaction = TransactionEntity(
                    clientTxUuid = "tx-5",
                    txType = "RETURN",
                    txDateTime = "2026-10-20T12:00:00Z",
                    sourceLocationId = "FIELD",
                    destinationLocationId = "LOC-CENTRAL",
                    staffId = "Staff-1",
                    referenceNumber = "RET-001",
                    createdAt = "2026-10-20T12:00:00Z",
                    modifiedAt = "2026-10-20T12:00:00Z"
                ),
                lines = listOf(TransactionLineEntity("l-5", "tx-5", "MAT-0001", "Bamboo Borak", "10.0000", "PCS"))
            ),
            TransactionWithLines(
                transaction = TransactionEntity(
                    clientTxUuid = "tx-6",
                    txType = "ADJUSTMENT_POS",
                    txDateTime = "2026-10-20T13:00:00Z",
                    sourceLocationId = "LOC-CENTRAL",
                    destinationLocationId = "LOC-CENTRAL",
                    staffId = "Auditor",
                    referenceNumber = "ADJ-001",
                    createdAt = "2026-10-20T13:00:00Z",
                    modifiedAt = "2026-10-20T13:00:00Z"
                ),
                lines = listOf(TransactionLineEntity("l-6", "tx-6", "MAT-0001", "Bamboo Borak", "5.0000", "PCS"))
            ),
            TransactionWithLines(
                transaction = TransactionEntity(
                    clientTxUuid = "tx-7",
                    txType = "ADJUSTMENT_NEG",
                    txDateTime = "2026-10-20T14:00:00Z",
                    sourceLocationId = "LOC-CENTRAL",
                    destinationLocationId = "LOC-CENTRAL",
                    staffId = "Auditor",
                    referenceNumber = "ADJ-002",
                    createdAt = "2026-10-20T14:00:00Z",
                    modifiedAt = "2026-10-20T14:00:00Z"
                ),
                lines = listOf(TransactionLineEntity("l-7", "tx-7", "MAT-0001", "Bamboo Borak", "2.0000", "PCS"))
            )
        )

        val centralStock = StockCalculator.calculate("MAT-0001", "LOC-CENTRAL", txs)
        assertEquals("133", centralStock.currentStock)
        assertEquals("100", centralStock.openingStock)
        assertEquals("50", centralStock.receipts)
        assertEquals("10", centralStock.acceptedReturns)
        assertEquals("30", centralStock.dispatches)
        assertEquals("5", centralStock.positiveAdjustments)
        assertEquals("2", centralStock.negativeAdjustments)

        // A location with no movements never sees this stock
        assertEquals("0", StockCalculator.calculate("MAT-0001", "LOC-BLOCK-A", txs).currentStock)
    }
}
