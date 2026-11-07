package com.campstock.inventory.data

import androidx.room.Embedded
import androidx.room.Relation

data class TransactionWithLines(
    @Embedded val transaction: TransactionEntity,
    @Relation(
        parentColumn = "clientTxUuid",
        entityColumn = "clientTxUuid"
    )
    val lines: List<TransactionLineEntity>
)
