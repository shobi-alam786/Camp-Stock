package com.campstock.inventory.ui.components

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.*
import com.campstock.inventory.model.CatalogueOps
import com.campstock.inventory.model.FormUtil
import com.campstock.inventory.model.QtyLine
import com.campstock.inventory.sync.SyncScheduler
import com.campstock.inventory.ui.theme.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/** Scrolling form with a sticky submit button (same look as Dispatch and Receive). */
@Composable
fun FormShell(
    title: String,
    subtitle: String,
    error: String,
    buttonText: String,
    enabled: Boolean = true,
    onSubmit: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (subtitle.isNotEmpty()) Text(subtitle, fontSize = 12.sp, color = Slate600)
            content()
        }
        Surface(shadowElevation = 8.dp, color = MaterialTheme.colorScheme.surface) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (error.isNotEmpty()) Text(error, color = DangerRed, fontSize = 13.sp)
                Button(
                    onClick = onSubmit, enabled = enabled,
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(12.dp)
                ) { Text(buttonText) }
            }
        }
    }
}

/** Selected materials with a quantity box each, plus the "add materials" button. */
@Composable
fun LinesEditor(
    lines: SnapshotStateList<QtyLine>,
    qtyLabel: String,
    subtitle: (QtyLine) -> String,
    warning: (QtyLine) -> String?,
    onAdd: () -> Unit
) {
    if (lines.isEmpty()) Text("No materials added yet.", fontSize = 13.sp, color = Slate600)
    lines.forEachIndexed { i, l ->
        val warn = warning(l)
        OutlinedCard(shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(l.material.name, fontWeight = FontWeight.SemiBold)
                        Text(subtitle(l), fontSize = 12.sp, color = Slate600)
                    }
                    IconButton(onClick = { lines.removeAt(i) }) { Icon(Icons.Default.Close, contentDescription = "Remove") }
                }
                OutlinedTextField(
                    value = l.qty,
                    onValueChange = { lines[i] = l.copy(qty = it.replace(',', '.')) },
                    label = { Text(qtyLabel) },
                    suffix = { Text(l.material.unit) },
                    singleLine = true,
                    isError = warn != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth()
                )
                if (warn != null) Text(warn, color = DangerRed, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
    OutlinedButton(onClick = onAdd, modifier = Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(12.dp)) {
        Icon(Icons.Default.Add, contentDescription = null)
        Spacer(Modifier.width(6.dp))
        Text(if (lines.isEmpty()) "Select materials" else "Add more materials")
    }
}

@Composable
fun StaffDateNotes(
    staff: String, onStaff: (String) -> Unit,
    date: String, onDate: (String) -> Unit,
    notes: String, onNotes: (String) -> Unit,
    staffLabel: String = "Staff (name or ID)",
    notesLabel: String = "Notes (optional)",
    dateLabel: String = "Date"
) {
    OutlinedTextField(staff, onStaff, label = { Text(staffLabel) }, singleLine = true, modifier = Modifier.fillMaxWidth())
    DateField(dateLabel, date, onDate)
    OutlinedTextField(notes, onNotes, label = { Text(notesLabel) }, modifier = Modifier.fillMaxWidth())
}

/** Read-only date box. Tapping it opens a calendar popup. The value is always yyyy-MM-dd. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier.fillMaxWidth(),
    allowFuture: Boolean = false
) {
    var show by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        OutlinedTextField(
            value = value, onValueChange = {}, readOnly = true, singleLine = true,
            label = { Text(label) },
            trailingIcon = { Icon(Icons.Default.CalendarMonth, contentDescription = "Pick date") },
            modifier = Modifier.fillMaxWidth()
        )
        // transparent layer on top so a tap anywhere on the box opens the popup
        Box(modifier = Modifier.matchParentSize().clickable { show = true })
    }
    if (show) {
        val todayMillis = LocalDate.now().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val initial = runCatching { LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = initial,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = allowFuture || utcTimeMillis <= todayMillis
            }
        )
        DatePickerDialog(
            onDismissRequest = { show = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        onValueChange(java.time.Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString())
                    }
                    show = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { show = false }) { Text("Cancel") } }
        ) { DatePicker(state = state) }
    }
}

/** Read-only box that opens a drop-down list. [options] are (value, label) pairs. */
@Composable
fun DropdownField(
    label: String,
    selectedLabel: String,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier.fillMaxWidth()
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        OutlinedTextField(
            value = selectedLabel, onValueChange = {}, readOnly = true, singleLine = true,
            label = { Text(label) },
            trailingIcon = { Icon(Icons.Default.ArrowDropDown, contentDescription = null) },
            modifier = Modifier.fillMaxWidth()
        )
        Box(modifier = Modifier.matchParentSize().clickable { expanded = true })
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { onSelect(value); expanded = false })
            }
        }
    }
}

