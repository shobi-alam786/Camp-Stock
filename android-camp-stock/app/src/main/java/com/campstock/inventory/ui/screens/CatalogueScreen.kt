package com.campstock.inventory.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.*
import com.campstock.inventory.model.CatalogueOps
import com.campstock.inventory.model.QtyLine
import com.campstock.inventory.model.StockCalculator
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.time.LocalDate
import java.util.UUID

/**
 * Material Catalogue: add materials (one or many) with an current-stock quantity, and change each material's
 * unit, status (active / inactive) and current-stock quantity at the current location.
 * A quantity change stores the exact number typed as a stock count (one record per material and location); editing it again
 * changes that same record, so Kobo keeps one submission per material.
 */
@Composable
fun MaterialCatalogueScreen(currentLocation: LocationEntity, dao: AppDao) {
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val balances = remember(transactions, currentLocation.id) { StockCalculator.balancesFor(currentLocation.id, transactions) }

    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(0) } // 0 all, 1 active, 2 inactive, 3 needs unit
    var editing by remember { mutableStateOf<MaterialEntity?>(null) }
    var addMode by remember { mutableStateOf<String?>(null) } // "one" | "bulk"

    val q = query.trim().lowercase()
    val shown = materials
        .filter { q.isEmpty() || it.name.lowercase().contains(q) || it.code.lowercase().contains(q) }
        .filter {
            when (filter) {
                1 -> it.isActive
                2 -> !it.isActive
                3 -> !it.isUnitConfirmed
                else -> true
            }
        }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Material Catalogue (${materials.size} items)", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(
            "Current stock. Tap a material to change its unit, status or current-stock quantity.",
            fontSize = 12.sp, color = Slate600
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(onClick = { addMode = "one" }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Default.Add, contentDescription = null); Spacer(Modifier.width(4.dp)); Text("Add material")
            }
            OutlinedButton(onClick = { addMode = "bulk" }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Default.ListAlt, contentDescription = null); Spacer(Modifier.width(4.dp)); Text("Add many")
            }
        }
        SearchInput(query = query, onQueryChange = { query = it }, placeholder = "Search name or code")
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val names = listOf("All", "Active", "Inactive", "Needs unit")
            items(names.size) { i -> FilterChip(selected = filter == i, onClick = { filter = i }, label = { Text(names[i]) }) }
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
            if (shown.isEmpty()) item { Text("No materials match.", fontSize = 13.sp, color = Slate600) }
            items(shown, key = { it.code }) { mat ->
                val cur = balances[mat.code] ?: BigDecimal.ZERO
                ElevatedCard(modifier = Modifier.fillMaxWidth().clickable { editing = mat }) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(mat.name, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = if (mat.isActive) Slate900 else Slate600)
                            }
                            if (mat.isUnitConfirmed) {
                                Surface(color = Color(0xFFDCFCE7), shape = RoundedCornerShape(8.dp)) {
                                    Text(mat.unit, color = SuccessGreen, fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.padding(6.dp))
                                }
                            } else {
                                Surface(color = Color(0xFFFEF3C7), shape = RoundedCornerShape(8.dp)) {
                                    Text("NEEDS UNIT", color = WarningAmber, fontWeight = FontWeight.Bold, fontSize = 10.sp, modifier = Modifier.padding(6.dp))
                                }
                            }
                        }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(
                                "Current ${DecimalSafe.format(cur)}", fontSize = 12.sp, fontWeight = FontWeight.Bold,
                                color = if (cur.signum() < 0) DangerRed else Slate900
                            )
                            Text(if (mat.isActive) "Active" else "Inactive", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (mat.isActive) SuccessGreen else Slate600)
                        }
                    }
                }
            }
        }
    }

    editing?.let { mat ->
        EditMaterialDialog(
            material = mat, location = currentLocation, currentStock = balances[mat.code] ?: BigDecimal.ZERO,
            transactions = transactions, dao = dao, onDismiss = { editing = null }
        )
    }
    addMode?.let { mode ->
        AddMaterialsDialog(
            bulk = mode == "bulk", location = currentLocation, existingNames = materials.map { it.name },
            dao = dao, onDismiss = { addMode = null }
        )
    }
}

