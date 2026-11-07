package com.campstock.inventory.ui.screens

import androidx.compose.runtime.Composable
import com.campstock.inventory.data.AppDao
import com.campstock.inventory.data.LocationEntity

/** This screen now holds only Staff Handover (stock transfers between warehouses were removed). */
@Composable
fun TransfersScreen(currentLocation: LocationEntity, dao: AppDao, onDone: () -> Unit) {
    StaffHandoverTab(currentLocation, dao)
}
