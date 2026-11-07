package com.campstock.inventory.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface AppDao {
    // --- Material Catalogue ---
    @Query("SELECT * FROM materials ORDER BY code ASC")
    fun getAllMaterialsFlow(): Flow<List<MaterialEntity>>

    @Query("SELECT * FROM materials ORDER BY code ASC")
    suspend fun getAllMaterials(): List<MaterialEntity>

    @Query("SELECT * FROM materials WHERE code = :code LIMIT 1")
    suspend fun getMaterial(code: String): MaterialEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMaterials(materials: List<MaterialEntity>)

    @Update
    suspend fun updateMaterial(material: MaterialEntity)

    @Query("UPDATE materials SET unit = :unit, isUnitConfirmed = 1 WHERE code = :code")
    suspend fun confirmMaterialUnit(code: String, unit: String)

    // IGNORE: never overwrites an existing material (the 45 catalogue names stay untouched)
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertMaterialIfAbsent(material: MaterialEntity): Long

    // IGNORE: adds only the materials that are missing; existing ones are never overwritten
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertMaterialsIfAbsent(materials: List<MaterialEntity>)

    @Query("SELECT * FROM materials WHERE name = :name COLLATE NOCASE LIMIT 1")
    suspend fun findMaterialByName(name: String): MaterialEntity?

    // --- Suppliers ---
    @Query("SELECT * FROM suppliers ORDER BY name COLLATE NOCASE ASC")
    fun getAllSuppliersFlow(): Flow<List<SupplierEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSupplier(supplier: SupplierEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertSuppliersIfAbsent(suppliers: List<SupplierEntity>)

    @Query("SELECT * FROM suppliers WHERE name = :name COLLATE NOCASE LIMIT 1")
    suspend fun findSupplierByName(name: String): SupplierEntity?

    // --- DRR suggestions (built from past dispatches, no extra table) ---
    @Query("SELECT DISTINCT drrCode, block, subBlock FROM inventory_transactions WHERE drrCode != '' ORDER BY drrCode ASC")
    fun getDrrRefsFlow(): Flow<List<DrrRef>>

    // --- Locations ---
    @Query("SELECT * FROM locations ORDER BY id ASC")
    fun getAllLocationsFlow(): Flow<List<LocationEntity>>

    @Query("SELECT * FROM locations ORDER BY id ASC")
    suspend fun getAllLocations(): List<LocationEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLocations(locations: List<LocationEntity>)

    // --- Transactions & Lines ---
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTransaction(tx: TransactionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTransactionLines(lines: List<TransactionLineEntity>)

    @Transaction
    suspend fun saveTransactionWithLines(tx: TransactionEntity, lines: List<TransactionLineEntity>) {
        insertTransaction(tx)
        insertTransactionLines(lines)
    }

    /** Replaces a record's content and lines in place (same clientTxUuid), e.g. a stock-count edit or a newer Kobo version. */
    @Transaction
    suspend fun replaceTransactionContent(tx: TransactionEntity, lines: List<TransactionLineEntity>) {
        deleteLinesOf(tx.clientTxUuid)
        insertTransaction(tx)
        insertTransactionLines(lines)
    }

    @Transaction
    @Query("SELECT * FROM inventory_transactions ORDER BY txDateTime DESC")
    fun getAllTransactionsWithLinesFlow(): Flow<List<TransactionWithLines>>

    @Transaction
    @Query("SELECT * FROM inventory_transactions ORDER BY txDateTime DESC")
    suspend fun getAllTransactionsWithLines(): List<TransactionWithLines>

    @Transaction
    @Query("SELECT * FROM inventory_transactions WHERE clientTxUuid = :uuid LIMIT 1")
    suspend fun getTransactionWithLines(uuid: String): TransactionWithLines?

    @Query("SELECT * FROM inventory_transactions WHERE syncStatus = 'PENDING' OR syncStatus = 'FAILED'")
    suspend fun getUnsyncedTransactions(): List<TransactionEntity>

    @Query("UPDATE inventory_transactions SET syncStatus = :status, koboSubmissionId = :submissionId, koboInstanceId = :instanceId, syncErrorMessage = :errorMessage WHERE clientTxUuid = :uuid")
    suspend fun updateTransactionSyncStatus(
        uuid: String,
        status: String,
        submissionId: Long?,
        instanceId: String,
        errorMessage: String
    )

    // --- Physical Stock Counts ---
    @Query("SELECT * FROM physical_stock_counts ORDER BY countDate DESC")
    fun getAllPhysicalCountsFlow(): Flow<List<PhysicalStockCountEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPhysicalCount(count: PhysicalStockCountEntity)

    @Query("UPDATE physical_stock_counts SET status = :status, approvedAdjustmentTxUuid = :txUuid WHERE countId = :countId")
    suspend fun updatePhysicalCountStatus(countId: String, status: String, txUuid: String)

    // --- Clean local records (PIN protected tool) ---
    @Query("SELECT COUNT(*) FROM inventory_transactions")
    suspend fun countAllTransactions(): Int

    @Query("SELECT COUNT(*) FROM inventory_transactions WHERE syncStatus != 'SYNCED'")
    suspend fun countUnsyncedTransactions(): Int

    @Query("DELETE FROM transaction_lines")
    suspend fun deleteAllLines()

    @Query("DELETE FROM sync_queue")
    suspend fun deleteAllQueue()

    @Query("DELETE FROM physical_stock_counts")
    suspend fun deleteAllCounts()

    @Query("DELETE FROM inventory_transactions")
    suspend fun deleteAllTransactions()

    /** Deletes every transaction, line, queue entry and physical count. Materials, suppliers, locations and settings stay. */
    @Transaction
    suspend fun wipeLocalRecords() {
        deleteAllLines()
        deleteAllQueue()
        deleteAllCounts()
        deleteAllTransactions()
    }

    // --- Drafts (records that are not in Kobo yet) ---
    @Query("DELETE FROM inventory_transactions WHERE clientTxUuid = :uuid AND syncStatus IN ('PENDING', 'FAILED') AND koboSubmissionId IS NULL")
    suspend fun deleteDraftTx(uuid: String): Int

    @Query("DELETE FROM transaction_lines WHERE clientTxUuid = :uuid")
    suspend fun deleteLinesOf(uuid: String)

    @Query("DELETE FROM sync_queue WHERE clientTxUuid = :uuid")
    suspend fun deleteQueueOf(uuid: String)

    /** Removes a draft completely (stock goes back). Only records that were never confirmed in Kobo can be deleted. */
    @Transaction
    suspend fun deleteDraft(uuid: String): Boolean {
        if (deleteDraftTx(uuid) == 0) return false
        deleteLinesOf(uuid)
        deleteQueueOf(uuid)
        return true
    }

    // --- Sync Queue ---
    @Query("SELECT * FROM sync_queue WHERE status IN ('PENDING', 'FAILED', 'OUTCOME_UNKNOWN', 'SYNCING') ORDER BY queueId ASC")
    suspend fun getPendingQueueItems(): List<SyncQueueEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueueSync(item: SyncQueueEntity): Long

    @Query("UPDATE sync_queue SET status = :status, retryCount = retryCount + 1, lastAttempt = :time, errorMessage = :error WHERE queueId = :id")
    suspend fun updateQueueItem(id: Long, status: String, time: String, error: String)

    // --- App Settings ---
    @Query("SELECT value FROM app_settings WHERE `key` = :key LIMIT 1")
    suspend fun getSetting(key: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun setSetting(setting: AppSettingEntity)
}
