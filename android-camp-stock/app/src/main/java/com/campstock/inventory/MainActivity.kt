package com.campstock.inventory

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.campstock.inventory.data.AppDb
import com.campstock.inventory.data.LocationEntity
import com.campstock.inventory.ui.components.NAV_ITEMS
import com.campstock.inventory.ui.screens.*
import com.campstock.inventory.ui.theme.CampStockTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val database = (application as CampStockApplication).database
        val dao = database.dao()

        setContent {
            CampStockTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    CampStockApp(dao)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun CampStockApp(dao: com.campstock.inventory.data.AppDao) {
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val locations by dao.getAllLocationsFlow().collectAsState(initial = emptyList())

    var currentLocation by remember {
        mutableStateOf(
            LocationEntity("LOC-CENTRAL", "Central Camp Warehouse", "CENTRAL_WAREHOUSE", "CW")
        )
    }

    LaunchedEffect(locations) {
        if (locations.isNotEmpty() && currentLocation.id == "LOC-CENTRAL") {
            // Honour the "Designated Device Location ID" saved in Settings (was previously ignored).
            val wanted = com.campstock.inventory.sync.KoboConfig.deviceLocationId
            currentLocation = locations.firstOrNull { it.id == wanted }
                ?: locations.firstOrNull { it.id == "LOC-CENTRAL" } ?: locations.first()
        }
    }

    val appContext = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(locations) {
        // One-time Camp 13 stock balance of 18-10-2026; retried on next launch if the catalogue is not ready.
        if (locations.isNotEmpty()) {
            // Full item list: adds only the missing materials (existing ones and their units stay untouched)
            try { dao.insertMaterialsIfAbsent(com.campstock.inventory.model.AdditionalMaterials.ALL) } catch (_: Exception) {}
            try { com.campstock.inventory.model.OpeningBalance20261018.applyOnce(appContext, dao) } catch (_: Exception) {}
        }
    }

    var currentScreen by remember { mutableStateOf("dashboard") }
    var showClean by remember { mutableStateOf(false) }
    if (showClean) {
        CleanRecordsDialog(dao, onDismiss = { showClean = false }, onCleaned = { scope.launch { drawerState.close() } })
    }

    val navItems = NAV_ITEMS

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
              // Scrollable: Sync Centre and Settings sit at the bottom and were unreachable on small screens.
              Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(androidx.compose.foundation.rememberScrollState())
                    .navigationBarsPadding()
              ) {
                // Long-press the icon + title to open the PIN protected "clean local records" tool.
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .combinedClickable(onClick = {}, onLongClick = { showClean = true })
                        .padding(16.dp)
                ) {
                    Icon(Icons.Default.Inventory2, contentDescription = "Camp Stock", tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(12.dp))
                    Text("Camp Stock Inventory", style = MaterialTheme.typography.titleLarge)
                }
                Divider()
                navItems.forEach { (route, title, icon) ->
                    NavigationDrawerItem(
                        label = { Text(title) },
                        icon = { Icon(icon, contentDescription = null) },
                        selected = currentScreen == route,
                        onClick = {
                            currentScreen = route
                            scope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding)
                    )
                }
                Spacer(modifier = Modifier.height(24.dp))
              }
            }
        }
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            // Hidden entry: press and hold the title for at least 5 seconds to open IOM Stock Records.
                            Text(
                                if (currentScreen == "iom") "IOM Stock Records"
                                else navItems.firstOrNull { it.route == currentScreen }?.title ?: "Camp Stock",
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.holdToOpen(5000L) { haptic.performHapticFeedback(HapticFeedbackType.LongPress); currentScreen = "iom" }
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Default.Menu, contentDescription = "Menu")
                        }
                    },
                )
            }
        ) { paddingValues ->
            Box(modifier = Modifier.padding(paddingValues)) {
                when (currentScreen) {
                    "dashboard" -> DashboardScreen(currentLocation, dao, onNavigate = { currentScreen = it })
                    "stock" -> CurrentStockScreen(currentLocation, dao, onNavigate = { currentScreen = it })
                    "receive" -> ReceiveMaterialsScreen(currentLocation, dao, onDone = { currentScreen = "stock" })
                    "dispatch" -> DispatchMaterialsScreen(currentLocation, dao, onDone = { currentScreen = "stock" })
                    "drr" -> MrfRecordsScreen(currentLocation, dao)
                    "suppliers" -> SuppliersScreen(dao)
                    "returns" -> ReturnsScreen(currentLocation, dao, onDone = { currentScreen = "stock" })
                    "transfers" -> TransfersScreen(currentLocation, dao, onDone = { currentScreen = "stock" })
                    "adjustments" -> StockAdjustmentsScreen(currentLocation, dao)
                    "counts" -> PhysicalCountsScreen(currentLocation, dao)
                    "history" -> TransactionHistoryScreen(currentLocation, dao)
                    "daily" -> DailyRecordsScreen(currentLocation, dao)
                    "catalogue" -> MaterialCatalogueScreen(currentLocation, dao)
                    "reports" -> ReportsScreen(currentLocation, dao)
                    "iom" -> IomStockRecordsScreen()
                    "sync" -> SyncCentreScreen(dao)
                    "settings" -> SettingsScreen(dao)
                }
            }
        }
    }
}

/** Fires [onHold] only when a finger stays down for the full [millis]. A shorter press or a drag does nothing. */
private fun Modifier.holdToOpen(millis: Long, onHold: () -> Unit): Modifier = pointerInput(millis) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        val endedEarly = withTimeoutOrNull(millis) { waitForUpOrCancellation(); true }
        if (endedEarly == null) {
            onHold()
            waitForUpOrCancellation()
        }
    }
}
