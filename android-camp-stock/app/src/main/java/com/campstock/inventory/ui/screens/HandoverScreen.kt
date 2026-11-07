package com.campstock.inventory.ui.screens

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
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
import com.campstock.inventory.model.CatalogueOps
import com.campstock.inventory.model.QtyLine
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.launch
import java.time.LocalDate

private fun handoverText(item: TransactionWithLines, locationName: String): String = buildString {
    val t = item.transaction
    appendLine("STAFF HANDOVER - STOCK BALANCE")
    appendLine("Ref: ${t.referenceNumber}")
    appendLine("Date: ${t.handoverDate}")
    appendLine()
    appendLine("Handing over: ${t.handoverFromName} (${t.handoverFromPhone})")
    appendLine("Taking over: ${t.handoverToName} (${t.handoverToPhone})")
    appendLine()
    if (item.lines.isEmpty()) appendLine("No stock at this location.")
    item.lines.forEach { appendLine("- ${it.materialName}: ${it.quantity} ${it.unit}") }
    if (t.notes.isNotBlank()) { appendLine(); appendLine("Notes: ${t.notes}") }
}

private fun share(context: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
    context.startActivity(Intent.createChooser(send, "Share handover").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/**
 * Staff changes camp: the leaving staff hands the current stock balance to the next staff.
 * Saves a STAFF_HANDOVER record (both names, both phones, date, balance of every material). Stock is not changed.
 */
@Composable
fun StaffHandoverTab(currentLocation: LocationEntity, dao: AppDao) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val snapshot = remember(materials, transactions, currentLocation.id) {
        CatalogueOps.handoverSnapshot(materials, currentLocation.id, transactions)
    }
    val history = remember(transactions, currentLocation.id) {
        transactions
            .filter { it.transaction.txType == "STAFF_HANDOVER" && it.transaction.sourceLocationId == currentLocation.id }
            .sortedWith(compareByDescending<TransactionWithLines> { it.transaction.handoverDate }.thenByDescending { it.transaction.createdAt })
    }

    var fromName by remember { mutableStateOf("") }
    var fromPhone by remember { mutableStateOf("") }
    var toName by remember { mutableStateOf("") }
    var toPhone by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var notes by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    FormShell(
        title = "Staff Handover", subtitle = "Use this when a staff member changes camp. Stock itself does not change.",
        error = error, buttonText = "Record staff handover", enabled = !saving,
        onSubmit = {
            error = CatalogueOps.validateHandover(CatalogueOps.HandoverInput(fromName, fromPhone, toName, toPhone, date))
            if (error.isEmpty()) {
                saving = true
                scope.launch {
                    TxWriter.save(
                        context, dao, "STAFF_HANDOVER", date, src = currentLocation.id, dst = currentLocation.id,
                        staff = fromName, ref = TxWriter.autoRef("HO", date), notes = notes,
                        items = snapshot.map { (m, b) -> QtyLine(m, DecimalSafe.format(b)) },
                        handoverFromName = fromName, handoverFromPhone = fromPhone,
                        handoverToName = toName, handoverToPhone = toPhone, handoverDate = date,
                        rememberStaff = false
                    )
                    fromName = ""; fromPhone = ""; toName = ""; toPhone = ""; notes = ""
                    saving = false
                }
            }
        }
    ) {
        StepCard(1, "Handing over (leaving staff)") {
            OutlinedTextField(fromName, { fromName = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                fromPhone, { fromPhone = it }, label = { Text("Phone number") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth()
            )
        }
        StepCard(2, "Taking over (next staff)") {
            OutlinedTextField(toName, { toName = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                toPhone, { toPhone = it }, label = { Text("Phone number") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth()
            )
        }
        StepCard(3, "Date") {
            DateField("Handover date", date, { date = it })
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, modifier = Modifier.fillMaxWidth())
        }
        StepCard(4, "Stock balance being handed over", "${snapshot.size} materials with a balance") {
            if (snapshot.isEmpty()) Text("No stock recorded at this location.", fontSize = 13.sp, color = Slate600)
            snapshot.forEach { (m, b) ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(m.name, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    Text(
                        "${DecimalSafe.format(b)} ${m.unit}", fontSize = 13.sp, fontWeight = FontWeight.Bold,
                        color = if (b.signum() < 0) DangerRed else Slate900
                    )
                }
            }
        }

        Text("Past handovers", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (history.isEmpty()) Text("No staff handovers recorded here yet.", fontSize = 13.sp, color = Slate600)
        history.forEach { item ->
            val t = item.transaction
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("${t.handoverDate} • ${t.referenceNumber}", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        IconButton(onClick = { share(context, handoverText(item, currentLocation.name)) }) {
                            Icon(Icons.Default.Share, contentDescription = "Share")
                        }
                    }
                    Text("${t.handoverFromName} (${t.handoverFromPhone}) → ${t.handoverToName} (${t.handoverToPhone})", fontSize = 12.sp)
                    Text("${item.lines.size} material balance(s) recorded", fontSize = 12.sp, color = Slate600)
                }
            }
        }
    }
}
