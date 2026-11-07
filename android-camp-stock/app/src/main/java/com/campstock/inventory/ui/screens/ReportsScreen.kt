package com.campstock.inventory.ui.screens

import android.content.Intent
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import com.campstock.inventory.data.AppDao
import com.campstock.inventory.data.LocationEntity
import com.campstock.inventory.model.BlockStock
import com.campstock.inventory.model.ReportBuilder
import com.campstock.inventory.model.StockCalculator
import com.campstock.inventory.ui.theme.*

private val REPORTS = listOf("Stock summary", "Issued to blocks", "Supplier receipts", "Dispatch Details", "All transactions", "Excel files")

/** CSV reports. "Share" sends the CSV text to WhatsApp / Email / Drive; it opens in Excel when saved as .csv. */
@Composable
fun ReportsScreen(currentLocation: LocationEntity, dao: AppDao) {
    val context = LocalContext.current
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val locations by dao.getAllLocationsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    var kind by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var kobo by remember { mutableStateOf("") }

    val names = locations.associate { it.id to it.name }
    val csv = remember(kind, materials, locations, transactions, currentLocation.id) {
        when (kind) {
            0 -> ReportBuilder.stockSummary(currentLocation, materials, StockCalculator.balancesFor(currentLocation.id, transactions))
            1 -> ReportBuilder.blockIssued(BlockStock.compute(transactions, locations.filter { it.type == "BLOCK" }.map { it.id }.toSet()), names)
            2 -> ReportBuilder.supplierReceipts(transactions)
            3 -> ReportBuilder.dispatchDetails(transactions)
            4 -> ReportBuilder.allTransactions(transactions, names)
            else -> ""
        }
    }
    val lineCount = csv.lines().size

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Reports", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Stock summary of all materials.", fontSize = 12.sp, color = Slate600)
        Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            REPORTS.forEachIndexed { i, r -> FilterChip(selected = kind == i, onClick = { kind = i }, label = { Text(r) }) }
        }
        if (kind == 5) {
            ExcelPanel(currentLocation, dao, materials, names)
        } else {
        if (kind == 3) {
            OutlinedButton(
                onClick = {
                    busy = true
                    scope.launch {
                        // pulls records from the other phones / the Windows app, so this sheet covers everything in Kobo
                        kobo = com.campstock.inventory.sync.KoboSyncManager.restoreLedgerFromKobo(dao).message
                        busy = false
                    }
                },
                enabled = !busy && com.campstock.inventory.sync.KoboConfig.isConfigured,
                shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().height(48.dp)
            ) { Text(if (busy) "Updating from Kobo..." else "Update from Kobo first") }
            if (kobo.isNotEmpty()) Text(kobo, fontSize = 12.sp, color = Slate600)
        }
        Button(
            onClick = {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "Camp Stock - ${REPORTS[kind]}")
                    putExtra(Intent.EXTRA_TEXT, csv)
                }
                context.startActivity(Intent.createChooser(send, "Share report"))
            },
            enabled = lineCount > 1,
            shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().height(48.dp)
        ) { Icon(Icons.Default.Share, contentDescription = null); Spacer(Modifier.width(8.dp)); Text("Share ${REPORTS[kind]} (CSV)") }
        Text("Preview ($lineCount lines)", fontSize = 12.sp, color = Slate600)
        Surface(shape = RoundedCornerShape(12.dp), color = Slate50, modifier = Modifier.weight(1f).fillMaxWidth()) {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(10.dp)) {
                Text(
                    if (lineCount > 1) csv.lines().take(60).joinToString("\n") + if (lineCount > 60) "\n... (${lineCount - 60} more lines in the shared file)" else ""
                    else "No data for this report yet.",
                    fontFamily = FontFamily.Monospace, fontSize = 11.sp
                )
            }
        }
        }
    }
}

