package com.campstock.inventory

import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.sync.OpenRosaXml
import org.junit.Assert.assertTrue
import org.junit.Test

class MultiFormXmlTest {
    private fun tx(type: String, uuid: String, date: String, qty: String, damaged: String = "0") = TransactionWithLines(
        transaction = TransactionEntity(
            clientTxUuid = uuid, txType = type, txDateTime = date, sourceLocationId = "LOC-CENTRAL",
            destinationLocationId = "LOC-BLOCK-A", staffId = "S", referenceNumber = "R",
            drrCode = "C013-A", mrfNumber = "123321", subBlock = "A01", supplierName = "A & B",
            createdAt = date, modifiedAt = date
        ),
        lines = listOf(TransactionLineEntity("$uuid-1", uuid, "MAT-0001", "Bamboo Borak", qty, "PCS", damagedQuantity = damaged))
    )

    @Test
    fun routingUsesThreeForms() {
        val g = OpenRosaXml::formGroupFor
        assertTrue(listOf("RECEIPT", "DISPATCH", "RETURN").all { g(it) == OpenRosaXml.FormGroup.RECORDS })
        assertTrue(g("STAFF_HANDOVER") == OpenRosaXml.FormGroup.HANDOVER)
        assertTrue(listOf("STOCK_BASELINE", "OPENING_STOCK", "ADJUSTMENT_POS", "ADJUSTMENT_NEG").all { g(it) == OpenRosaXml.FormGroup.STOCK })
    }

    @Test
    fun recordsFormCarriesDispatchFields() {
        val xml = OpenRosaXml.buildForForm(tx("DISPATCH", "d1", "2026-10-23T06:47:15Z", "10"), "camp_stock_records", "U1")
        assertTrue(xml.contains("<camp_stock_records id=\"camp_stock_records\">"))
        assertTrue(xml.contains("<formhub><uuid>U1</uuid></formhub>"))
        assertTrue(xml.contains("<drr_code>C013-A</drr_code>") && xml.contains("<mrf_number>123321</mrf_number>") && xml.contains("<sub_block>A01</sub_block>"))
        assertTrue(xml.contains("<quantity>10</quantity><damaged_quantity>0</damaged_quantity>"))
        assertTrue(!xml.contains("handover_") && !xml.contains("<dispatch_details>"))
    }

    @Test
    fun returnKeepsDamagedQuantity() {
        val xml = OpenRosaXml.buildForForm(tx("RETURN", "r1", "2026-10-27T09:00:00Z", "4", "1"), "camp_stock_records", "U1")
        assertTrue(xml.contains("<tx_type>RETURN</tx_type>") && xml.contains("<quantity>4</quantity><damaged_quantity>1</damaged_quantity>"))
    }

    @Test
    fun receiptEscapesText() {
        val xml = OpenRosaXml.buildForForm(tx("RECEIPT", "c1", "2026-10-22T08:00:00Z", "7"), "camp_stock_records", "U2")
        assertTrue(xml.contains("A &amp; B") && xml.contains("<material_lines>") && xml.contains("<supplier_name>"))
    }

    @Test
    fun handoverFormHasHandoverFieldsOnly() {
        val item = tx("STAFF_HANDOVER", "h1", "2026-10-22T08:00:00Z", "7")
        val withNames = item.copy(transaction = item.transaction.copy(handoverFromName = "Ali", handoverToName = "Sami"))
        val xml = OpenRosaXml.buildForForm(withNames, "camp_stock_handover", "U5")
        assertTrue(xml.contains("<handover_from_name>Ali</handover_from_name>") && !xml.contains("<drr_code>") && !xml.contains("<damaged_quantity>"))
    }

    @Test
    fun stockFormHasNoDispatchFields() {
        val xml = OpenRosaXml.buildForForm(tx("ADJUSTMENT_POS", "a1", "2026-10-22T08:00:00Z", "1"), "camp_stock_stock", "U3")
        assertTrue(xml.contains("<camp_stock_stock id=\"camp_stock_stock\">") && xml.contains("<tx_type>ADJUSTMENT_POS</tx_type>"))
        assertTrue(!xml.contains("<drr_code>") && !xml.contains("<damaged_quantity>"))
    }

    @Test
    fun catalogueRecordFlags() {
        val xml = OpenRosaXml.buildCatalogueRecord("camp_stock_catalogue", "U4", "x1", "MAT-0001", "Bamboo", "PCS", false, false, "", "app")
        assertTrue(xml.contains("<unit_confirmed>no</unit_confirmed><status>inactive</status>"))
    }
}
