package com.campstock.inventory.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.imePadding
import com.campstock.inventory.ui.components.NAV_ITEMS
import com.campstock.inventory.ui.components.DASHBOARD_ROUTES
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.*
import com.campstock.inventory.model.DailyReport
import com.campstock.inventory.model.StockCalculator
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

// 1. Dashboard Screen
@Composable
fun DashboardScreen(
    currentLocation: LocationEntity,
    dao: AppDao,
    onNavigate: (String) -> Unit
) {
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())

    val unconfirmedCount = materials.count { !it.isUnitConfirmed }
    val pendingSyncCount = transactions.count { it.transaction.syncStatus == "PENDING" || it.transaction.syncStatus == "FAILED" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Action Alerts
        if (unconfirmedCount > 0) {
            WarningBanner(
                title = "$unconfirmedCount Materials Need Unit Confirmation",
                message = "Transactions are blocked for materials without confirmed units. Confirm units in the Catalogue.",
                actionLabel = "Review Catalogue",
                onAction = { onNavigate("catalogue") }
            )
        }

        if (pendingSyncCount > 0) {
            WarningBanner(
                title = "$pendingSyncCount Transactions Pending Sync",
                message = "Transactions saved locally on device. Ready to synchronize with KoboToolbox.",
                actionLabel = "Open Sync Centre",
                onAction = { onNavigate("sync") }
            )
        }

        // Quick KPI Cards: today's activity at this location
        val today = java.time.LocalDate.now()

        fun todayCount(pick: (TransactionEntity) -> Boolean): Int =
            transactions.count {
                pick(it.transaction) &&
                    DailyReport.localDay(it.transaction.txDateTime) == today
            }

        val dispatchToday = todayCount {
            it.txType == "DISPATCH" &&
                it.sourceLocationId == currentLocation.id
        }

        val receivedToday = todayCount {
            it.txType == "RECEIPT" &&
                it.destinationLocationId == currentLocation.id
        }

        val returnsToday = todayCount {
            it.txType == "RETURN" &&
                it.destinationLocationId == currentLocation.id
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(110.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            ElevatedCard(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clickable { onNavigate("drr") }
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(10.dp),
                    verticalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Daily Dispatch",
                        fontSize = 11.sp,
                        color = Slate600,
                        maxLines = 1
                    )

                    Text(
                        "$dispatchToday",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = Slate900
                    )

                    Text("Today", fontSize = 11.sp, color = PrimaryBlue)
                }
            }

            ElevatedCard(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clickable { onNavigate("receive") }
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(10.dp),
                    verticalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Received",
                        fontSize = 11.sp,
                        color = Slate600,
                        maxLines = 1
                    )

                    Text(
                        "$receivedToday",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = Slate900
                    )

                    Text("Today", fontSize = 11.sp, color = SuccessGreen)
                }
            }

            ElevatedCard(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clickable { onNavigate("returns") }
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(10.dp),
                    verticalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Returns",
                        fontSize = 11.sp,
                        color = Slate600,
                        maxLines = 1
                    )

                    Text(
                        "$returnsToday",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = Slate900
                    )

                    Text("Today", fontSize = 11.sp, color = WarningAmber)
                }
            }
        }

        Text("Warehouse Operations", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

        // Only the four everyday tiles; all other screens live in the menu (same icons).
        val actions = DASHBOARD_ROUTES.mapNotNull { r ->
            NAV_ITEMS.firstOrNull { it.route == r }?.let { Triple(it.title, it.icon, it.route) }
        }

        for (chunk in actions.chunked(2)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (action in chunk) {
                    OutlinedCard(
                        modifier = Modifier
                            .weight(1f)
                            .height(84.dp)
                            .clickable { onNavigate(action.third) },
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(action.second, contentDescription = null, tint = PrimaryBlue, modifier = Modifier.size(24.dp))
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(action.first, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                if (chunk.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

// 2. Current Stock Screen
// Material Name | Unit | Received | Dispatched | Current Stock | Status
private val NAME_W = 170.dp
private val UNIT_W = 70.dp
private val NUM_W = 84.dp
private val STATUS_W = 92.dp

@Composable
fun CurrentStockScreen(
    currentLocation: LocationEntity,
    dao: AppDao,
    onNavigate: (String) -> Unit
) {
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    var searchQuery by remember { mutableStateOf("") }
    val hScroll = rememberScrollState()   // one scroll state: header and rows move together

    // inactive materials stay hidden unless they still hold stock at this location
    val balances = remember(transactions, currentLocation.id) { StockCalculator.balancesFor(currentLocation.id, transactions) }
    val filtered = materials.filter {
        (it.isActive || (balances[it.code]?.signum() ?: 0) != 0) &&
            (it.code.contains(searchQuery, ignoreCase = true) || it.name.contains(searchQuery, ignoreCase = true))
    }

    @Composable
    fun Cell(text: String, w: androidx.compose.ui.unit.Dp, bold: Boolean = false, color: Color = Slate900, end: Boolean = false) {
        Text(
            text, fontSize = 12.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, color = color,
            textAlign = if (end) androidx.compose.ui.text.style.TextAlign.End else androidx.compose.ui.text.style.TextAlign.Start,
            modifier = Modifier.width(w).padding(horizontal = 6.dp)
        )
    }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        SearchInput(query = searchQuery, onQueryChange = { searchQuery = it }, placeholder = "Search material name...")
        Spacer(modifier = Modifier.height(12.dp))

        Row(modifier = Modifier.horizontalScroll(hScroll).background(Slate50).padding(vertical = 8.dp)) {
            Cell("Material Name", NAME_W, bold = true, color = Slate600)
            Cell("Unit", UNIT_W, bold = true, color = Slate600)
            Cell("Received", NUM_W, bold = true, color = Slate600, end = true)
            Cell("Dispatched", NUM_W, bold = true, color = Slate600, end = true)
            Cell("Current Stock", NUM_W, bold = true, color = Slate600, end = true)
            Cell("Status", STATUS_W, bold = true, color = Slate600)
        }
        Divider(color = Slate100)

        LazyColumn {
            items(filtered, key = { it.code }) { mat ->
                val summary = StockCalculator.calculate(mat.code, currentLocation.id, transactions)
                val isNegative = DecimalSafe.isNegative(summary.currentStock)
                Row(
                    modifier = Modifier.horizontalScroll(hScroll).padding(vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Cell(mat.name, NAME_W, bold = true)
                    Cell(if (mat.isUnitConfirmed) mat.unit else "NEEDS CONF.", UNIT_W, color = if (mat.isUnitConfirmed) Slate900 else WarningAmber)
                    Cell(summary.receipts, NUM_W, end = true, color = SuccessGreen)
                    Cell(summary.dispatches, NUM_W, end = true, color = Slate600)
                    Cell(summary.currentStock, NUM_W, bold = true, end = true, color = if (isNegative) DangerRed else Slate900)
                    when {
                        isNegative -> Cell("Deficit", STATUS_W, bold = true, color = DangerRed)
                        !mat.isUnitConfirmed -> Cell("Locked", STATUS_W, color = WarningAmber)
                        else -> Cell("Available", STATUS_W, color = SuccessGreen)
                    }
                }
                Divider(color = Slate100)
            }
        }
    }
}

// 9. Transaction History Screen
@Composable
fun TransactionHistoryScreen(currentLocation: LocationEntity, dao: AppDao) {
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    var filterType by remember { mutableStateOf("ALL") }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Transaction Audit Ledger", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Append-only immutable record of all stock events.", fontSize = 12.sp, color = Slate600)
        Spacer(modifier = Modifier.height(12.dp))

        val hScroll = rememberScrollState()
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            item {
                Row(modifier = Modifier.horizontalScroll(hScroll).background(Slate100).padding(vertical = 10.dp)) {
                    Text("Date / Time", modifier = Modifier.width(145.dp).padding(horizontal = 8.dp), fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    Text("Type", modifier = Modifier.width(120.dp).padding(horizontal = 8.dp), fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    Text("Reference", modifier = Modifier.width(110.dp).padding(horizontal = 8.dp), fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    Text("Material", modifier = Modifier.width(190.dp).padding(horizontal = 8.dp), fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    Text("Quantity", modifier = Modifier.width(110.dp).padding(horizontal = 8.dp), fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    Text("Staff", modifier = Modifier.width(110.dp).padding(horizontal = 8.dp), fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    Text("Sync", modifier = Modifier.width(100.dp).padding(horizontal = 8.dp), fontWeight = FontWeight.Bold, fontSize = 11.sp)
                }
            }
            items(transactions, key = { it.transaction.clientTxUuid }) { item ->
                val tx = item.transaction
                Row(modifier = Modifier.horizontalScroll(hScroll).padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(tx.txDateTime.replace('T', ' ').take(16), modifier = Modifier.width(145.dp).padding(horizontal = 8.dp), fontSize = 11.sp)
                    Text(tx.txType, modifier = Modifier.width(120.dp).padding(horizontal = 8.dp), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    Text(tx.referenceNumber, modifier = Modifier.width(110.dp).padding(horizontal = 8.dp), fontSize = 11.sp)
                    Text(item.lines.joinToString("\n") { it.materialName }, modifier = Modifier.width(190.dp).padding(horizontal = 8.dp), fontSize = 11.sp)
                    Text(item.lines.joinToString("\n") { "${it.quantity} ${it.unit}" }, modifier = Modifier.width(110.dp).padding(horizontal = 8.dp), fontSize = 11.sp)
                    Text(tx.staffId, modifier = Modifier.width(110.dp).padding(horizontal = 8.dp), fontSize = 11.sp)
                    Text(tx.syncStatus, modifier = Modifier.width(100.dp).padding(horizontal = 8.dp), fontSize = 11.sp)
                }
                Divider(color = Slate100)
            }
        }
    }
}

// 13. Synchronization Centre Screen
@Composable
fun SyncCentreScreen(dao: AppDao) {
    val scope = rememberCoroutineScope()
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    var isBusy by remember { mutableStateOf(false) }
    var syncMessage by remember { mutableStateOf("") }
    var plan by remember { mutableStateOf<com.campstock.inventory.sync.KoboSyncManager.CloseDayPlan?>(null) }
    var deleteUuid by remember { mutableStateOf<String?>(null) }

    val pending = transactions.filter { it.transaction.syncStatus == "PENDING" }
    val unknown = transactions.filter { it.transaction.syncStatus == "OUTCOME_UNKNOWN" }
    val failed = transactions.filter { it.transaction.syncStatus == "FAILED" }
    val synced = transactions.filter { it.transaction.syncStatus == "SYNCED" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Synchronization Centre", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Records are saved as drafts on this phone. Tap Close day and sync to send them to Kobo. Once sent, a record is locked (correct it with an Adjustment).", fontSize = 12.sp, color = Slate600)

        plan?.let { p ->
            AlertDialog(
                onDismissRequest = { plan = null },
                title = { Text("Possible duplicates") },
                text = { Text(p.hits.joinToString("\n\n") { "• " + it.message } + "\n\nDelete the wrong draft, or send anyway if both are real.") },
                confirmButton = {
                    TextButton(onClick = {
                        plan = null
                        isBusy = true
                        scope.launch {
                            syncMessage = com.campstock.inventory.sync.KoboSyncManager.closeDay(dao)
                            isBusy = false
                        }
                    }) { Text("Send anyway") }
                },
                dismissButton = { TextButton(onClick = { plan = null }) { Text("Cancel") } }
            )
        }
        deleteUuid?.let { id ->
            AlertDialog(
                onDismissRequest = { deleteUuid = null },
                title = { Text("Delete this draft?") },
                text = { Text("It was never sent to Kobo. Deleting it puts the stock back.") },
                confirmButton = {
                    TextButton(onClick = {
                        deleteUuid = null
                        scope.launch { dao.deleteDraft(id) }
                    }) { Text("Delete", color = DangerRed) }
                },
                dismissButton = { TextButton(onClick = { deleteUuid = null }) { Text("Keep") } }
            )
        }

        // Drafts: saved on this phone, not in Kobo yet. They can still be deleted.
        val drafts = pending + failed + unknown
        if (drafts.isNotEmpty()) {
            val dayAgo = java.time.Instant.now().minus(java.time.Duration.ofHours(24)).toString()
            val old = drafts.count { it.transaction.createdAt.isNotEmpty() && it.transaction.createdAt < dayAgo }
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Drafts - not sent to Kobo yet (${drafts.size})", fontWeight = FontWeight.Bold)
                    Text("Check them, delete mistakes, then tap Close day and sync.", fontSize = 12.sp, color = Slate600)
                    if (old > 0) Text("$old draft(s) are older than 1 day. Sync soon so they are not lost if this phone is lost or reset.", fontSize = 12.sp, color = WarningAmber)
                    drafts.forEach { t ->
                        val x = t.transaction
                        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("${x.txType} ${x.drrCode} ${x.mrfNumber}".trim(), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                Text("${t.lines.size} material(s) • ${x.txDateTime.take(10)}", fontSize = 11.sp, color = Slate600)
                            }
                            if (x.syncStatus == "OUTCOME_UNKNOWN") {
                                Text("Network dropped - tap Close day and sync", fontSize = 11.sp, color = WarningAmber)
                            } else {
                                TextButton(onClick = { deleteUuid = x.clientTxUuid }, enabled = !isBusy) { Text("Delete", color = DangerRed) }
                            }
                        }
                    }
                }
            }
        }

        // Status Card
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Sync Queue Status", fontWeight = FontWeight.Bold)
                    Text("Last: ${com.campstock.inventory.sync.KoboConfig.lastSyncTimestamp}", fontSize = 11.sp, color = Slate600)
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("• Pending Outgoing: ${pending.size}", fontSize = 13.sp)
                    Text("• Outcome Unknown: ${unknown.size}", fontSize = 13.sp, color = if (unknown.isNotEmpty()) WarningAmber else Slate600)
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("• Confirmed Synced: ${synced.size}", fontSize = 13.sp, color = SuccessGreen)
                    Text("• Failed / Rejected: ${failed.size}", fontSize = 13.sp, color = if (failed.isNotEmpty()) DangerRed else Slate600)
                }
            }
        }

        if (unknown.isNotEmpty()) {
            WarningBanner(
                title = "${unknown.size} Ambiguous Submissions (Timeout)",
                message = "Network dropped during transmission. Sync Engine will query Kobo by client UUID before retrying to prevent duplicate stock records.",
                isError = false
            )
        }

        val problems = (failed + unknown).filter { it.transaction.syncErrorMessage.isNotBlank() }
        if (problems.isNotEmpty()) {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Why records did not sync", fontWeight = FontWeight.Bold, color = DangerRed)
                    problems.take(5).forEach { t ->
                        Text("${t.transaction.referenceNumber}: ${t.transaction.syncErrorMessage}", fontSize = 12.sp)
                    }
                    if (problems.size > 5) Text("... and ${problems.size - 5} more", fontSize = 12.sp, color = Slate600)
                }
            }
        }

        if (syncMessage.isNotEmpty()) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(syncMessage, modifier = Modifier.padding(12.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        // Actions
        Button(
            onClick = {
                isBusy = true
                scope.launch {
                    try {
                        val p = com.campstock.inventory.sync.KoboSyncManager.prepareCloseDay(dao)
                        if (p.hits.isEmpty()) {
                            syncMessage = com.campstock.inventory.sync.KoboSyncManager.closeDay(dao)
                        } else {
                            plan = p
                            syncMessage = "Possible duplicates found. Nothing was sent yet."
                        }
                    } catch (e: Exception) {
                        syncMessage = "Sync stopped: ${e.message ?: "network problem"}. Your records are safe. Tap Close day and sync again."
                    } finally {
                        isBusy = false
                    }
                }
            },
            enabled = !isBusy && com.campstock.inventory.sync.KoboConfig.isConfigured,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            if (isBusy) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Closing day...")
            } else {
                Text("Close day and sync")
            }
        }

        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Material Catalogue (Kobo)", fontWeight = FontWeight.Bold)
                Text("The catalogue lives in Kobo. Download it to update this device; upload sends only new or changed materials.", fontSize = 12.sp, color = Slate600)
                OutlinedButton(
                    onClick = {
                        isBusy = true
                        scope.launch {
                            syncMessage = com.campstock.inventory.sync.KoboSyncManager.downloadCatalogue(dao)
                            isBusy = false
                        }
                    },
                    enabled = !isBusy && com.campstock.inventory.sync.KoboConfig.isConfigured,
                    modifier = Modifier.fillMaxWidth().height(46.dp),
                    shape = RoundedCornerShape(12.dp)
                ) { Text("Download catalogue from Kobo") }
                OutlinedButton(
                    onClick = {
                        isBusy = true
                        scope.launch {
                            syncMessage = com.campstock.inventory.sync.KoboSyncManager.uploadCatalogue(dao)
                            isBusy = false
                        }
                    },
                    enabled = !isBusy && com.campstock.inventory.sync.KoboConfig.isConfigured,
                    modifier = Modifier.fillMaxWidth().height(46.dp),
                    shape = RoundedCornerShape(12.dp)
                ) { Text("Upload catalogue to Kobo") }
            }
        }

        OutlinedButton(
            onClick = {
                isBusy = true
                scope.launch {
                    val res = com.campstock.inventory.sync.KoboSyncManager.restoreLedgerFromKobo(dao)
                    syncMessage = res.message
                    isBusy = false
                }
            },
            enabled = !isBusy && com.campstock.inventory.sync.KoboConfig.isConfigured,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Restore Ledger from Kobo (Disaster Recovery)")
        }
    }
}

