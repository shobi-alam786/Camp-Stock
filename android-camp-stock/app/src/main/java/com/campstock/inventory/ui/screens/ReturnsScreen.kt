package com.campstock.inventory.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.*
import com.campstock.inventory.model.DailyReport
import com.campstock.inventory.model.FormUtil
import com.campstock.inventory.model.MrfMatch
import com.campstock.inventory.model.QtyLine
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.time.LocalDate

/**
 * Materials coming back from a block to the current warehouse.
 * Search the released MRF number to fill in block, DRR, sub-block and materials, then enter what came back.
 */
@Composable
fun ReturnsScreen(currentLocation: LocationEntity, dao: AppDao, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val locations by dao.getAllLocationsFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val drrRefs by dao.getDrrRefsFlow().collectAsState(initial = emptyList())

    val blocks = locations.filter { it.type == "BLOCK" }.sortedBy { it.id }
    var search by remember { mutableStateOf("") }
    var blockId by remember { mutableStateOf("") }
    var drr by remember { mutableStateOf("") }
    var subBlock by remember { mutableStateOf("") }
    var mrf by remember { mutableStateOf("") }
    var ref by remember { mutableStateOf("") }
    var receiver by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<QtyLine>() }
    var showPicker by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { dao.getSetting("last_staff")?.let { if (receiver.isEmpty()) receiver = it } }

    val block = blocks.firstOrNull { it.id == blockId }
    val matches = remember(transactions, search) { DailyReport.searchMrf(transactions, search) }

    // everything dispatched / returned under the MRF that is typed or picked
    val scoped = remember(transactions, blockId, mrf, subBlock) {
        if (mrf.isBlank() || block == null) emptyList() else transactions.filter {
            val t = it.transaction
            (t.txType == "DISPATCH" || t.txType == "RETURN") && t.block == block.code &&
                t.mrfNumber.trim().equals(mrf.trim(), true) &&
                (subBlock.isBlank() || t.subBlock.trim().equals(subBlock.trim(), true))
        }
    }
    fun netIssued(code: String): BigDecimal = scoped.fold(BigDecimal.ZERO) { acc, item ->
        item.lines.filter { it.materialCode == code }.fold(acc) { a, l ->
            val q = DecimalSafe.parse(l.quantity)
            if (item.transaction.txType == "DISPATCH") a.add(q) else a.subtract(q)
        }
    }

    val drrCodes = drrRefs.filter { blockId.isEmpty() || it.block == block?.code }.map { it.drrCode }.distinct()
    val subSuggestions = drrRefs.filter { it.drrCode.equals(drr.trim(), true) }.map { it.subBlock }.filter { it.isNotBlank() }.distinct()

    fun pick(m: MrfMatch) {
        blocks.firstOrNull { it.code == m.block }?.let { blockId = it.id }
        drr = m.drrCode
        subBlock = m.subBlock
        mrf = m.mrf.uppercase()
        lines.clear()
        m.lines.forEach { ml -> materials.firstOrNull { it.code == ml.materialCode }?.let { lines.add(QtyLine(it)) } }
        search = ""
        error = ""
    }

    // lines left empty are simply not part of this return
    val filled = lines.filter { it.qty.isNotBlank() }

    fun validate(): String {
        if (block == null) return "Select the block the materials come from (or search the MRF number)."
        if (drr.isBlank()) return "Enter the DRR-CODE these materials were dispatched for."
        if (filled.isEmpty()) return "Enter the returned quantity for at least one material."
        filled.firstOrNull { !FormUtil.isValidQty(it.qty) }?.let { return "Enter a valid quantity for ${it.material.name}." }
        filled.firstOrNull { !FormUtil.isValidCountQty(it.damagedQty.ifBlank { "0" }) || DecimalSafe.parse(it.damagedQty.ifBlank { "0" }) > DecimalSafe.parse(it.qty) }?.let { return "Damaged quantity for ${it.material.name} must be between zero and the total returned quantity." }
        if (FormUtil.dateToIsoInstant(date) == null) return "Date must be yyyy-MM-dd and not in the future."
        if (receiver.isBlank()) return "Enter the name of the person receiving the returned materials."
        return ""
    }

    FormShell(
        title = "Return Materials",
        subtitle = "From a block back into the warehouse",
        error = error, buttonText = if (filled.isEmpty()) "Record return" else "Record return (${filled.size} items)",
        enabled = !saving,
        onSubmit = {
            error = validate()
            if (error.isEmpty()) {
                saving = true
                scope.launch {
                    TxWriter.save(
                        context, dao, "RETURN", date, src = blockId, dst = currentLocation.id,
                        staff = receiver, ref = ref.trim().ifEmpty { TxWriter.autoRef("RET", date) }, notes = notes, items = filled,
                        drrCode = drr.trim().uppercase(), block = block?.code ?: "", subBlock = subBlock.trim(), mrf = mrf.trim().uppercase()
                    )
                    saving = false
                    onDone()
                }
            }
        }
    ) {
        StepCard(1, "Find the released MRF", "Search the MRF number to fill in the details automatically") {
            SearchInput(query = search, onQueryChange = { search = it }, placeholder = "Search MRF number")
            if (search.isNotBlank() && matches.isEmpty()) {
                Text("No dispatched MRF matches \"${search.trim()}\". You can still fill in the details below.", fontSize = 12.sp, color = Slate600)
            }
            matches.forEach { m ->
                ElevatedCard(onClick = { pick(m) }, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(m.mrf.uppercase(), fontWeight = FontWeight.Bold)
                        Text(
                            "Block ${m.block}" + (if (m.subBlock.isNotBlank()) " • ${m.subBlock}" else "") +
                                (if (m.drrCode.isNotBlank()) " • ${m.drrCode}" else "") +
                                " • ${m.lines.size} material(s) • ${m.lastDate.take(10)}",
                            fontSize = 12.sp, color = Slate600
                        )
                    }
                }
            }
        }
        StepCard(2, "Returned from", "Filled automatically when you pick an MRF above") {
            DropdownField(
                label = "Block",
                selectedLabel = block?.name ?: "",
                options = blocks.map { it.id to it.name },
                onSelect = { blockId = it }
            )
            SuggestField(drr, { drr = it }, "DRR-CODE", drrCodes, uppercase = true)
            SuggestField(subBlock, { subBlock = it }, "Sub-Block (optional)", subSuggestions, uppercase = true)
            OutlinedTextField(
                mrf, { mrf = it.uppercase() }, label = { Text("MRF Number (optional)") },
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
        }
        StepCard(3, "Materials returned", "Enter a quantity only for what is actually brought back. Leave the others empty.") {
            LinesEditor(
                lines = lines, qtyLabel = "Quantity returned",
                subtitle = { l ->
                    if (mrf.isBlank()) l.material.code
                    else "${l.material.code} • Dispatched (net): ${DecimalSafe.format(netIssued(l.material.code))} ${l.material.unit}"
                },
                warning = { l ->
                    if (mrf.isNotBlank() && FormUtil.isValidQty(l.qty) && l.qty.trim().toBigDecimal() > netIssued(l.material.code))
                        "More than was dispatched for this MRF. Check before saving."
                    else null
                },
                onAdd = { showPicker = true }
            )
            Text("Damaged quantities (optional; default 0)", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            lines.filter { it.qty.isNotBlank() }.forEachIndexed { _, line ->
                val idx = lines.indexOfFirst { it.material.code == line.material.code }
                OutlinedTextField(
                    value = line.damagedQty,
                    onValueChange = { if (idx >= 0) lines[idx] = line.copy(damagedQty = it.replace(',', '.')) },
                    label = { Text("${line.material.name} — damaged ${line.material.unit}") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
        StepCard(4, "Return details") {
            DateField("Date", date, { date = it })
            OutlinedTextField(ref, { ref = it }, label = { Text("Return slip number (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("Condition / reason (optional)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(receiver, { receiver = it }, label = { Text("Returned materials receiver name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
    }

    if (showPicker) {
        MaterialPickerSheet(
            dao = dao, materials = materials, balances = null,
            alreadySelected = lines.map { it.material.code }.toSet(),
            onAdd = { picked -> picked.forEach { m -> if (lines.none { it.material.code == m.code }) lines.add(QtyLine(m)) } },
            onDismiss = { showPicker = false }
        )
    }
}