/** Three Excel files, each with separate sheets: Records (4), Staff Handover & Supplies (2), Stock balances (2). */
@Composable
private fun ExcelPanel(currentLocation: LocationEntity, dao: AppDao, materials: List<com.campstock.inventory.data.MaterialEntity>, names: Map<String, String>) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val suppliers by dao.getAllSuppliersFlow().collectAsState(initial = emptyList())
    var from by remember { mutableStateOf(java.time.LocalDate.now().toString()) }
    var to by remember { mutableStateOf(java.time.LocalDate.now().toString()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<ByteArray?>(null) }
    val save = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    ) { uri ->
        val bytes = pending
        if (uri != null && bytes != null) {
            val ok = runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } != null }.getOrDefault(false)
            message = if (ok) "Excel file saved." else "Could not save the Excel file."
        }
        pending = null
    }
    val fromDate = runCatching { java.time.LocalDate.parse(from) }.getOrNull()
    val toDate = runCatching { java.time.LocalDate.parse(to) }.getOrNull()
    val rangeError = when {
        fromDate == null || toDate == null -> "Choose both dates."
        fromDate.isAfter(toDate) -> "The start date is after the end date."
        java.time.temporal.ChronoUnit.DAYS.between(fromDate, toDate) >= com.campstock.inventory.model.AppExcel.MAX_STOCK_DAYS -> "Choose at most ${com.campstock.inventory.model.AppExcel.MAX_STOCK_DAYS} days."
        else -> ""
    }

    // Pulls the newest records from Kobo first (when set up), then builds the file from everything on this phone.
    fun export(fileName: String, build: (List<com.campstock.inventory.data.TransactionWithLines>) -> ByteArray) {
        busy = true; message = ""
        scope.launch {
            runCatching {
                if (com.campstock.inventory.sync.KoboConfig.isConfigured) com.campstock.inventory.sync.KoboSyncManager.restoreLedgerFromKobo(dao)
            }
            val all = dao.getAllTransactionsWithLines()
            pending = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { build(all) }
            busy = false
            save.launch(fileName)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.verticalScroll(rememberScrollState())) {
        Text("Each button makes one Excel file with separate sheets. Records are updated from Kobo first when Kobo is set up.", fontSize = 12.sp, color = Slate600)
        Button(
            onClick = { export("camp-stock-records-${java.time.LocalDate.now()}.xlsx") { com.campstock.inventory.model.AppExcel.recordsWorkbook(it, names) } },
            enabled = !busy, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().height(48.dp)
        ) { Text(if (busy) "Preparing..." else "Records (4 sheets)") }
        Text("All records, Received, Dispatched, Returned.", fontSize = 11.sp, color = Slate600)
        Button(
            onClick = { export("camp-stock-handover-supplies-${java.time.LocalDate.now()}.xlsx") { com.campstock.inventory.model.AppExcel.handoverSuppliersWorkbook(it, suppliers, names) } },
            enabled = !busy, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().height(48.dp)
        ) { Text(if (busy) "Preparing..." else "Staff Handover & Supplies (2 sheets)") }
        Text("Staff Handover (with items) and Supplies (suppliers with their deliveries).", fontSize = 11.sp, color = Slate600)
        Text("Stock balances - ${currentLocation.name}", fontWeight = FontWeight.SemiBold)
        com.campstock.inventory.ui.components.DateField("From", from, { from = it })
        com.campstock.inventory.ui.components.DateField("To", to, { to = it })
        if (rangeError.isNotEmpty()) Text(rangeError, fontSize = 12.sp, color = androidx.compose.ui.graphics.Color(0xFFDC2626))
        Button(
            onClick = {
                val f = fromDate!!; val t = toDate!!
                export("camp-stock-balances-$from" + (if (to != from) "_to_$to" else "") + ".xlsx") {
                    com.campstock.inventory.model.AppExcel.stockWorkbook(materials, it, currentLocation.id, f, t)
                }
            },
            enabled = !busy && rangeError.isEmpty(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().height(48.dp)
        ) { Text(if (busy) "Preparing..." else "Stock Balances (5 sheets)") }
        Text("Material list, Starting Balance, Current Balance, Stock Adjustments and Daily Closing Balance.", fontSize = 11.sp, color = Slate600)
        if (message.isNotEmpty()) Text(message, fontSize = 12.sp, color = Slate600)
    }
}
