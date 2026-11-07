package com.campstock.inventory.model

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.TransactionWithLines
import java.math.BigDecimal

data class MaterialStockSummary(
    val materialCode: String,
    val locationId: String,
    val openingStock: String,
    val receipts: String,
    val acceptedReturns: String,
    val dispatches: String,
    val positiveAdjustments: String,
    val negativeAdjustments: String,
    val currentStock: String
)

/**
 * A STOCK_BASELINE whose reference starts with SNAP- is a stock-count SNAPSHOT: its quantity is exactly what the user
 * typed as the stock on hand at its date/time and only movements dated after it change the stock.
 * Older baselines keep the previous rule (baseline + every movement). Same rule as the Windows app.
 */
object BaselineRules {
    const val SNAPSHOT_REF_PREFIX = "SNAP-"

    fun isSnapshot(txType: String, referenceNumber: String): Boolean =
        txType == "STOCK_BASELINE" && referenceNumber.startsWith(SNAPSHOT_REF_PREFIX)

    /** Epoch milliseconds of an ISO date/time with or without offset; 0 when it cannot be read. */
    fun instant(text: String): Long =
        try { java.time.Instant.parse(text.trim()).toEpochMilli() }
        catch (e: Exception) {
            try { java.time.OffsetDateTime.parse(text.trim()).toInstant().toEpochMilli() } catch (e2: Exception) { 0L }
        }
}

object StockCalculator {

    fun calculate(
        materialCode: String,
        locationId: String,
        transactions: List<TransactionWithLines>
    ): MaterialStockSummary {
        var legacyOpening = BigDecimal.ZERO
        var baselineTime = 0L
        var baselineQty: BigDecimal? = null
        var baselineSnapshot = false
        val moves = ArrayList<Pair<Long, BigDecimal>>() // movement date/time and signed effect
        var receipts = BigDecimal.ZERO
        var returns = BigDecimal.ZERO
        var dispatches = BigDecimal.ZERO
        var posAdj = BigDecimal.ZERO
        var negAdj = BigDecimal.ZERO

        for (item in transactions) {
            val tx = item.transaction
            for (line in item.lines) {
                if (line.materialCode != materialCode) continue
                val qty = DecimalSafe.parse(line.quantity)

                when (tx.txType) {
                    "OPENING_STOCK" -> {
                        if (tx.destinationLocationId == locationId) legacyOpening = legacyOpening.add(qty)
                    }
                    "STOCK_BASELINE" -> {
                        val at = BaselineRules.instant(tx.txDateTime)
                        if (tx.destinationLocationId == locationId && (baselineQty == null || at >= baselineTime)) {
                            baselineTime = at
                            baselineQty = qty
                            baselineSnapshot = BaselineRules.isSnapshot(tx.txType, tx.referenceNumber)
                        }
                    }
                    "RECEIPT" -> {
                        if (tx.destinationLocationId == locationId) { receipts = receipts.add(qty); moves.add(BaselineRules.instant(tx.txDateTime) to qty) }
                    }
                    "RETURN" -> {
                        if (tx.destinationLocationId == locationId) {
                            val net = qty.subtract(DecimalSafe.parse(line.damagedQuantity))
                            returns = returns.add(net); moves.add(BaselineRules.instant(tx.txDateTime) to net)
                        }
                    }
                    "DISPATCH" -> {
                        if (tx.sourceLocationId == locationId) { dispatches = dispatches.add(qty); moves.add(BaselineRules.instant(tx.txDateTime) to qty.negate()) }
                    }
                    "ADJUSTMENT_POS" -> {
                        if (tx.destinationLocationId == locationId || tx.sourceLocationId == locationId) {
                            posAdj = posAdj.add(qty); moves.add(BaselineRules.instant(tx.txDateTime) to qty)
                        }
                    }
                    "ADJUSTMENT_NEG" -> {
                        if (tx.sourceLocationId == locationId || tx.destinationLocationId == locationId) {
                            negAdj = negAdj.add(qty); moves.add(BaselineRules.instant(tx.txDateTime) to qty.negate())
                        }
                    }
                }
            }
        }

        val bq = baselineQty
        // Snapshot: current = exact quantity entered + later movements. "opening" is the value that makes the table add up.
        val opening = if (bq != null && baselineSnapshot) {
            bq.subtract(moves.filter { it.first <= baselineTime }.fold(BigDecimal.ZERO) { acc, m -> acc.add(m.second) })
        } else bq ?: legacyOpening
        val current = opening
            .add(receipts)
            .add(returns)
            .subtract(dispatches)
            .add(posAdj)
            .subtract(negAdj)

        return MaterialStockSummary(
            materialCode = materialCode,
            locationId = locationId,
            openingStock = DecimalSafe.format(opening),
            receipts = DecimalSafe.format(receipts),
            acceptedReturns = DecimalSafe.format(returns),
            dispatches = DecimalSafe.format(dispatches),
            positiveAdjustments = DecimalSafe.format(posAdj),
            negativeAdjustments = DecimalSafe.format(negAdj),
            currentStock = DecimalSafe.format(current)
        )
    }

