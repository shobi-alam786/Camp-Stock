package com.campstock.inventory.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private val needsNetwork = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /** Background sync every 15 minutes (Android's minimum), only when a network is available. */
    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(needsNetwork)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork("camp_stock_periodic_sync", ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** Try to upload right after a transaction is saved (runs as soon as there is network). */
    fun syncSoon(context: Context) {
        if (KoboConfig.dayEndMode) return   // drafts wait for "Close day and sync"
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(needsNetwork)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("camp_stock_sync_now", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
}