@Composable
fun WarningNote(text: String) {
    Text(text, color = WarningAmber, fontSize = 12.sp, fontWeight = FontWeight.Medium)
}

/** One place that saves a transaction + its lines + the upload-queue entry, then asks WorkManager to sync. */
object TxWriter {
    fun autoRef(prefix: String, date: String) =
        "$prefix-${date.replace("-", "")}-${UUID.randomUUID().toString().take(4).uppercase()}"

    suspend fun save(
        context: Context, dao: AppDao,
        type: String, dateText: String, src: String, dst: String,
        staff: String, ref: String, notes: String, items: List<QtyLine>,
        drrCode: String = "", block: String = "", subBlock: String = "", mrf: String = "",
        handoverFromName: String = "", handoverFromPhone: String = "", handoverToName: String = "",
        handoverToPhone: String = "", handoverDate: String = "",
        vehicleNumber: String = "", receivedBy: String = "", issuedBy: String = "", acknowledgementBy: String = "",
        rememberStaff: Boolean = true
    ): String {
        val uuid = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        val tx = TransactionEntity(
            clientTxUuid = uuid, txType = type,
            txDateTime = FormUtil.dateToIsoInstant(dateText) ?: now,
            sourceLocationId = src, destinationLocationId = dst,
            staffId = staff.trim(), referenceNumber = ref, notes = notes.trim(),
            syncStatus = "PENDING", createdAt = now, modifiedAt = now,
            drrCode = drrCode, block = block, subBlock = subBlock, mrfNumber = mrf,
            handoverFromName = handoverFromName.trim(), handoverFromPhone = handoverFromPhone.trim(),
            handoverToName = handoverToName.trim(), handoverToPhone = handoverToPhone.trim(), handoverDate = handoverDate,
            vehicleNumber = vehicleNumber.trim(), receivedBy = receivedBy.trim(), issuedBy = issuedBy.trim(), acknowledgementBy = acknowledgementBy.trim()
        )
        val lines = items.mapIndexed { i, l ->
            TransactionLineEntity(
                lineId = "$uuid-line-${i + 1}", clientTxUuid = uuid,
                materialCode = l.material.code, materialName = l.material.name,
                quantity = DecimalSafe.format(DecimalSafe.parse(l.qty)), unit = l.material.unit,
                damagedQuantity = DecimalSafe.format(DecimalSafe.parse(l.damagedQty.ifBlank { "0" }))
            )
        }
        dao.saveTransactionWithLines(tx, lines)
        dao.enqueueSync(SyncQueueEntity(clientTxUuid = uuid))
        if (rememberStaff && staff.isNotBlank()) dao.setSetting(AppSettingEntity("last_staff", staff.trim()))
        SyncScheduler.syncSoon(context)
        Toast.makeText(context, "Saved (${lines.size} materials)", Toast.LENGTH_SHORT).show()
        return uuid
    }

    /**
     * Saves stock-count records (see CatalogueOps.planStockCount). A plan that replaces an existing record changes that SAME
     * record (same clientTxUuid and Kobo ids) and queues it for an UPDATE; it never creates a second record or submission.
     */
    suspend fun saveStockPlans(context: Context, dao: AppDao, plans: List<CatalogueOps.StockPlan>, staff: String) {
        if (plans.isEmpty()) return
        val queued = dao.getPendingQueueItems().map { it.clientTxUuid }.toSet()
        for (plan in plans) {
            if (plan.replaces) dao.replaceTransactionContent(plan.tx, plan.lines) else dao.saveTransactionWithLines(plan.tx, plan.lines)
            if (plan.tx.clientTxUuid !in queued && plan.tx.syncStatus != "SYNCED") {
                dao.enqueueSync(SyncQueueEntity(clientTxUuid = plan.tx.clientTxUuid, action = if (plan.replaces) "UPDATE" else "SUBMIT"))
            }
        }
        if (staff.isNotBlank()) dao.setSetting(AppSettingEntity("last_staff", staff.trim()))
        SyncScheduler.syncSoon(context)
        Toast.makeText(context, "Saved (${plans.size} stock count${if (plans.size == 1) "" else "s"})", Toast.LENGTH_SHORT).show()
    }
}
