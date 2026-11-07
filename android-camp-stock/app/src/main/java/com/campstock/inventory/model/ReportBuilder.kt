package com.campstock.inventory.model

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.LocationEntity
import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.TransactionWithLines
import java.math.BigDecimal

/** CSV text reports (shared as text / opened in Excel). Pure functions, no Android. */
object ReportBuilder {

    fun csvCell(v: String): String =
        if (v.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + v.replace("\"", "\"\"") + "\"" else v

    private fun row(vararg cells: String) = cells.joinToString(",") { csvCell(it) }

    fun stockSummary(location: LocationEntity, materials: List<MaterialEntity>, balances: Map<String, BigDecimal>): String =
        buildString {
            appendLine(row("Code", "Material", "Unit", "Current stock", "Flag"))
            for (m in materials) {
                val b = balances[m.code] ?: BigDecimal.ZERO
                val flag = when {
                    !m.isUnitConfirmed -> "UNIT NOT CONFIRMED"
                    b.signum() < 0 -> "NEGATIVE"
                    else -> ""
                }
                appendLine(row(m.code, m.name, m.unit, DecimalSafe.format(b), flag))
            }
        }.trim()

    fun blockIssued(rows: List<BlockRow>, locationNames: Map<String, String>): String =
        buildString {
            appendLine(row("Block", "Code", "Material", "Unit", "Issued", "Returned", "Net"))
            for (r in rows) appendLine(row(
                locationNames[r.blockId] ?: r.blockId, r.materialCode, r.materialName, r.unit,
                DecimalSafe.format(r.issued), DecimalSafe.format(r.returned), DecimalSafe.format(r.net)
            ))
        }.trim()

    fun supplierReceipts(transactions: List<TransactionWithLines>): String =
        buildString {
            appendLine(row("Supplier", "Date", "GRN", "PO", "Code", "Material", "Quantity", "Unit"))
            transactions.filter { it.transaction.txType == "RECEIPT" }
                .sortedWith(compareBy({ it.transaction.supplierName.lowercase() }, { it.transaction.txDateTime }))
                .forEach { t ->
                    t.lines.forEach { l ->
                        appendLine(row(
                            t.transaction.supplierName, t.transaction.txDateTime.take(10), t.transaction.referenceNumber,
                            t.transaction.poNumber, l.materialCode, l.materialName, l.quantity, l.unit
                        ))
                    }
                }
        }.trim()

    fun allTransactions(transactions: List<TransactionWithLines>, locationNames: Map<String, String>): String =
        buildString {
            appendLine(row("Date", "Type", "Reference", "From", "To", "DRR", "Block", "Sub-Block", "MRF", "Supplier", "PO", "Staff", "Code", "Material", "Quantity", "Unit", "Sync"))
            transactions.sortedBy { it.transaction.txDateTime }.forEach { t ->
                val x = t.transaction
                t.lines.forEach { l ->
                    appendLine(row(
                        x.txDateTime.take(10), x.txType, x.referenceNumber,
                        locationNames[x.sourceLocationId] ?: x.sourceLocationId,
                        locationNames[x.destinationLocationId] ?: x.destinationLocationId,
                        x.drrCode, x.block, x.subBlock, x.mrfNumber, x.supplierName, x.poNumber, x.staffId,
                        l.materialCode, l.materialName, l.quantity, l.unit, x.syncStatus
                    ))
                }
            }
        }.trim()

    /** One line of the Dispatch Details sheet: DRR CODE + MRF + material. */
    data class DispatchDetailRow(
        val date: String, val drr: String, val mrf: String, val materials: String,
        val dispatched: BigDecimal, val returned: BigDecimal, val damaged: BigDecimal
    )

    /**
     * "Dispatch Details" sheet: Dispatch Date | DRR CODE | MRF | Materials | Dispatch Qty | Returned Qty | Damaged Qty.
     * One row per DRR CODE + MRF + material (matched by material name). Returned Qty is the total sent back
     * (damaged ones included); Damaged Qty is the damaged part of it. Date = earliest dispatch date.
     */
    fun dispatchDetailRows(transactions: List<TransactionWithLines>): List<DispatchDetailRow> {
        class Acc(var date: String, val drr: String, val mrf: String, val name: String) {
            var dispatched: BigDecimal = BigDecimal.ZERO
            var returned: BigDecimal = BigDecimal.ZERO
            var damaged: BigDecimal = BigDecimal.ZERO
        }
        val map = linkedMapOf<String, Acc>()
        transactions.filter { it.transaction.txType == "DISPATCH" || it.transaction.txType == "RETURN" }
            .sortedBy { it.transaction.txDateTime }
            .forEach { t ->
                val x = t.transaction
                val isReturn = x.txType == "RETURN"
                t.lines.forEach { l ->
                    val name = l.materialName.ifBlank { l.materialCode }.trim()
                    val key = listOf(x.drrCode.trim().uppercase(), x.mrfNumber.trim().uppercase(), name.uppercase()).joinToString("|")
                    val acc = map.getOrPut(key) { Acc(x.txDateTime.take(10), x.drrCode.trim(), x.mrfNumber.trim(), name) }
                    if (isReturn) {
                        acc.returned = acc.returned.add(DecimalSafe.parse(l.quantity))
                        acc.damaged = acc.damaged.add(DecimalSafe.parse(l.damagedQuantity))
                    } else {
                        if (acc.dispatched.signum() == 0 && acc.returned.signum() != 0) acc.date = x.txDateTime.take(10)
                        acc.dispatched = acc.dispatched.add(DecimalSafe.parse(l.quantity))
                    }
                }
            }
        return map.values.map { DispatchDetailRow(it.date, it.drr, it.mrf, it.name, it.dispatched, it.returned, it.damaged) }
            .sortedWith(compareBy({ it.date }, { it.drr }, { it.mrf }, { it.materials.lowercase() }))
    }

    fun dispatchDetails(transactions: List<TransactionWithLines>): String = buildString {
        appendLine(row("Dispatch Date", "DRR CODE", "MRF", "Materials", "Dispatch Qty", "Returned Qty", "Damaged Qty"))
        dispatchDetailRows(transactions).forEach { a ->
            appendLine(row(a.date, a.drr, a.mrf, a.materials,
                DecimalSafe.format(a.dispatched), DecimalSafe.format(a.returned), DecimalSafe.format(a.damaged)))
        }
    }.trim()
}