@Composable
private fun EditMaterialDialog(
    material: MaterialEntity, location: LocationEntity, currentStock: BigDecimal, transactions: List<TransactionWithLines>, dao: AppDao, onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(material.name) }
    var unit by remember { mutableStateOf(if (material.isUnitConfirmed) material.unit else "") }
    var active by remember { mutableStateOf(material.isActive) }
    var qty by remember { mutableStateOf(DecimalSafe.format(currentStock)) }
    var staff by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { dao.getSetting("last_staff")?.let { if (staff.isEmpty()) staff = it } }

    val qtyOk = CatalogueOps.isValidOpeningQty(qty)
    val delta = if (qtyOk) DecimalSafe.parse(qty).subtract(currentStock) else BigDecimal.ZERO
    val changed = qtyOk && delta.signum() != 0

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit ${material.code}") },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    name, { name = it; error = "" }, label = { Text("Material name") }, singleLine = true,
                    enabled = material.isCustom, modifier = Modifier.fillMaxWidth(),
                    supportingText = if (!material.isCustom) ({ Text("Names of the original 45 materials are kept as they are.") }) else null
                )
                Text("Unit", fontSize = 12.sp, color = Slate600)
                UnitChooser(unit) { unit = it; error = "" }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Status: ${if (active) "Active" else "Inactive"}", fontWeight = FontWeight.SemiBold)
                        Text("Inactive materials are hidden from the lists. History stays.", fontSize = 11.sp, color = Slate600)
                    }
                    Switch(checked = active, onCheckedChange = { active = it })
                }
                OutlinedTextField(
                    qty, { qty = it.replace(',', '.'); error = "" },
                    label = { Text("Current Stock quantity") }, singleLine = true,
                    suffix = { Text(unit) }, isError = !qtyOk,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    supportingText = { Text("Now ${DecimalSafe.format(currentStock)}. Current Stock is recalculated from this number.") },
                    modifier = Modifier.fillMaxWidth()
                )
                if (changed) {
                    OutlinedTextField(staff, { staff = it; error = "" }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
                if (error.isNotEmpty()) Text(error, color = DangerRed, fontSize = 12.sp)
            }
        },
        confirmButton = {
            Button(onClick = {
                val u = unit.trim().uppercase()
                val n = name.trim().replace(Regex("\\s+"), " ")
                error = when {
                    n.isEmpty() -> "Enter the material name."
                    u.isEmpty() -> "Enter the unit. It is needed before this material can be used."
                    !qtyOk -> "Quantity must be 0 or more, with at most 4 decimals."
                    changed && staff.isBlank() -> "Enter your name. It is saved with the quantity change."
                    else -> ""
                }
                if (error.isNotEmpty()) return@Button
                scope.launch {
                    val clash = dao.findMaterialByName(n)
                    if (clash != null && clash.code != material.code) {
                        error = "\"${clash.name}\" already exists (${clash.code})."
                        return@launch
                    }
                    val updated = material.copy(name = if (material.isCustom) n else material.name, unit = u, isUnitConfirmed = true, isActive = active)
                    dao.updateMaterial(updated)
                    if (changed) {
                        // The exact quantity typed is stored. A later edit changes the SAME record (same Kobo submission).
                        val plan = CatalogueOps.planStockCount(updated, location.id, qty, staff, transactions)
                        if (plan != null) TxWriter.saveStockPlans(context, dao, listOf(plan), staff)
                    }
                    onDismiss()
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
private fun AddMaterialsDialog(bulk: Boolean, location: LocationEntity, existingNames: List<String>, dao: AppDao, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("") }
    var text by remember { mutableStateOf("") }
    var staff by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { dao.getSetting("last_staff")?.let { if (staff.isEmpty()) staff = it } }

    val bulkRows = remember(text, existingNames, bulk) { if (bulk) CatalogueOps.parseBulk(text, existingNames) else emptyList() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (bulk) "Add many materials" else "Add material") },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!bulk) {
                    OutlinedTextField(name, { name = it; error = "" }, label = { Text("Material name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Text("Unit", fontSize = 12.sp, color = Slate600)
                    UnitChooser(unit) { unit = it; error = "" }
                    OutlinedTextField(
                        qty, { qty = it.replace(',', '.'); error = "" }, label = { Text("Current Stock quantity (optional)") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth()
                    )
                } else {
                    Text("One material per line: Name, Unit, Quantity. Quantity can be left empty. Use ; between parts if you write decimals with a comma.", fontSize = 12.sp, color = Slate600)
                    OutlinedTextField(
                        text, { text = it; error = "" }, minLines = 6,
                        placeholder = { Text("Cement, BAG, 120\nSand, CUM, 15.5\nSolar Lamp, PCS, 40") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    bulkRows.forEach { r ->
                        Text(
                            "${r.line}. ${r.name.ifEmpty { "(no name)" }} - ${r.unit.ifEmpty { "?" }} - ${r.qty}" + (r.error?.let { "  ✗ $it" } ?: "  ✓"),
                            fontSize = 12.sp, color = if (r.error != null) DangerRed else Slate900
                        )
                    }
                }
                Text("The quantity is saved as the current-stock baseline for this warehouse.", fontSize = 11.sp, color = Slate600)
                OutlinedTextField(staff, { staff = it; error = "" }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (error.isNotEmpty()) Text(error, color = DangerRed, fontSize = 12.sp)
            }
        },
        confirmButton = {
            Button(onClick = {
                val rows: List<CatalogueOps.BulkRow> = if (bulk) {
                    bulkRows
                } else {
                    CatalogueOps.parseBulk("${name.replace(Regex("[,;\t]"), " ")}, ${unit.trim()}, ${qty.trim()}", existingNames)
                }
                val bad = rows.firstOrNull { it.error != null }
                error = when {
                    rows.isEmpty() -> if (bulk) "Paste at least one line." else "Enter a name and a unit."
                    bad != null -> if (bulk) "Fix the lines marked in red first." else bad.error!!
                    rows.any { DecimalSafe.parse(it.qty).signum() != 0 } && staff.isBlank() -> "Enter your name. It is saved with the current-stock quantities."
                    else -> ""
                }
                if (error.isNotEmpty()) return@Button
                scope.launch {
                    val created = rows.map { r ->
                        r to MaterialEntity(
                            code = "CUS-" + UUID.randomUUID().toString().replace("-", "").take(6).uppercase(),
                            name = r.name, unit = r.unit, isUnitConfirmed = true,
                            notes = "Custom material added on device", isCustom = true
                        )
                    }
                    created.forEach { (_, m) -> dao.insertMaterialIfAbsent(m) }
                    val withQty = created.filter { (r, _) -> DecimalSafe.parse(r.qty).signum() != 0 }
                    if (withQty.isNotEmpty()) {
                        // one record per material (one material = one Kobo submission)
                        TxWriter.saveStockPlans(context, dao, CatalogueOps.planBaselineRecords(withQty.map { (r, m) -> m to r.qty }, location.id, staff), staff)
                    }
                    onDismiss()
                }
            }) { Text(if (bulk) "Add ${bulkRows.size} materials" else "Add material") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
