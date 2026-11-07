package com.campstock.inventory.ui.screens

import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.*
import com.campstock.inventory.model.FormUtil
import com.campstock.inventory.model.QtyLine
import com.campstock.inventory.sync.SyncScheduler
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** Goods receipt from a supplier: supplier, PO, GRN number and several materials in one record. */
@Composable
fun ReceiveMaterialsScreen(
    currentLocation: LocationEntity,
    dao: AppDao,
    onDone: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val suppliers by dao.getAllSuppliersFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())

    var supplier by remember { mutableStateOf<SupplierEntity?>(null) }
    var po by remember { mutableStateOf("") }
    var grn by remember { mutableStateOf("") }
    var staff by remember { mutableStateOf("") }
    var vehicleNumber by remember { mutableStateOf("") }
    var receivedBy by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<QtyLine>() }
    var showPicker by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { dao.getSetting("last_staff")?.let { if (staff.isEmpty()) staff = it } }

    val receipts = transactions.map { it.transaction }.filter { it.txType == "RECEIPT" }
    val poSuggestions = receipts.filter { supplier != null && it.supplierId == supplier?.supplierId }
        .map { it.poNumber }.filter { it.isNotBlank() }.distinct()
    val duplicateGrn = supplier != null && grn.isNotBlank() &&
        receipts.any { it.supplierId == supplier?.supplierId && it.referenceNumber.equals(grn.trim(), true) }

    fun validate(): String {
        if (supplier == null) return "Choose the supplier."
        if (grn.isBlank()) return "Enter the GRN / delivery number."
        if (duplicateGrn) return "GRN ${grn.trim()} is already recorded for ${supplier?.name}."
        if (lines.isEmpty()) return "Add at least one material."
        lines.firstOrNull { !FormUtil.isValidQty(it.qty) }?.let { return "Enter a valid quantity for ${it.material.name}." }
        if (staff.isBlank()) return "Enter the receiving staff name."
        if (FormUtil.dateToIsoInstant(date) == null) return "Date must be yyyy-MM-dd and not in the future."
        return ""
    }

    fun save() {
        val sup = supplier ?: return
        saving = true
        scope.launch {
            val uuid = UUID.randomUUID().toString()
            val now = Instant.now().toString()
            val tx = TransactionEntity(
                clientTxUuid = uuid,
                txType = "RECEIPT",
                txDateTime = FormUtil.dateToIsoInstant(date) ?: now,
                sourceLocationId = "SUPPLIER",
                destinationLocationId = currentLocation.id,
                staffId = staff.trim(),
                referenceNumber = grn.trim(),
                notes = notes.trim(),
                syncStatus = "PENDING",
                createdAt = now,
                modifiedAt = now,
                supplierId = sup.supplierId,
                supplierName = sup.name,
                poNumber = po.trim(),
                vehicleNumber = vehicleNumber.trim(),
                receivedBy = receivedBy.trim()
            )
            val txLines = lines.mapIndexed { i, l ->
                TransactionLineEntity(
                    lineId = "$uuid-line-${i + 1}",
                    clientTxUuid = uuid,
                    materialCode = l.material.code,
                    materialName = l.material.name,
                    quantity = DecimalSafe.format(DecimalSafe.parse(l.qty)),
                    unit = l.material.unit
                )
            }
            dao.saveTransactionWithLines(tx, txLines)
            dao.enqueueSync(SyncQueueEntity(clientTxUuid = uuid))
            dao.setSetting(AppSettingEntity("last_staff", staff.trim()))
            SyncScheduler.syncSoon(context)
            Toast.makeText(context, "Receipt saved (${txLines.size} materials)", Toast.LENGTH_SHORT).show()
            saving = false
            onDone()
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text("Receive Materials", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)

            StepCard(1, "Supplier & documents", "As written on the GRN") {
                SupplierPicker(dao, suppliers, supplier) { supplier = it }
                SuggestField(po, { po = it }, "PO number (optional)", poSuggestions, uppercase = true)
                OutlinedTextField(
                    grn, { grn = it }, label = { Text("GRN / delivery number") }, singleLine = true,
                    isError = duplicateGrn, modifier = Modifier.fillMaxWidth()
                )
                if (duplicateGrn) Text("This GRN is already recorded for this supplier.", color = DangerRed, fontSize = 12.sp)
            }

            StepCard(2, "Materials received", "Quantity as counted at the warehouse") {
                if (lines.isEmpty()) Text("No materials added yet.", fontSize = 13.sp, color = Slate600)
                lines.forEachIndexed { i, l ->
                    OutlinedCard(shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(l.material.name, fontWeight = FontWeight.SemiBold)
                                    Text(l.material.code, fontSize = 12.sp, color = Slate600)
                                }
                                IconButton(onClick = { lines.removeAt(i) }) { Icon(Icons.Default.Close, contentDescription = "Remove") }
                            }
                            OutlinedTextField(
                                value = l.qty,
                                onValueChange = { lines[i] = l.copy(qty = it.replace(',', '.')) },
                                label = { Text("Quantity received") },
                                suffix = { Text(l.material.unit) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
                OutlinedButton(onClick = { showPicker = true }, modifier = Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(12.dp)) {
                    Icon(Icons.Default.Add, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text(if (lines.isEmpty()) "Select materials" else "Add more materials")
                }
            }

            StepCard(3, "Receipt details") {
                OutlinedTextField(staff, { staff = it }, label = { Text("Receiving staff / entered by (name or ID)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(vehicleNumber, { vehicleNumber = it }, label = { Text("Vehicle number") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(receivedBy, { receivedBy = it }, label = { Text("Received by") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                DateField("Date received", date, { date = it })
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes (condition, batch, shortage...)") }, modifier = Modifier.fillMaxWidth())
            }
        }

        Surface(shadowElevation = 8.dp, color = MaterialTheme.colorScheme.surface) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (error.isNotEmpty()) Text(error, color = DangerRed, fontSize = 13.sp)
                Button(
                    onClick = {
                        error = validate()
                        if (error.isEmpty()) save()
                    },
                    enabled = !saving,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(12.dp)
                ) { Text(if (lines.isEmpty()) "Record receipt" else "Record receipt (${lines.size} items)") }
            }
        }
    }

    if (showPicker) {
        MaterialPickerSheet(
            dao = dao,
            materials = materials,
            balances = null,
            alreadySelected = lines.map { it.material.code }.toSet(),
            onAdd = { picked -> picked.forEach { m -> if (lines.none { it.material.code == m.code }) lines.add(QtyLine(m)) } },
            onDismiss = { showPicker = false }
        )
    }
}
