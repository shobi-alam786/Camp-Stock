package com.campstock.inventory.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector

/** One source of truth for the menu AND the dashboard tiles, so the same screen always shows the same icon. */
data class NavEntry(val route: String, val title: String, val icon: ImageVector)

val NAV_ITEMS = listOf(
    NavEntry("dashboard", "Dashboard", Icons.Default.Dashboard),
    NavEntry("stock", "Current Stock", Icons.Default.Inventory2),
    NavEntry("receive", "Receive Materials", Icons.Default.MoveToInbox),
    NavEntry("dispatch", "Dispatch Materials", Icons.Default.Outbox),
    NavEntry("drr", "Today's MRF Records", Icons.Default.Description),
    NavEntry("suppliers", "Suppliers", Icons.Default.LocalShipping),
    NavEntry("returns", "Returns", Icons.Default.AssignmentReturn),
    NavEntry("transfers", "Staff Handover", Icons.Default.SwapHoriz),
    NavEntry("adjustments", "Stock Adjustments", Icons.Default.Tune),
    NavEntry("counts", "Physical Counts", Icons.Default.FactCheck),
    NavEntry("history", "Transaction History", Icons.Default.History),
    NavEntry("daily", "Daily Records", Icons.Default.Domain),
    NavEntry("catalogue", "Material Catalogue", Icons.Default.ListAlt),
    NavEntry("reports", "Reports", Icons.Default.Assessment),
    NavEntry("sync", "Sync Centre", Icons.Default.Sync),
    NavEntry("settings", "Settings", Icons.Default.Settings)
)

/** Only these four appear as dashboard tiles (in this order); everything else is reached from the menu. */
val DASHBOARD_ROUTES = listOf("dispatch", "returns", "stock", "drr")
