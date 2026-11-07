package com.campstock.inventory.ui.screens

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import android.widget.Toast
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.model.IomRecords
import com.campstock.inventory.model.IomBalanceWorkbook
import com.campstock.inventory.security.IomAccess
import com.campstock.inventory.sync.IomClient
import com.campstock.inventory.ui.components.DateField
import com.campstock.inventory.ui.components.DropdownField
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.LocalDate

private const val PAGE = 200

/** Read-only view of IOM Camp 13 stock records. Never writes to Camp Stock records or balances. */
@Composable
fun IomStockRecordsScreen() {
    var unlocked by remember { mutableStateOf(false) }
    if (unlocked) IomRecordsContent() else IomGate(onUnlocked = { unlocked = true })
}

@Composable
private fun IomRecordsContent() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var settings by remember { mutableStateOf(IomAccess.load(context)) }
    var showConn by remember { mutableStateOf(false) }
    var rangeMode by remember { mutableStateOf(false) }
    var from by remember { mutableStateOf(LocalDate.now().toString()) }
    var to by remember { mutableStateOf(LocalDate.now().toString()) }
    var filters by remember { mutableStateOf(IomRecords.Filters()) }
    var rows by remember { mutableStateOf<List<IomRecords.Row>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var limit by remember { mutableStateOf(PAGE) }
    var showTotals by remember { mutableStateOf(false) }
    var showBalance by remember { mutableStateOf(false) }
    var balanceRows by remember { mutableStateOf<List<IomBalanceWorkbook.Row>>(emptyList()) }
    var balanceBusy by remember { mutableStateOf(false) }
    var balanceError by remember { mutableStateOf("") }
    BackHandler(enabled = showTotals || showBalance) {
        if (showBalance) showBalance = false else showTotals = false
    }

    val openBalance = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            balanceBusy = true
            balanceError = ""
            scope.launch {
                val result = runCatching {
                    withContext(Dispatchers.IO) {
                        val file = File.createTempFile("iom-balance-", ".xlsx", context.cacheDir)
                        try {
                            context.contentResolver.openInputStream(uri)?.use { input ->
                                file.outputStream().use { output -> input.copyTo(output) }
                            } ?: throw IllegalArgumentException("Could not open the selected workbook.")
                            IomBalanceWorkbook.read(file)
                        } finally {
                            file.delete()
                        }
                    }
                }
                balanceBusy = false
                result.onSuccess { imported ->
                    balanceRows = imported
                    showBalance = true
                }.onFailure { error ->
                    balanceError = error.message ?: "Could not read the BALANCE - CAMP worksheet."
                }
            }
        }
    }

    val effTo = if (rangeMode) to else from
    val csvName = "iom-stock-records-$from" + (if (rangeMode) "_to_$to" else "") + ".csv"
    var pendingCsv by remember { mutableStateOf("") }
    val saveCsv = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri != null) {
            val ok = runCatching {
                context.contentResolver.openOutputStream(uri)?.use { it.write(("\uFEFF" + pendingCsv).toByteArray(Charsets.UTF_8)) } != null
            }.getOrDefault(false)
            Toast.makeText(context, if (ok) "CSV saved." else "Could not save the CSV.", Toast.LENGTH_LONG).show()
        }
        pendingCsv = ""
    }
    // Excel: one workbook with 4 sheets (All records, Received, Dispatched, Returned)
    var pendingXlsx by remember { mutableStateOf<ByteArray?>(null) }
    val saveXlsx = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) { uri ->
        val bytes = pendingXlsx
        if (uri != null && bytes != null) {
            val ok = runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } != null }.getOrDefault(false)
            Toast.makeText(context, if (ok) "Excel file saved." else "Could not save the Excel file.", Toast.LENGTH_LONG).show()
        }
        pendingXlsx = null
    }
    val tableScroll = rememberScrollState()
    val visible = remember(rows, from, effTo, filters) { IomRecords.filter(rows, from, effTo, filters) }
    val totals = remember(visible) { IomRecords.totals(visible) }
    val submissionsShown = remember(visible) { visible.map { it.koboId }.toSet().size }
    val types = remember(rows) { IomRecords.distinct(rows) { it.inventoryType } }

    fun load() {
        if (rangeMode && from > to) { error = "The start date is after the end date."; return }
        busy = true; error = ""; message = ""; progress = ""; limit = PAGE
        scope.launch {
            val res = IomClient.fetch(settings, from, effTo) { n, t -> progress = "Loaded $n of $t submissions..." }
            busy = false; progress = ""
            if (res.error != null) { error = res.error; return@launch }
            rows = res.rows; loaded = true
            message = "${res.submissions} submission(s) loaded for ${if (rangeMode) "$from to $to" else from}" +
                if (res.skippedDuplicates > 0) ", ${res.skippedDuplicates} duplicate(s) skipped." else "."
        }
    }

    if (showBalance) {
        IomBalanceView(rows = balanceRows, onBack = { showBalance = false })
        return
    }

    if (showTotals) {
        IomTotalsView(
            totals = totals, lines = visible.size,
            period = if (rangeMode) "$from to $to" else from,
            onBack = { showTotals = false }
        )
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Text("IOM Stock Records", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("Read-only IOM records for Camp 13. Nothing here changes Camp Stock records or balances.", fontSize = 12.sp, color = Slate600)
        }
        item {
            TextButton(onClick = { showConn = !showConn }) {
                Text(if (showConn) "Hide connection" else "Connection")
            }
            if (showConn) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        "", { v -> IomRecords.parseDataUrl(v)?.let { (srv, id) -> settings = settings.copy(server = srv, uid = id) } },
                        label = { Text("Paste Kobo data URL (fills Server and Form UID)") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(settings.server, { settings = settings.copy(server = it) }, label = { Text("Server") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(settings.uid, { settings = settings.copy(uid = it) }, label = { Text("Form UID") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(
                        settings.token, { settings = settings.copy(token = it) }, label = { Text("API token (optional, only if the data is not public)") },
                        singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedButton(onClick = { IomAccess.save(context, settings); message = "Connection saved on this device." }) { Text("Save connection") }
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = rangeMode, onCheckedChange = { rangeMode = it })
                    Spacer(Modifier.width(8.dp))
                    Text("Date range")
                }
                DateField(if (rangeMode) "From (entry date)" else "Entry date", from, { from = it }, allowFuture = true)
                if (rangeMode) DateField("To (entry date)", to, { to = it }, allowFuture = true)
                Button(onClick = { load() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (busy) "Loading..." else "Load from IOM Kobo")
                }
                OutlinedButton(
                    onClick = {
                        openBalance.launch(arrayOf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                    },
                    enabled = !balanceBusy,
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (balanceBusy) "Importing workbook..." else "Import BALANCE - CAMP Excel") }
                if (balanceError.isNotEmpty()) Text(balanceError, fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                if (progress.isNotEmpty()) Text(progress, fontSize = 12.sp, color = Slate600)
                if (message.isNotEmpty()) Text(message, fontSize = 12.sp, color = SuccessGreen, fontWeight = FontWeight.Medium)
                if (error.isNotEmpty()) Text(error, fontSize = 12.sp, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Medium)
            }
        }
        if (loaded) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(filters.material, { filters = filters.copy(material = it) }, label = { Text("Material") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    DropdownField(
                        "Type", if (filters.type.isEmpty()) "All" else filters.type,
                        listOf("" to "All") + types.map { it to it },
                        { filters = filters.copy(type = it) }
                    )
                    OutlinedTextField(
                        filters.search, { filters = filters.copy(search = it) }, label = { Text("Search DRR code or MRF") },
                        placeholder = { Text("Type a DRR code or MRF number") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedButton(onClick = { showTotals = true }, enabled = totals.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                        Text("Totals by material (${totals.size})")
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Text("$submissionsShown submission(s), ${visible.size} material line(s)", fontSize = 12.sp, color = Slate600)
                        Row {
                            TextButton(enabled = visible.isNotEmpty(), onClick = {
                                pendingCsv = IomRecords.toCsv(visible)
                                saveCsv.launch(csvName)
                            }) { Text("CSV") }
                            TextButton(enabled = visible.isNotEmpty(), onClick = {
                                pendingXlsx = com.campstock.inventory.model.IomExcel.workbook(visible)
                                saveXlsx.launch(csvName.removeSuffix(".csv") + ".xlsx")
                            }) { Text("Excel (4 sheets)") }
                            TextButton(enabled = visible.isNotEmpty(), onClick = {
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/csv"
                                    putExtra(Intent.EXTRA_SUBJECT, "IOM stock records $from")
                                    putExtra(Intent.EXTRA_TEXT, IomRecords.toCsv(visible))
                                }
                                context.startActivity(Intent.createChooser(send, "Share CSV"))
                            }) { Text("Share") }
                        }
                    }
                }
            }
            if (visible.isEmpty()) {
                item { Text("No records match.", color = Slate600, fontSize = 13.sp) }
            }
            if (visible.isNotEmpty()) {
                item { IomTableRow(tableScroll, header = true, cells = IOM_HEADERS) }
            }
            items(visible.take(limit), key = { it.rowKey }) { r ->
                IomTableRow(
                    tableScroll, header = false,
                    cells = listOf(
                        r.entryDate,
                        r.inventoryType + if (r.inventorySubType.isNotEmpty()) " • ${r.inventorySubType}" else "",
                        r.mrfNo.ifEmpty { r.waybillNo },
                        r.drrCode,
                        r.item.ifEmpty { "(no material)" },
                        IomRecords.formatQty(r.quantity),
                        r.unit
                    )
                )
            }
            if (visible.size > limit) {
                item { TextButton(onClick = { limit += PAGE }, modifier = Modifier.fillMaxWidth()) { Text("Show more (${visible.size - limit} left)") } }
            }
        }
    }
}

/** Read-only BALANCE - CAMP values copied from cached Excel cells; no formulas are evaluated. */
@Composable
private fun IomBalanceView(rows: List<IomBalanceWorkbook.Row>, onBack: () -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        item {
            TextButton(onClick = onBack) { Text("← Back to IOM Stock Records") }
            Text("BALANCE - CAMP", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("${rows.size} items", fontSize = 12.sp, color = Slate600)
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth().background(Slate100).padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Items", fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.weight(2f))
                Text("Unit", fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.weight(1f))
                Text("TOTAL", fontWeight = FontWeight.Bold, fontSize = 12.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
            }
            HorizontalDivider()
        }
        if (rows.isEmpty()) {
            item { Text("No balance rows to show.", color = Slate600, fontSize = 13.sp) }
        }
        itemsIndexed(rows, key = { index, _ -> index }) { _, row ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(row.item, fontSize = 13.sp, modifier = Modifier.weight(2f))
                Text(row.unit, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Text(row.total, fontSize = 13.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
            }
            HorizontalDivider()
        }
    }
}

/** Separate screen: totals per material in two columns (Material | Total). Follows the filters on the records screen. */
@Composable
private fun IomTotalsView(totals: List<IomRecords.Total>, lines: Int, period: String, onBack: () -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        item {
            TextButton(onClick = onBack) { Text("← Back to IOM Stock Records") }
            Text("Totals by material", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                "$period · ${totals.size} material(s) from $lines line(s). Totals follow the filters on the records screen.",
                fontSize = 12.sp, color = Slate600
            )
        }
        item {
            Column {
                Row(modifier = Modifier.fillMaxWidth().background(Slate100).padding(horizontal = 8.dp, vertical = 8.dp)) {
                    Text("Material", fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text("Total", fontWeight = FontWeight.Bold, fontSize = 12.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                }
                HorizontalDivider()
            }
        }
        if (totals.isEmpty()) {
            item { Text("No totals to show.", color = Slate600, fontSize = 13.sp) }
        }
        items(totals, key = { "${it.item}|${it.unit}" }) { t ->
            Column {
                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
                    Text(t.item.ifEmpty { "(no material)" }, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    Text(
                        "${IomRecords.formatQty(t.total.toPlainString())} ${t.unit}".trim(),
                        fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End, modifier = Modifier.weight(1f)
                    )
                }
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun IomGate(onUnlocked: () -> Unit) {
    val context = LocalContext.current
    var pw by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var wait by remember { mutableStateOf(IomAccess.lockedSeconds(context)) }

    LaunchedEffect(wait) {
        if (wait > 0) { delay(1000); wait = IomAccess.lockedSeconds(context) }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)
    ) {
        Text("IOM Stock Records", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Enter the access password to continue.", fontSize = 12.sp, color = Slate600)
        OutlinedTextField(
            value = pw, onValueChange = { pw = it }, label = { Text("Password") }, singleLine = true, enabled = wait == 0,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth()
        )
        if (wait > 0) Text("Locked. Try again in $wait seconds.", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
        else if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
        Button(
            enabled = pw.isNotEmpty() && wait == 0, modifier = Modifier.fillMaxWidth(),
            onClick = {
                when (val r = IomAccess.verify(context, pw)) {
                    is IomAccess.Result.Ok -> onUnlocked()
                    is IomAccess.Result.Wrong -> { error = "Wrong password. ${r.triesLeft} tries left."; pw = "" }
                    is IomAccess.Result.Locked -> { wait = r.seconds; pw = "" }
                }
            }
        ) { Text("Open") }
    }
}

private val IOM_HEADERS = listOf("Date", "Type", "MRF / Waybill", "DRR", "Material", "Qty", "Unit")
private val IOM_COL_WIDTHS: List<Dp> = listOf(90.dp, 130.dp, 100.dp, 170.dp, 150.dp, 70.dp, 60.dp)
private const val IOM_QTY_COL = 5

/** One table row. Every row shares one horizontal scroll state, so header and rows slide together. */
@Composable
private fun IomTableRow(scroll: androidx.compose.foundation.ScrollState, header: Boolean, cells: List<String>) {
    val bg = if (header) Slate100 else androidx.compose.ui.graphics.Color.Transparent
    Column {
        Row(modifier = Modifier.fillMaxWidth().horizontalScroll(scroll).background(bg).padding(vertical = 6.dp)) {
            cells.forEachIndexed { i, text ->
                Text(
                    text, fontSize = 12.sp,
                    fontWeight = if (header || i == IOM_QTY_COL) FontWeight.Bold else FontWeight.Normal,
                    textAlign = if (i == IOM_QTY_COL) TextAlign.End else TextAlign.Start,
                    modifier = Modifier.width(IOM_COL_WIDTHS[i]).padding(horizontal = 6.dp)
                )
            }
        }
        HorizontalDivider()
    }
}
