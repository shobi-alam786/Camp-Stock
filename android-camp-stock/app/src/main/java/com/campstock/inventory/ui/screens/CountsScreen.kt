package com.campstock.inventory.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.*
import com.campstock.inventory.model.FormUtil
import com.campstock.inventory.model.QtyLine
import com.campstock.inventory.model.StockCalculator
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * Physical counts never change stock by themselves. A count records system stock vs counted stock;
 * a difference stays "pending review" until someone explicitly creates an adjustment (or dismisses it).
 * Count records are kept on this device; the adjustments they create are synced like any transaction.
 */
@Composable
fun PhysicalCountsScreen(currentLocation: LocationEntity, dao: AppDao) {
    var tab by remember { mutableStateOf(0) }
    val counts by dao.getAllPhysicalCountsFlow().collectAsState(initial = emptyList())
    val pending = counts.filter { it.locationId == currentLocation.id && it.status == "PENDING_REVIEW" }

    Column(modifier = Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("New count") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Review (${pending.size})") })
        }
        if (tab == 0) NewCountForm(currentLocation, dao) { tab = 1 }
        else CountReview(currentLocation, dao, counts.filter { it.locationId == currentLocation.id })
    }
}

@Composable
private fun NewCountForm(currentLocation: LocationEntity, dao: AppDao, onSaved: () -> Unit) {
    val scope = rememberCoroutineScope()
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val balances = remember(transactions, currentLocation.id) { StockCalculator.balancesFor(currentLocation.id, transactions) }

    var staff by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<QtyLine>() }
    var showPicker by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { dao.getSetting("last_staff")?.let { if (staff.isEmpty()) staff = it } }
    fun system(code: String): BigDecimal = balances[code] ?: BigDecimal.ZERO

    FormShell(
        title = "Physical Stock Count",
        subtitle = "Count the shelf, then enter what you found.",
        error = error, buttonText = if (lines.isEmpty()) "Save count" else "Save count (${lines.size} items)", enabled = !saving,
        onSubmit = {
            error = when {
                lines.isEmpty() -> "Add at least one counted material."
                lines.any { !FormUtil.isValidCountQty(it.qty) } -> "Enter the counted quantity for every material (0 is allowed)."
                staff.isBlank() -> "Enter the name of the person who counted."
                FormUtil.dateToIsoInstant(date) == null -> "Date must be yyyy-MM-dd and not in the future."
                else -> ""
            }
            if (error.isEmpty()) {
                saving = true
                scope.launch {
                    val iso = FormUtil.dateToIsoInstant(date) ?: Instant.now().toString()
                    lines.forEach { l ->
                        val sys = system(l.material.code)
                        val counted = DecimalSafe.parse(l.qty)
                        val diff = counted - sys
                        dao.insertPhysicalCount(
                            PhysicalStockCountEntity(
                                countId = UUID.randomUUID().toString(), countDate = iso, locationId = currentLocation.id,
                                materialCode = l.material.code, unit = l.material.unit,
                                systemCalculatedQty = DecimalSafe.format(sys), physicalCountedQty = DecimalSafe.format(counted),
                                discrepancyQty = DecimalSafe.format(diff), auditedByStaffId = staff.trim(), notes = notes.trim(),
                                status = if (diff.signum() == 0) "MATCHED" else "PENDING_REVIEW"
                            )
                        )
                    }
                    dao.setSetting(AppSettingEntity("last_staff", staff.trim()))
                    lines.clear(); notes = ""; saving = false
                    onSaved()
                }
            }
        }
    ) {
        StepCard(1, "Counted materials") {
            LinesEditor(
                lines = lines, qtyLabel = "Counted quantity",
                subtitle = { l -> "System stock: ${DecimalSafe.format(system(l.material.code))} ${l.material.unit}" },
                warning = { l ->
                    if (FormUtil.isValidCountQty(l.qty)) {
                        val d = DecimalSafe.parse(l.qty) - system(l.material.code)
                        if (d.signum() != 0) "Difference ${if (d.signum() > 0) "+" else ""}${DecimalSafe.format(d)} ${l.material.unit} (kept for review, stock is not changed)" else null
                    } else null
                },
                onAdd = { showPicker = true }
            )
        }
        StepCard(2, "Details") {
            StaffDateNotes(staff, { staff = it }, date, { date = it }, notes, { notes = it }, staffLabel = "Counted by", notesLabel = "Notes (optional)")
        }
    }

    if (showPicker) {
        MaterialPickerSheet(
            dao = dao, materials = materials, balances = balances,
            alreadySelected = lines.map { it.material.code }.toSet(),
            onAdd = { picked -> picked.forEach { m -> if (lines.none { it.material.code == m.code }) lines.add(QtyLine(m)) } },
            onDismiss = { showPicker = false }
        )
    }
}

