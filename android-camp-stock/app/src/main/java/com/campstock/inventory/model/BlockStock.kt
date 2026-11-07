package com.campstock.inventory.model

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.TransactionWithLines
import java.math.BigDecimal

data class BlockRow(
    val blockId: String,
    val materialCode: String,
    val materialName: String,
    val unit: String,
    val issued: BigDecimal,     // dispatched to the block
    val returned: BigDecimal,   // returned from the block to a warehouse
    val net: BigDecimal         // issued - returned = material that should be at / used by the block
)

object BlockStock {
    /** Net material issued to each block: dispatches in, returns out. [blockIds] are the BLOCK locations. */
    fun compute(transactions: List<TransactionWithLines>, blockIds: Set<String>): List<BlockRow> {
        data class Key(val block: String, val code: String, val unit: String)
        val issued = HashMap<Key, BigDecimal>()
        val returned = HashMap<Key, BigDecimal>()
        val names = HashMap<String, String>()
        for (item in transactions) {
            val tx = item.transaction
            val (block, target) = when {
                tx.txType == "DISPATCH" && tx.destinationLocationId in blockIds -> tx.destinationLocationId to issued
                tx.txType == "RETURN" && tx.sourceLocationId in blockIds -> tx.sourceLocationId to returned
                else -> continue
            }
            for (l in item.lines) {
                val k = Key(block, l.materialCode, l.unit)
                target[k] = (target[k] ?: BigDecimal.ZERO).add(DecimalSafe.parse(l.quantity))
                names[l.materialCode] = l.materialName.ifBlank { l.materialCode }
            }
        }
        return (issued.keys + returned.keys).distinct().map { k ->
            val i = issued[k] ?: BigDecimal.ZERO
            val r = returned[k] ?: BigDecimal.ZERO
            BlockRow(k.block, k.code, names[k.code] ?: k.code, k.unit, i, r, i - r)
        }.sortedWith(compareBy({ it.blockId }, { it.materialName.lowercase() }))
    }
}