// 14. Settings Screen
@Composable
fun SettingsScreen(dao: AppDao) {
    val scope = rememberCoroutineScope()
    var server by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.serverUrl) }
    var formUid by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.formUid) }
    var formId by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.formId) }
    var uidHandover by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.uidHandover) }
    var uidStock by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.uidStock) }
    var uidCatalogue by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.uidCatalogue) }
    var dayEnd by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.dayEndMode) }
    var token by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.token) }
    var locationId by remember { mutableStateOf(com.campstock.inventory.sync.KoboConfig.deviceLocationId) }
    var saveMessage by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 120.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Application Settings", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Configure KoboToolbox service account credentials and device location.", fontSize = 12.sp, color = Slate600)

        OutlinedTextField(
            value = server,
            onValueChange = { server = it },
            label = { Text("Kobo Server URL") },
            modifier = Modifier.fillMaxWidth()
        )

        OutlinedTextField(
            value = formUid,
            onValueChange = { formUid = it },
            label = { Text("Records Form UID (received, dispatched, returned)") },
            modifier = Modifier.fillMaxWidth()
        )

        OutlinedTextField(
            value = uidHandover,
            onValueChange = { uidHandover = it },
            label = { Text("Staff Handover & Supplies Form UID") },
            modifier = Modifier.fillMaxWidth()
        )

        OutlinedTextField(
            value = uidStock,
            onValueChange = { uidStock = it },
            label = { Text("Stock Balance Form UID (starting balance and stock adjustments)") },
            modifier = Modifier.fillMaxWidth()
        )

        OutlinedTextField(
            value = uidCatalogue,
            onValueChange = { uidCatalogue = it },
            label = { Text("Material Catalogue Form UID") },
            modifier = Modifier.fillMaxWidth()
        )

        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Day-end sync", fontWeight = FontWeight.SemiBold)
                Text("ON: records stay drafts until you tap Close day and sync. OFF: they send automatically.", fontSize = 12.sp, color = Slate600)
            }
            Switch(checked = dayEnd, onCheckedChange = { dayEnd = it })
        }

        OutlinedTextField(
            value = formId,
            onValueChange = { formId = it },
            label = { Text("Form ID (old, not used any more - detected automatically)") },
            modifier = Modifier.fillMaxWidth()
        )

        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("Service Account API Token") },
            modifier = Modifier.fillMaxWidth()
        )

        OutlinedTextField(
            value = locationId,
            onValueChange = { locationId = it },
            label = { Text("Designated Device Location ID (e.g. LOC-CENTRAL)") },
            modifier = Modifier.fillMaxWidth()
        )

        if (saveMessage.isNotEmpty()) {
            Text(saveMessage, color = SuccessGreen, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }

        Button(
            onClick = {
                com.campstock.inventory.sync.KoboConfig.saveConfig(server, formUid, token, locationId, formId, uidHandover, uidStock, uidCatalogue)
                com.campstock.inventory.sync.KoboConfig.setDayEndMode(dayEnd)
                saveMessage = "Settings saved on this device."
            },
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Save Settings")
        }
    }
}