    /**
     * One pass over the ledger: current stock of every material at one location.
     * Same rules as [calculate]; used by pickers so 45+ materials do not need 45 passes.
     */
    fun balancesFor(locationId: String, transactions: List<TransactionWithLines>): Map<String, BigDecimal> {
        val result = HashMap<String, BigDecimal>()
        val legacyOpening = HashMap<String, BigDecimal>()
        class Base(val at: Long, val q: BigDecimal, val snapshot: Boolean)
        val baselineValues = HashMap<String, Base>()
        val timedMoves = HashMap<String, MutableList<Pair<Long, BigDecimal>>>()
        for (item in transactions) {
            val tx = item.transaction
            val atDest = tx.destinationLocationId == locationId
            val atSrc = tx.sourceLocationId == locationId
            val sign = when (tx.txType) {
                "OPENING_STOCK", "RECEIPT", "RETURN" -> if (atDest) 1 else 0
                "STOCK_BASELINE" -> 0
                "ADJUSTMENT_POS" -> if (atDest || atSrc) 1 else 0
                "DISPATCH" -> if (atSrc) -1 else 0
                "ADJUSTMENT_NEG" -> if (atDest || atSrc) -1 else 0
                else -> 0
            }
            if (tx.txType == "STOCK_BASELINE" && atDest) {
                for (line in item.lines) {
                    val old = baselineValues[line.materialCode]
                    val at = BaselineRules.instant(tx.txDateTime)
                    if (old == null || at >= old.at) baselineValues[line.materialCode] = Base(at, DecimalSafe.parse(line.quantity), BaselineRules.isSnapshot(tx.txType, tx.referenceNumber))
                }
                continue
            }
            if (sign == 0) continue
            for (line in item.lines) {
                val rawQty = DecimalSafe.parse(line.quantity)
                val qty = if (tx.txType == "RETURN") rawQty.subtract(DecimalSafe.parse(line.damagedQuantity)) else rawQty
                val delta = if (sign > 0) qty else qty.negate()
                result[line.materialCode] = (result[line.materialCode] ?: BigDecimal.ZERO).add(delta)
                if (tx.txType == "OPENING_STOCK") legacyOpening[line.materialCode] = (legacyOpening[line.materialCode] ?: BigDecimal.ZERO).add(rawQty)
                else timedMoves.getOrPut(line.materialCode) { ArrayList() }.add(BaselineRules.instant(tx.txDateTime) to delta)
            }
        }
        for ((code, baseline) in baselineValues) {
            if (baseline.snapshot) {
                val after = (timedMoves[code] ?: emptyList<Pair<Long, BigDecimal>>()).filter { it.first > baseline.at }.fold(BigDecimal.ZERO) { acc, m -> acc.add(m.second) }
                result[code] = baseline.q.add(after)
            } else {
                val oldOpening = legacyOpening[code] ?: BigDecimal.ZERO
                result[code] = (result[code] ?: BigDecimal.ZERO).subtract(oldOpening).add(baseline.q)
            }
        }
        return result
    }
}