@Composable
private fun CountReview(currentLocation: LocationEntity, dao: AppDao, counts: List<PhysicalStockCountEntity>) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val balances = remember(transactions, currentLocation.id) { StockCalculator.balancesFor(currentLocation.id, transactions) }
    val names = materials.associate { it.code to it.name }
    var confirming by remember { mutableStateOf<PhysicalStockCountEntity?>(null) }

    val shown = counts.sortedByDescending { it.countDate }.sortedByDescending { it.status == "PENDING_REVIEW" }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("Count differences", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
        if (shown.isEmpty()) item { Text("No counts recorded yet.", fontSize = 13.sp, color = Slate600) }
        items(shown, key = { it.countId }) { c ->
            val diff = DecimalSafe.parse(c.discrepancyQty)
            val nowStock = balances[c.materialCode] ?: BigDecimal.ZERO
            val changed = c.status == "PENDING_REVIEW" && nowStock.compareTo(DecimalSafe.parse(c.systemCalculatedQty)) != 0
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(names[c.materialCode] ?: c.materialCode, fontWeight = FontWeight.Bold)
                    Text("${c.countDate.take(10)} • counted by ${c.auditedByStaffId}", fontSize = 12.sp, color = Slate600)
                    Text("System ${c.systemCalculatedQty} • Counted ${c.physicalCountedQty} ${c.unit}", fontSize = 13.sp)
                    Text(
                        when (c.status) {
                            "MATCHED" -> "Matched"
                            "ADJUSTMENT_CREATED" -> "Adjusted (difference ${c.discrepancyQty})"
                            "DISMISSED" -> "Dismissed (difference ${c.discrepancyQty})"
                            else -> "Difference ${if (diff.signum() > 0) "+" else ""}${c.discrepancyQty} ${c.unit}"
                        },
                        fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        color = when (c.status) { "PENDING_REVIEW" -> DangerRed; "MATCHED", "ADJUSTMENT_CREATED" -> SuccessGreen; else -> Slate600 }
                    )
                    if (changed) WarningNote("Stock has changed since this count (now ${DecimalSafe.format(nowStock)} ${c.unit}). An adjustment is blocked: dismiss this count and count again.")
                    if (c.status == "PENDING_REVIEW") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { confirming = c }, enabled = !changed, shape = RoundedCornerShape(10.dp)) { Text(if (changed) "Recount required" else "Create adjustment") }
                            OutlinedButton(onClick = { scope.launch { dao.updatePhysicalCountStatus(c.countId, "DISMISSED", "") } }, shape = RoundedCornerShape(10.dp)) { Text("Dismiss") }
                        }
                    }
                }
            }
        }
    }

    confirming?.let { c ->
        val diff = DecimalSafe.parse(c.discrepancyQty)
        AlertDialog(
            onDismissRequest = { confirming = null },
            title = { Text("Create adjustment?") },
            text = {
                Text(
                    "${names[c.materialCode] ?: c.materialCode}: ${if (diff.signum() > 0) "add" else "remove"} ${DecimalSafe.format(diff.abs())} ${c.unit} " +
                        "so the record matches the count of ${c.physicalCountedQty}. This creates a permanent ledger entry."
                )
            },
            confirmButton = {
                Button(onClick = {
                    confirming = null
                    scope.launch {
                        val mat = dao.getMaterial(c.materialCode) ?: return@launch
                        val uuid = TxWriter.save(
                            context, dao, if (diff.signum() > 0) "ADJUSTMENT_POS" else "ADJUSTMENT_NEG", c.countDate.take(10),
                            src = currentLocation.id, dst = currentLocation.id, staff = c.auditedByStaffId,
                            ref = "ADJ-CNT-" + c.countId.take(6).uppercase(),
                            notes = "Reason: Physical count ${c.countDate.take(10)}. System ${c.systemCalculatedQty}, counted ${c.physicalCountedQty}.",
                            items = listOf(QtyLine(mat, DecimalSafe.format(diff.abs())))
                        )
                        dao.updatePhysicalCountStatus(c.countId, "ADJUSTMENT_CREATED", uuid)
                    }
                }) { Text("Create") }
            },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text("Cancel") } }
        )
    }
}
