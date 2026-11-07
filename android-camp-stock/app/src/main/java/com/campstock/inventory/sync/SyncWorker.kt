package com.campstock.inventory.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.campstock.inventory.data.AppDb

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        if (KoboConfig.dayEndMode) return Result.success()   // drafts wait for "Close day and sync"
        val dao = AppDb.get(applicationContext).dao()
        return try {
            val result = KoboSyncManager.processSyncQueue(dao)
            if (result.failureCount > 0 && result.successCount == 0) {
                Result.retry()
            } else {
                Result.success()
            }
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
