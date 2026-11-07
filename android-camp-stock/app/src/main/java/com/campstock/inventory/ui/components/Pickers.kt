package com.campstock.inventory.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.*
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.util.UUID

val COMMON_UNITS = listOf("PCS", "CUM", "BUNDLE", "BAG", "KG", "ROLL", "M", "LTR", "SET")

// ---------------------------------------------------------------- layout helpers

@Composable
fun StepCard(step: Int, title: String, subtitle: String? = null, content: @Composable ColumnScope.() -> Unit) {
    ElevatedCard(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = PrimaryBlue, modifier = Modifier.size(26.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Text("$step", color = androidx.compose.ui.graphics.Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = Slate600)
                }
            }
            content()
        }
    }
}

/** Text field with tappable suggestions underneath (recent DRR codes, sub-blocks, ...). */
@Composable
fun SuggestField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    suggestions: List<String>,
    modifier: Modifier = Modifier,
    uppercase: Boolean = false,
    supportingText: String? = null
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(
            value = value,
            onValueChange = { onValueChange(if (uppercase) it.uppercase() else it) },
            label = { Text(label) },
            singleLine = true,
            supportingText = supportingText?.let { { Text(it) } },
            keyboardOptions = KeyboardOptions(capitalization = if (uppercase) KeyboardCapitalization.Characters else KeyboardCapitalization.Words),
            modifier = Modifier.fillMaxWidth()
        )
        val shown = suggestions
            .filter { value.isBlank() || (it.contains(value, ignoreCase = true) && !it.equals(value, ignoreCase = true)) }
            .take(8)
        if (shown.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(shown) { s ->
                    SuggestionChip(onClick = { onValueChange(s) }, label = { Text(s, fontSize = 12.sp) })
                }
            }
        }
    }
}

// ---------------------------------------------------------------- units & custom material

