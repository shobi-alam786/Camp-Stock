
package com.campstock.inventory.ui.screens

import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import com.campstock.inventory.model.DrrReport
import com.campstock.inventory.model.FormUtil
import com.campstock.inventory.model.QtyLine
import com.campstock.inventory.model.StockCalculator
import com.campstock.inventory.sync.SyncScheduler
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * Dispatch (direct, no manager approval).
 * Flow: 1 Project (DRR-CODE, block, sub-block, MRF) -> 2 Materials (multi-select) -> 3 Details -> Review.
 */
@Composable
fun DispatchMaterialsScreen(
    currentLocation: LocationEntity,
    dao: AppDao,
    onDone: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val locations by dao.getAllLocationsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val drrRefs by dao.getDrrRefsFlow().collectAsState(initial = emptyList())

    val balances = remember(transactions, currentLocation.id) {
        StockCalculator.balancesFor(currentLocation.id, transactions)
    }
    val dispatchRows = remember(transactions) { DrrReport.rows(transactions) }

    val destinations = locations.filter { it.id != currentLocation.id }
        .sortedWith(compareBy({ it.type != "BLOCK" }, { it.id }))

    var destId by remember { mutableStateOf("") }
    var blockMode by remember { mutableStateOf(false) }
    var drr by remember { mutableStateOf("") }
    var subBlock by remember { mutableStateOf("") }
    var mrf by remember { mutableStateOf("") }
    var voucher by remember { mutableStateOf("") }
    var staff by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<QtyLine>() }
    var showPicker by remember { mutableStateOf(false) }
    var showReview by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        dao.getSetting("last_staff")?.let {
            if (staff.isEmpty()) staff = it
        }
    }

    val blockDests = destinations.filter { it.type == "BLOCK" }
    val warehouseDests = destinations.filter { it.type != "BLOCK" }
    val dest = destinations.firstOrNull { it.id == destId }
    val isBlock = dest?.type == "BLOCK"

    val drrCodes = drrRefs.map { it.drrCode }.distinct()
    val subBlockSuggestions = drrRefs
        .filter { it.drrCode.equals(drr.trim(), true) }
        .map { it.subBlock }
        .filter { it.isNotBlank() }
        .distinct()

    val mrfSuggestions = dispatchRows
        .filter {
            it.drrCode.equals(drr.trim(), true) &&
                (subBlock.isBlank() || it.subBlock.equals(subBlock.trim(), true))
        }
        .map { it.mrfNumber }
        .filter { it != DrrReport.NO_MRF }
        .distinct()

    val mrfOther = if (mrf.isBlank()) null else
        dispatchRows.firstOrNull {
            it.mrfNumber.equals(mrf.trim(), true) &&
                !it.drrCode.equals(drr.trim(), true)
        }

    val mrfEarlier = if (mrf.isBlank()) 0 else
        dispatchRows.filter {
            it.mrfNumber.equals(mrf.trim(), true) &&
                it.drrCode.equals(drr.trim(), true)
        }.map { it.txUuid }.distinct().size

    fun avail(code: String): BigDecimal =
        balances[code] ?: BigDecimal.ZERO

    fun shortage(l: QtyLine): Boolean =
        FormUtil.isValidQty(l.qty) &&
            l.qty.trim().toBigDecimal() > avail(l.material.code)

    val shortages = lines.filter { shortage(it) }

    fun validate(): String {
        if (dest == null) {
            return if (blockMode) "Select the block."
            else "Choose where the materials are going."
        }

        if (isBlock) {
            if (drr.isBlank()) return "Enter the DRR-CODE."
            if (subBlock.isBlank()) return "Enter the Sub-Block."
            if (mrf.isBlank()) return "Enter the MRF number."
        }

        if (lines.isEmpty()) return "Add at least one material."

        lines.firstOrNull { !FormUtil.isValidQty(it.qty) }?.let {
            return "Enter a valid quantity for ${it.material.name}."
        }

        if (staff.isBlank()) return "Enter the Releasing Person."

        if (FormUtil.dateToIsoInstant(date) == null) {
            return "Date must be yyyy-MM-dd and not in the future."
        }

        return ""
    }

    fun save() {
        val d = dest ?: return
        saving = true

        scope.launch {
            val uuid = UUID.randomUUID().toString()
            val now = Instant.now().toString()
            val iso = FormUtil.dateToIsoInstant(date) ?: now

            val ref = (if (isBlock) "" else voucher.trim()).ifEmpty {
                "DSP-" + date.replace("-", "") + "-" +
                    uuid.take(4).uppercase()
            }

            val tx = TransactionEntity(
                clientTxUuid = uuid,
                txType = "DISPATCH",
                txDateTime = iso,
                sourceLocationId = currentLocation.id,
                destinationLocationId = d.id,
                staffId = staff.trim(),
                referenceNumber = ref,
                notes = notes.trim(),
                syncStatus = "PENDING",
                createdAt = now,
                modifiedAt = now,
                drrCode = if (isBlock) drr.trim().uppercase() else "",
                block = if (isBlock) d.code else "",
                subBlock = if (isBlock) subBlock.trim() else "",
                mrfNumber = if (isBlock) mrf.trim().uppercase() else "",
                issuedBy = staff.trim(),
                acknowledgementBy = ""
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

            Toast.makeText(
                context,
                "Dispatch saved (${txLines.size} materials)",
                Toast.LENGTH_SHORT
            ).show()

            saving = false
            onDone()
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Heading retained; description removed.
            Text(
                "Dispatch Materials",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )

            // ---- 1. Dispatch details
            StepCard(1, "Dispatch details") {
                OutlinedTextField(
                    staff,
                    { staff = it },
                    label = {
                        Text("Issued by / Releasing Person (name or ID)")
                    },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                DateField("Date", date, { date = it })

                OutlinedTextField(
                    notes,
                    { notes = it },
                    label = { Text("Notes (optional)") },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // ---- 2. Destination
            StepCard(
                2,
                "Destination",
                "Choose Block, or another camp warehouse"
            ) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (blockDests.isNotEmpty()) {
                        item {
                            FilterChip(
                                selected = blockMode,
                                onClick = {
                                    blockMode = true
                                    if (!isBlock) destId = ""
                                },
                                label = { Text("Block") }
                            )
                        }
                    }

                    items(warehouseDests, key = { it.id }) { loc ->
                        FilterChip(
                            selected = destId == loc.id,
                            onClick = {
                                blockMode = false
                                destId = loc.id
                            },
                            label = { Text(loc.name) }
                        )
                    }
                }

                if (blockMode) {
                    DropdownField(
                        label = "Block",
                        selectedLabel = if (isBlock) dest?.name ?: "" else "",
                        options = blockDests.map { it.id to it.name },
                        onSelect = { destId = it }
                    )
                }

                if (isBlock) {
                    SuggestField(
                        drr,
                        { drr = it },
                        "DRR-CODE",
                        drrCodes,
                        uppercase = true
                    )

                    SuggestField(
                        subBlock,
                        { subBlock = it },
                        "Sub-Block",
                        subBlockSuggestions,
                        uppercase = true
                    )

                    SuggestField(
                        mrf,
                        { mrf = it },
                        "MRF Number",
                        mrfSuggestions,
                        uppercase = true
                    )

                    mrfOther?.let {
                        WarningBanner(
                            "MRF used for another DRR",
                            "MRF ${it.mrfNumber} was already dispatched for DRR ${it.drrCode}. Check the number before continuing."
                        )
                    }

                    if (mrfEarlier > 0 && mrfOther == null) {
                        Text(
                            "This MRF already has $mrfEarlier earlier dispatch(es) for this DRR. This one will be added to it.",
                            fontSize = 12.sp,
                            color = Slate600
                        )
                    }
                }

                if (dest != null && !isBlock) {
                    OutlinedTextField(
                        voucher,
                        { voucher = it },
                        label = {
                            Text("Waybill / slip number (optional)")
                        },
                        supportingText = {
                            Text("Left empty, a number is generated for you.")
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            // ---- 3. Materials
            StepCard(
                3,
                "Materials",
                "Select several at once, then enter quantities"
            ) {
                if (lines.isEmpty()) {
                    Text("No materials added yet.", fontSize = 13.sp, color = Slate600)
                }

                lines.forEachIndexed { i, l ->
                    val a = avail(l.material.code)

                    OutlinedCard(
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        l.material.name,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        "${l.material.code} • Available ${DecimalSafe.format(a)} ${l.material.unit}",
                                        fontSize = 12.sp,
                                        color = Slate600
                                    )
                                }

                                IconButton(onClick = { lines.removeAt(i) }) {
                                    Icon(
                                        Icons.Default.Close,
                                        contentDescription = "Remove"
                                    )
                                }
                            }

                            OutlinedTextField(
                                value = l.qty,
                                onValueChange = {
                                    lines[i] = l.copy(qty = it.replace(',', '.'))
                                },
                                label = { Text("Quantity") },
                                suffix = { Text(l.material.unit) },
                                singleLine = true,
                                isError = shortage(l),
                                keyboardOptions = KeyboardOptions(
                                    keyboardType = KeyboardType.Decimal
                                ),
                                modifier = Modifier.fillMaxWidth()
                            )

                            if (shortage(l)) {
                                Text(
                                    "Only ${DecimalSafe.format(a)} ${l.material.unit} available. Short by ${DecimalSafe.format(l.qty.trim().toBigDecimal() - a)}.",
                                    color = DangerRed,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }

                OutlinedButton(
                    onClick = { showPicker = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Add, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        if (lines.isEmpty()) "Select materials"
                        else "Add more materials"
                    )
                }
            }
        }

        // ---- Sticky bottom bar
        Surface(
            shadowElevation = 8.dp,
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (error.isNotEmpty()) {
                    Text(error, color = DangerRed, fontSize = 13.sp)
                }

                if (shortages.isNotEmpty()) {
                    Text(
                        "${shortages.size} material(s) exceed available stock.",
                        color = WarningAmber,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }

                Button(
                    onClick = {
                        error = validate()
                        if (error.isEmpty()) showReview = true
                    },
                    enabled = !saving,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        if (lines.isEmpty()) "Review dispatch"
                        else "Review dispatch (${lines.size} items)"
                    )
                }
            }
        }
    }

    if (showPicker) {
        MaterialPickerSheet(
            dao = dao,
            materials = materials,
            balances = balances,
            alreadySelected = lines.map { it.material.code }.toSet(),
            onAdd = { picked ->
                picked.forEach { m ->
                    if (lines.none { it.material.code == m.code }) {
                        lines.add(QtyLine(m))
                    }
                }
            },
            onDismiss = { showPicker = false }
        )
    }

    if (showReview) {
        AlertDialog(
            onDismissRequest = { showReview = false },
            title = { Text("Review dispatch") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text("To: ${dest?.name ?: ""}", fontWeight = FontWeight.Bold)

                    if (isBlock) {
                        Text("DRR-CODE: ${drr.trim().uppercase()}")
                        Text("Sub-Block: ${subBlock.trim()}")
                        Text("MRF: ${mrf.trim().uppercase()}")
                    }

                    HorizontalDivider(Modifier.padding(vertical = 6.dp))

                    lines.forEach { l ->
                        val short = shortage(l)
                        Text(
                            "• ${l.material.name}: ${DecimalSafe.format(DecimalSafe.parse(l.qty))} ${l.material.unit}" +
                                if (short) "  (SHORT)" else "",
                            fontSize = 13.sp,
                            color = if (short) DangerRed else Slate900
                        )
                    }

                    if (shortages.isNotEmpty()) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Stock will go negative for the items marked SHORT. Dispatch only if the stock record is wrong or a receipt is still to be entered.",
                            fontSize = 12.sp,
                            color = DangerRed
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showReview = false
                        save()
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (shortages.isEmpty()) PrimaryBlue else DangerRed
                    )
                ) {
                    Text(
                        if (shortages.isEmpty()) "Confirm dispatch"
                        else "Dispatch anyway"
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { showReview = false }) {
                    Text("Back")
                }
            }
        )
    }
}
