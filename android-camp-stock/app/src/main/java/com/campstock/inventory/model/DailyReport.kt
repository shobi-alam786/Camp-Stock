package com.campstock.inventory.model

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionWithLines
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId

/** Starting and closing balance of one material on one day. */
data class DailyBalance(
    val code: String,
    val name: String,
    val unit: String,
    val start: BigDecimal,   // stock at the start of the day (everything before that date)
    val close: BigDecimal    // stock at the end of the day
)

/** One line of "Today's MRF Records": MRF + Sub-Block + material, dispatched and returned on the day. */
data class MrfRecord(
    val mrf: String,
    val subBlock: String,
    val block: String,
    val materialCode: String,
    val materialName: String,
    val unit: String,
    val dispatchQty: BigDecimal,
    /** Total returned (damaged ones included). */
    val returnQty: BigDecimal,
    /** The damaged part of returnQty. */
    val damagedQty: BigDecimal = BigDecimal.ZERO
)

data class MrfMatchLine(
    val materialCode: String,
    val materialName: String,
    val unit: String,
    val issued: BigDecimal,
    val returned: BigDecimal
)

/** A dispatched MRF found by the Returns search. */
data class MrfMatch(
    val mrf: String,
    val block: String,
    val subBlock: String,
    val drrCode: String,
    val lastDate: String,
    val lines: List<MrfMatchLine>
)

/** Pure functions (no Android, no database). Mirrors src/utils/dailyReport.ts on the Windows app. */
object DailyReport {
    const val NO_MRF_LABEL = "(no MRF)"
    const val NO_SUB_LABEL = "-"

    /** ISO instant -> local calendar day. */
    fun localDay(iso: String, zone: ZoneId = ZoneId.systemDefault()): LocalDate? =
        runCatching { Instant.parse(iso).atZone(zone).toLocalDate() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(zone).toLocalDate() }.getOrNull()
            ?: runCatching { LocalDate.parse(iso.take(10)) }.getOrNull()

    /** +1 adds stock at the location, -1 removes it, 0 = no effect there. Same rules as StockCalculator. */
    fun sign(tx: TransactionEntity, locationId: String): Int {
        val atDest = tx.destinationLocationId == locationId
        val atSrc = tx.sourceLocationId == locationId
        return when (tx.txType) {
            "OPENING_STOCK", "RECEIPT", "RETURN" -> if (atDest) 1 else 0
            "ADJUSTMENT_POS" -> if (atDest || atSrc) 1 else 0
            "DISPATCH" -> if (atSrc) -1 else 0
            "ADJUSTMENT_NEG" -> if (atDest || atSrc) -1 else 0
            else -> 0
        }
    }

    fun balances(
        materials: List<MaterialEntity>,
        transactions: List<TransactionWithLines>,
        locationId: String,
        day: LocalDate,
        zone: ZoneId = ZoneId.systemDefault()
    ): List<DailyBalance> {
        val before = HashMap<String, BigDecimal>()
        val onDay = HashMap<String, BigDecimal>()
        for (item in transactions) {
            val sign = sign(item.transaction, locationId)
            if (sign == 0) continue
            val d = localDay(item.transaction.txDateTime, zone) ?: continue
            if (d.isAfter(day)) continue
            val target = if (d.isBefore(day)) before else onDay
            for (l in item.lines) {
                val q = DecimalSafe.parse(l.quantity).let { if (sign > 0) it else it.negate() }
                target[l.materialCode] = (target[l.materialCode] ?: BigDecimal.ZERO).add(q)
            }
        }
        return materials.map { m ->
            val s = before[m.code] ?: BigDecimal.ZERO
            DailyBalance(m.code, m.name, m.unit, s, s.add(onDay[m.code] ?: BigDecimal.ZERO))
        }
    }

