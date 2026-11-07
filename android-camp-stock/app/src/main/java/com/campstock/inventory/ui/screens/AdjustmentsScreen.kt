package com.campstock.inventory.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import java.time.LocalDate

private val ADJUST_REASONS = listOf("Damaged", "Lost / missing", "Found / surplus", "Count correction", "Data entry error", "Other")

/** Explicit stock correction at the current location. A reason is always required. */
@Composable
fun StockAdjustmentsScreen(currentLocation: LocationEntity, dao: AppDao) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val balances = remember(transactions, currentLocation.id) { StockCalculator.balancesFor(currentLocation.id, transactions) }

    var increase by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var staff by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<QtyLine>() }
    var showPicker by remember { mutableStateOf(false) }
    var showReview by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { dao.getSetting("last_staff")?.let { if (staff.isEmpty()) staff = it } }

    fun avail(code: String): BigDecimal = balances[code] ?: BigDecimal.ZERO
    fun validate(): String {
        if (reason.isEmpty()) return "Choose the reason for this adjustment."
        if (reason == "Other" && notes.isBlank()) return "Describe the reason in the notes."
        if (lines.isEmpty()) return "Add at least one material."
        lines.firstOrNull { !FormUtil.isValidQty(it.qty) }?.let { return "Enter a valid quantity for ${it.material.name}." }
        if (staff.isBlank()) return "Enter the staff name."
        if (FormUtil.dateToIsoInstant(date) == null) return "Date must be yyyy-MM-dd and not in the future."
        return ""
    }
    fun overDraw(l: QtyLine) = !increase && FormUtil.isValidQty(l.qty) && l.qty.trim().toBigDecimal() > avail(l.material.code)

    FormShell(
        title = "Stock Adjustment",
        subtitle = "Use only to correct the record, never to hide a dispatch.",
        error = error, buttonText = "Review adjustment", enabled = !saving,
        onSubmit = { error = validate(); if (error.isEmpty()) showReview = true }
    ) {
        StepCard(1, "Direction and reason") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !increase, onClick = { increase = false }, label = { Text("Decrease (−)") })
                FilterChip(selected = increase, onClick = { increase = true }, label = { Text("Increase (+)") })
            }
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ADJUST_REASONS) { r -> FilterChip(selected = reason == r, onClick = { reason = r }, label = { Text(r) }) }
            }
        }
        StepCard(2, "Materials") {
            LinesEditor(
                lines = lines, qtyLabel = if (increase) "Quantity to add" else "Quantity to remove",
                subtitle = { l -> "${l.material.code} • Current ${DecimalSafe.format(avail(l.material.code))} ${l.material.unit}" },
                warning = { l -> if (overDraw(l)) "More than the current stock. Stock would go negative." else null },
                onAdd = { showPicker = true }
            )
        }
        StepCard(3, "Details") {
            StaffDateNotes(staff, { staff = it }, date, { date = it }, notes, { notes = it }, notesLabel = "Explanation (required for Other)")
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

    if (showReview) {
        val negative = lines.any { overDraw(it) }
        AlertDialog(
            onDismissRequest = { showReview = false },
            title = { Text(if (increase) "Confirm increase" else "Confirm decrease") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Reason: $reason", fontSize = 13.sp)
                    lines.forEach { l -> Text("• ${l.material.name}: ${if (increase) "+" else "−"}${DecimalSafe.format(DecimalSafe.parse(l.qty))} ${l.material.unit}", fontSize = 13.sp) }
                    if (negative) Text("Stock will go negative for some items.", color = DangerRed, fontSize = 12.sp)
                    Text("This creates a permanent ledger record.", fontSize = 12.sp, color = Slate600)
                }
            },
            confirmButton = {
                Button(onClick = {
                    showReview = false
                    saving = true
                    scope.launch {
                        TxWriter.save(
                            context, dao, if (increase) "ADJUSTMENT_POS" else "ADJUSTMENT_NEG", date,
                            src = currentLocation.id, dst = currentLocation.id, staff = staff,
                            ref = TxWriter.autoRef("ADJ", date),
                            notes = "Reason: $reason" + if (notes.isNotBlank()) ". ${notes.trim()}" else "",
                            items = lines.toList()
                        )
                        lines.clear(); reason = ""; notes = ""; saving = false
                    }
                }) { Text("Confirm") }
            },
            dismissButton = { TextButton(onClick = { showReview = false }) { Text("Back") } }
        )
    }
}
