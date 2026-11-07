package com.campstock.inventory.model

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.TransactionWithLines
import java.math.BigDecimal

/** One material line of one dispatch, flattened so it can be filtered and grouped. */
data class DispatchRow(
    val txUuid: String,
    val dateTime: String,
    val drrCode: String,
    val block: String,
    val subBlock: String,
    val mrfNumber: String,
    val reference: String,
    val materialCode: String,
    val materialName: String,
    val unit: String,
    val quantity: BigDecimal,      // negative for a RETURN, so totals are net of returns
    val syncStatus: String,
    val isReturn: Boolean = false
)

data class MaterialTotal(
    val materialCode: String,
    val materialName: String,
    val unit: String,
    val total: BigDecimal
)

data class DrrSummary(
    val drrCode: String,
    val block: String,
    val dispatchCount: Int,
    val materialCount: Int,
    val lastDate: String
)

/** Pure functions (no Android, no database) so they are easy to unit test. */
object DrrReport {

    const val NO_SUB_BLOCK = "(no sub-block)"
    const val NO_MRF = "(no MRF)"

    fun rows(transactions: List<TransactionWithLines>): List<DispatchRow> =
        transactions
            .filter { it.transaction.txType in setOf("DISPATCH", "RETURN") && it.transaction.drrCode.isNotBlank() }
            .flatMap { item ->
                val tx = item.transaction
                item.lines.map { line ->
                    DispatchRow(
                        txUuid = tx.clientTxUuid,
                        dateTime = tx.txDateTime,
                        drrCode = tx.drrCode.trim(),
                        block = tx.block.trim(),
                        subBlock = tx.subBlock.trim().ifEmpty { NO_SUB_BLOCK },
                        mrfNumber = tx.mrfNumber.trim().ifEmpty { NO_MRF },
                        reference = tx.referenceNumber,
                        materialCode = line.materialCode,
                        materialName = line.materialName.ifBlank { line.materialCode },
                        unit = line.unit,
                        quantity = DecimalSafe.parse(line.quantity).let { q -> if (tx.txType == "RETURN") q.negate() else q },
                        syncStatus = tx.syncStatus,
                        isReturn = tx.txType == "RETURN"
                    )
                }
            }

    fun summaries(rows: List<DispatchRow>): List<DrrSummary> =
        rows.groupBy { it.drrCode.uppercase() }.map { (_, list) ->
            DrrSummary(
                drrCode = list.first().drrCode,
                block = list.map { it.block }.firstOrNull { it.isNotEmpty() } ?: "",
                dispatchCount = list.filter { !it.isReturn }.map { it.txUuid }.distinct().size,
                materialCount = list.map { it.materialCode }.distinct().size,
                lastDate = list.maxOf { it.dateTime }
            )
        }.sortedBy { it.drrCode }

    fun forDrr(rows: List<DispatchRow>, drrCode: String): List<DispatchRow> =
        rows.filter { it.drrCode.equals(drrCode, ignoreCase = true) }

    fun subBlocksOf(rows: List<DispatchRow>): List<String> =
        rows.map { it.subBlock }.distinct().sorted()

    /** MRF numbers, limited to one sub-block when [subBlock] is given. */
    fun mrfsOf(rows: List<DispatchRow>, subBlock: String?): List<String> =
        rows.filter { subBlock == null || it.subBlock == subBlock }
            .map { it.mrfNumber }.distinct().sorted()

    fun filter(rows: List<DispatchRow>, subBlock: String?, mrf: String?, query: String): List<DispatchRow> {
        val q = query.trim().lowercase()
        return rows.filter { r ->
            (subBlock == null || r.subBlock == subBlock) &&
                (mrf == null || r.mrfNumber == mrf) &&
                (q.isEmpty() || r.materialName.lowercase().contains(q) || r.materialCode.lowercase().contains(q))
        }
    }

    fun totalsByMaterial(rows: List<DispatchRow>): List<MaterialTotal> =
        rows.groupBy { it.materialCode to it.unit }.map { (key, list) ->
            MaterialTotal(
                materialCode = key.first,
                materialName = list.first().materialName,
                unit = key.second,
                total = list.fold(BigDecimal.ZERO) { acc, r -> acc.add(r.quantity) }
            )
        }.sortedBy { it.materialName.lowercase() }

    /** Sub-block -> MRF -> rows, both levels sorted, for the "Sub-block wise" view. */
    fun groupBySubBlockAndMrf(rows: List<DispatchRow>): Map<String, Map<String, List<DispatchRow>>> =
        rows.groupBy { it.subBlock }.toSortedMap()
            .mapValues { (_, list) -> list.groupBy { it.mrfNumber }.toSortedMap() }

    fun shareText(drrCode: String, rows: List<DispatchRow>): String = buildString {
        appendLine("DRR $drrCode - materials dispatched")
        for ((sub, byMrf) in groupBySubBlockAndMrf(rows)) {
            appendLine()
            appendLine("Sub-Block: $sub")
            for ((mrf, list) in byMrf) {
                appendLine("  MRF $mrf")
                for (t in totalsByMaterial(list)) {
                    appendLine("    - ${t.materialName}: ${DecimalSafe.format(t.total)} ${t.unit}")
                }
            }
        }
        appendLine()
        appendLine("Total by material:")
        for (t in totalsByMaterial(rows)) appendLine("- ${t.materialName}: ${DecimalSafe.format(t.total)} ${t.unit}")
    }.trim()
}