    /** Dispatches to blocks and returns from blocks on one day, grouped by MRF + Sub-Block + material. */
    fun mrfRecords(
        transactions: List<TransactionWithLines>,
        locationId: String,
        day: LocalDate,
        block: String?,
        materialCode: String?,
        query: String,
        zone: ZoneId = ZoneId.systemDefault()
    ): List<MrfRecord> {
        data class Key(val mrf: String, val sub: String, val block: String, val code: String, val unit: String)
        val dispatched = LinkedHashMap<Key, BigDecimal>()
        val returned = HashMap<Key, BigDecimal>()
        val damaged = HashMap<Key, BigDecimal>()
        val names = HashMap<String, String>()
        val q = query.trim().lowercase()
        for (item in transactions) {
            val tx = item.transaction
            val isDispatch = tx.txType == "DISPATCH" && tx.sourceLocationId == locationId
            val isReturn = tx.txType == "RETURN" && tx.destinationLocationId == locationId
            if (!isDispatch && !isReturn) continue
            val blk = tx.block.trim()
            if (blk.isEmpty()) continue                       // not a block movement
            if (localDay(tx.txDateTime, zone) != day) continue
            if (block != null && blk != block) continue
            val mrf = tx.mrfNumber.trim().ifEmpty { NO_MRF_LABEL }
            val sub = tx.subBlock.trim().ifEmpty { NO_SUB_LABEL }
            for (l in item.lines) {
                if (materialCode != null && l.materialCode != materialCode) continue
                val name = l.materialName.ifBlank { l.materialCode }
                if (q.isNotEmpty() && !name.lowercase().contains(q) && !l.materialCode.lowercase().contains(q)) continue
                val k = Key(mrf, sub, blk, l.materialCode, l.unit)
                names[l.materialCode] = name
                val qty = DecimalSafe.parse(l.quantity)
                if (isDispatch) dispatched[k] = (dispatched[k] ?: BigDecimal.ZERO).add(qty)
                else {
                    returned[k] = (returned[k] ?: BigDecimal.ZERO).add(qty)
                    damaged[k] = (damaged[k] ?: BigDecimal.ZERO).add(DecimalSafe.parse(l.damagedQuantity))
                }
            }
        }
        return (dispatched.keys + returned.keys).distinct().map { k ->
            MrfRecord(k.mrf, k.sub, k.block, k.code, names[k.code] ?: k.code, k.unit,
                dispatched[k] ?: BigDecimal.ZERO, returned[k] ?: BigDecimal.ZERO, damaged[k] ?: BigDecimal.ZERO)
        }.sortedWith(compareBy({ it.mrf }, { it.subBlock }, { it.materialName.lowercase() }))
    }

    /** Dispatched MRFs whose number contains [text], newest first (for the Returns page). */
    fun searchMrf(transactions: List<TransactionWithLines>, text: String): List<MrfMatch> {
        val q = text.trim().lowercase()
        if (q.isEmpty()) return emptyList()
        data class G(val mrf: String, val block: String, val sub: String, val drr: String, var last: String,
                     val issued: LinkedHashMap<String, BigDecimal> = LinkedHashMap(),
                     val returned: HashMap<String, BigDecimal> = HashMap(),
                     val info: HashMap<String, Pair<String, String>> = HashMap())
        val groups = LinkedHashMap<String, G>()
        for (item in transactions) {
            val tx = item.transaction
            if (tx.txType != "DISPATCH" && tx.txType != "RETURN") continue
            val mrf = tx.mrfNumber.trim()
            if (mrf.isEmpty() || tx.block.isBlank() || !mrf.lowercase().contains(q)) continue
            val key = "${mrf.uppercase()}|${tx.block.trim()}|${tx.subBlock.trim().uppercase()}"
            val g = groups.getOrPut(key) { G(mrf, tx.block.trim(), tx.subBlock.trim(), tx.drrCode.trim(), tx.txDateTime) }
            if (tx.txDateTime > g.last) g.last = tx.txDateTime
            for (l in item.lines) {
                val n = DecimalSafe.parse(l.quantity)
                val map = if (tx.txType == "DISPATCH") g.issued else g.returned
                map[l.materialCode] = (map[l.materialCode] ?: BigDecimal.ZERO).add(n)
                g.info[l.materialCode] = l.materialName.ifBlank { l.materialCode } to l.unit
            }
        }
        return groups.values
            .filter { it.issued.isNotEmpty() }
            .sortedByDescending { it.last }
            .take(8)
            .map { g ->
                MrfMatch(g.mrf, g.block, g.sub, g.drr, g.last, g.issued.keys.map { code ->
                    MrfMatchLine(code, g.info[code]!!.first, g.info[code]!!.second, g.issued[code]!!, g.returned[code] ?: BigDecimal.ZERO)
                })
            }
    }
}