@Composable
fun UnitChooser(unit: String, onUnit: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(COMMON_UNITS) { u ->
                FilterChip(selected = unit.equals(u, true), onClick = { onUnit(u) }, label = { Text(u) })
            }
        }
        OutlinedTextField(
            value = unit,
            onValueChange = { onUnit(it.uppercase()) },
            label = { Text("Unit (type if not listed)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
fun ConfirmUnitDialog(material: MaterialEntity, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var unit by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Set unit") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(material.name, fontWeight = FontWeight.Bold)
                Text("Check the unit on the waybill / GRN before saving. Once set, it is used for every transaction of this material.", fontSize = 12.sp, color = Slate600)
                UnitChooser(unit) { unit = it }
            }
        },
        confirmButton = { Button(onClick = { onSave(unit.trim().uppercase()) }, enabled = unit.isNotBlank()) { Text("Confirm unit") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
fun CustomMaterialDialog(dao: AppDao, onDismiss: () -> Unit, onCreated: (MaterialEntity) -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add custom material") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("For items that are not in the 45-item catalogue. The catalogue itself is never changed.", fontSize = 12.sp, color = Slate600)
                OutlinedTextField(
                    value = name, onValueChange = { name = it; error = "" },
                    label = { Text("Material name") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                UnitChooser(unit) { unit = it; error = "" }
                if (error.isNotEmpty()) Text(error, color = DangerRed, fontSize = 12.sp)
            }
        },
        confirmButton = {
            Button(onClick = {
                val n = name.trim().replace(Regex("\\s+"), " ")
                val u = unit.trim().uppercase()
                if (n.isEmpty() || u.isEmpty()) { error = "Enter a name and a unit."; return@Button }
                scope.launch {
                    val existing = dao.findMaterialByName(n)
                    if (existing != null) {
                        error = "\"${existing.name}\" already exists (${existing.code}). Select it from the list instead."
                        return@launch
                    }
                    val mat = MaterialEntity(
                        code = "CUS-" + UUID.randomUUID().toString().take(6).uppercase(),
                        name = n, unit = u, isUnitConfirmed = true,
                        notes = "Custom material added on device", isCustom = true
                    )
                    dao.insertMaterialIfAbsent(mat)
                    onCreated(mat)
                }
            }) { Text("Add material") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

// ---------------------------------------------------------------- material picker (multi-select)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaterialPickerSheet(
    dao: AppDao,
    materials: List<MaterialEntity>,
    balances: Map<String, BigDecimal>?,   // null = hide stock (receiving)
    alreadySelected: Set<String>,
    onAdd: (List<MaterialEntity>) -> Unit,
    onDismiss: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    val picked = remember { mutableStateListOf<String>() }
    val extra = remember { mutableStateListOf<MaterialEntity>() }
    var unitFor by remember { mutableStateOf<MaterialEntity?>(null) }
    var showCustom by remember { mutableStateOf(false) }

    // inactive materials are hidden here; their history stays everywhere else
    val all = materials.filter { it.isActive } + extra.filter { e -> materials.none { it.code == e.code } }
    val q = query.trim().lowercase()
    val list = all.filter { q.isEmpty() || it.name.lowercase().contains(q) || it.code.lowercase().contains(q) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(modifier = Modifier.fillMaxHeight(0.92f).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Select materials", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            SearchInput(query = query, onQueryChange = { query = it }, placeholder = "Search name or code")
            OutlinedButton(onClick = { showCustom = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Default.Add, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("Add custom material")
            }
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(list, key = { it.code }) { mat ->
                    val added = mat.code in alreadySelected
                    val checked = added || mat.code in picked
                    val locked = !mat.isUnitConfirmed
                    val avail = balances?.get(mat.code) ?: BigDecimal.ZERO
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = if (checked) MaterialTheme.colorScheme.primaryContainer else Slate50,
                        border = BorderStroke(1.dp, if (checked) PrimaryBlue else Slate100),
                        modifier = Modifier.fillMaxWidth().clickable(enabled = !locked && !added) {
                            if (mat.code in picked) picked.remove(mat.code) else picked.add(mat.code)
                        }
                    ) {
                        Row(modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = checked, onCheckedChange = null, enabled = !locked && !added)
                            Spacer(Modifier.width(6.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(mat.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                                val sub = buildString {
                                    append(mat.code)
                                    if (mat.isCustom) append(" • custom")
                                    if (added) append(" • already added")
                                }
                                Text(sub, fontSize = 11.sp, color = Slate600)
                                if (balances != null && !locked) {
                                    Text(
                                        "Available: ${DecimalSafe.format(avail)} ${mat.unit}",
                                        fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                        color = if (avail.signum() <= 0) DangerRed else SuccessGreen
                                    )
                                }
                            }
                            if (locked) {
                                TextButton(onClick = { unitFor = mat }) { Text("Set unit", fontSize = 12.sp, color = WarningAmber) }
                            } else {
                                Text(mat.unit, fontSize = 12.sp, color = Slate600, modifier = Modifier.padding(end = 8.dp))
                            }
                        }
                    }
                }
                if (list.isEmpty()) {
                    item { Text("No match. Use \"Add custom material\" above.", color = Slate600, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) }
                }
            }
            Button(
                onClick = { onAdd(all.filter { it.code in picked }); onDismiss() },
                enabled = picked.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(12.dp)
            ) { Text(if (picked.isEmpty()) "Select materials" else "Add ${picked.size} material(s)") }
            Spacer(Modifier.height(8.dp))
        }
    }

    unitFor?.let { m ->
        ConfirmUnitDialog(m, onDismiss = { unitFor = null }) { u ->
            scope.launch { dao.confirmMaterialUnit(m.code, u); unitFor = null }
        }
    }
    if (showCustom) {
        CustomMaterialDialog(dao, onDismiss = { showCustom = false }) { created ->
            extra.add(created); picked.add(created.code); showCustom = false
        }
    }
}

// ---------------------------------------------------------------- suppliers

@Composable
fun SupplierDialog(dao: AppDao, existing: SupplierEntity?, onDismiss: () -> Unit, onSaved: (SupplierEntity) -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var phone by remember { mutableStateOf(existing?.phone ?: "") }
    var contact by remember { mutableStateOf(existing?.contactPerson ?: "") }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    var error by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "Add supplier" else "Edit supplier") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it; error = "" }, label = { Text("Supplier / vendor name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(phone, { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(contact, { contact = it }, label = { Text("Contact person (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, modifier = Modifier.fillMaxWidth())
                if (error.isNotEmpty()) Text(error, color = DangerRed, fontSize = 12.sp)
            }
        },
        confirmButton = {
            Button(onClick = {
                val n = name.trim().replace(Regex("\\s+"), " ")
                if (n.isEmpty()) { error = "Enter the supplier name."; return@Button }
                scope.launch {
                    val dup = dao.findSupplierByName(n)
                    if (dup != null && dup.supplierId != existing?.supplierId) {
                        error = "A supplier named \"${dup.name}\" already exists."
                        return@launch
                    }
                    val s = SupplierEntity(
                        supplierId = existing?.supplierId ?: ("SUP-" + UUID.randomUUID().toString().take(6).uppercase()),
                        name = n, phone = phone.trim(), contactPerson = contact.trim(), notes = notes.trim(),
                        isActive = existing?.isActive ?: true
                    )
                    dao.upsertSupplier(s)
                    onSaved(s)
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

/** Looks like a dropdown; opens a searchable list of suppliers. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SupplierPicker(
    dao: AppDao,
    suppliers: List<SupplierEntity>,
    selected: SupplierEntity?,
    onSelect: (SupplierEntity) -> Unit
) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var showAdd by remember { mutableStateOf(false) }

    OutlinedCard(onClick = { open = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Supplier", fontSize = 11.sp, color = Slate600)
                Text(selected?.name ?: "Tap to choose supplier", fontWeight = FontWeight.SemiBold, color = if (selected == null) Slate600 else Slate900)
            }
            Icon(Icons.Default.KeyboardArrowDown, contentDescription = null)
        }
    }

    if (open) {
        ModalBottomSheet(onDismissRequest = { open = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(modifier = Modifier.fillMaxHeight(0.8f).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Choose supplier", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                SearchInput(query = query, onQueryChange = { query = it }, placeholder = "Search suppliers")
                OutlinedButton(onClick = { showAdd = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                    Icon(Icons.Default.Add, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("Add new supplier")
                }
                val list = suppliers.filter { it.isActive && (query.isBlank() || it.name.contains(query, true)) }
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(list, key = { it.supplierId }) { s ->
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = if (s.supplierId == selected?.supplierId) MaterialTheme.colorScheme.primaryContainer else Slate50,
                            modifier = Modifier.fillMaxWidth().clickable { onSelect(s); open = false }
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(s.name, fontWeight = FontWeight.SemiBold)
                                if (s.phone.isNotBlank()) Text(s.phone, fontSize = 12.sp, color = Slate600)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
    if (showAdd) {
        SupplierDialog(dao, null, onDismiss = { showAdd = false }) { s -> showAdd = false; open = false; onSelect(s) }
    }
}
