package com.campstock.inventory.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

const val UNIT_NEEDS_CONFIRMATION = "NEEDS_CONFIRMATION"

@Entity(tableName = "materials")
data class MaterialEntity(
    @PrimaryKey val code: String,
    val name: String,
    val unit: String = UNIT_NEEDS_CONFIRMATION,
    val isUnitConfirmed: Boolean = false,
    val notes: String = "",
    // true = added on a device by a user (not one of the 45 catalogue items)
    val isCustom: Boolean = false,
    // false = hidden from the material pickers (history stays). Local to this device. Added in database version 3.
    val isActive: Boolean = true
)

@Entity(tableName = "suppliers")
data class SupplierEntity(
    @PrimaryKey val supplierId: String,
    val name: String,
    val phone: String = "",
    val contactPerson: String = "",
    val notes: String = "",
    val isActive: Boolean = true
)

@Entity(tableName = "locations")
data class LocationEntity(
    @PrimaryKey val id: String,
    val name: String,
    val type: String, // CENTRAL_WAREHOUSE, BLOCK, OTHER_WAREHOUSE
    val code: String
)

@Entity(
    tableName = "inventory_transactions",
    indices = [
        Index(value = ["clientTxUuid"], unique = true),
        Index(value = ["txType"]),
        Index(value = ["sourceLocationId"]),
        Index(value = ["destinationLocationId"]),
        Index(value = ["transferRef"]),
        Index(value = ["syncStatus"])
    ]
)
data class TransactionEntity(
    @PrimaryKey val clientTxUuid: String,
    val txType: String,             // OPENING_STOCK (legacy), STOCK_BASELINE, RECEIPT, DISPATCH, RETURN, ADJUSTMENT_POS, ADJUSTMENT_NEG, STAFF_HANDOVER (never changes stock)
    val txDateTime: String,         // ISO-8601 string
    val sourceLocationId: String,
    val destinationLocationId: String,
    val staffId: String,
    val referenceNumber: String,
    val transferRef: String = "",
    val notes: String = "",
    val syncStatus: String = "PENDING", // PENDING, SYNCING, SYNCED, OUTCOME_UNKNOWN, FAILED
    val koboSubmissionId: Long? = null,
    val koboInstanceId: String = "",
    val syncErrorMessage: String = "",
    val createdAt: String,
    val modifiedAt: String,
    // --- Added in database version 2 (all optional, empty = not applicable) ---
    val drrCode: String = "",       // DISPATCH to a block: the DRR project the material is for
    val block: String = "",         // "A".."G" for dispatches to a block
    val subBlock: String = "",
    val mrfNumber: String = "",     // Material Request Form number
    val supplierId: String = "",    // RECEIPT: supplier
    val supplierName: String = "",  // copied so the ledger stays readable if the supplier is edited
    val poNumber: String = "",      // RECEIPT: purchase order number
    // --- Added in database version 3: STAFF_HANDOVER only (empty = not applicable) ---
    val handoverFromName: String = "",
    val handoverFromPhone: String = "",
    val handoverToName: String = "",
    val handoverToPhone: String = "",
    val handoverDate: String = "",   // yyyy-MM-dd
    // Paper-register fields (database v4)
    val vehicleNumber: String = "",
    val receivedBy: String = "",
    val issuedBy: String = "",
    val acknowledgementBy: String = ""
)

@Entity(
    tableName = "transaction_lines",
    indices = [
        Index(value = ["clientTxUuid"]),
        Index(value = ["materialCode"])
    ]
)
data class TransactionLineEntity(
    @PrimaryKey val lineId: String,
    val clientTxUuid: String,
    val materialCode: String,
    val materialName: String,
    val quantity: String,           // Decimal-safe string representation
    val unit: String,
    val notes: String = "",
    val damagedQuantity: String = "0"
)

@Entity(tableName = "physical_stock_counts")
data class PhysicalStockCountEntity(
    @PrimaryKey val countId: String,
    val countDate: String,
    val locationId: String,
    val materialCode: String,
    val unit: String,
    val systemCalculatedQty: String,
    val physicalCountedQty: String,
    val discrepancyQty: String,
    val auditedByStaffId: String,
    val approvedAdjustmentTxUuid: String = "",
    val notes: String = "",
    val status: String = "PENDING_REVIEW" // PENDING_REVIEW, ADJUSTMENT_CREATED, DISMISSED
)

@Entity(
    tableName = "sync_queue",
    indices = [
        Index(value = ["clientTxUuid"]),
        Index(value = ["status"])
    ]
)
data class SyncQueueEntity(
    @PrimaryKey(autoGenerate = true) val queueId: Long = 0,
    val clientTxUuid: String,
    val action: String = "SUBMIT",
    val status: String = "PENDING", // PENDING, SYNCING, SYNCED, OUTCOME_UNKNOWN, FAILED
    val retryCount: Int = 0,
    val lastAttempt: String = "",
    val errorMessage: String = ""
)

@Entity(tableName = "app_settings")
data class AppSettingEntity(
    @PrimaryKey val key: String,
    val value: String
)

// Not a table: result of a DISTINCT query used for DRR-CODE / Sub-Block suggestions.
data class DrrRef(
    val drrCode: String,
    val block: String,
    val subBlock: String
)
