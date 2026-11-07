package com.campstock.inventory

import android.app.Application
import com.campstock.inventory.data.AppDb
import com.campstock.inventory.sync.KoboConfig
import com.campstock.inventory.sync.SyncScheduler

class CampStockApplication : Application() {
    val database: AppDb by lazy { AppDb.get(this) }

    override fun onCreate() {
        super.onCreate()
        // Without this, KoboConfig had no storage: settings could not be saved and sync never ran.
        KoboConfig.init(this)
        SyncScheduler.schedulePeriodic(this)
    }
}
