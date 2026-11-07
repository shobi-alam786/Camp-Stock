package com.campstock.inventory.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.AppDao
import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.LocationEntity
import com.campstock.inventory.model.DailyReport
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import java.time.LocalDate

/**
 * Today's MRF Records: what was dispatched to blocks and returned from them on one day,
 * with each material's starting and closing balance at the bottom.
 */
@Composable
fun MrfRecordsScreen(currentLocation: LocationEntity, dao: AppDao) {
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    val locations by dao.getAllLocationsFlow().collectAsState(initial = emptyList())

    var day by remember { mutableStateOf(LocalDate.now().toString()) }
    var blockCode by remember { mutableStateOf("") }     // "" = all blocks
    var materialCode by remember { mutableStateOf("") }  // "" = all materials
    var query by remember { mutableStateOf("") }

    val blocks = locations.filter { it.type == "BLOCK" }.sortedBy { it.id }
    val date = runCatching { LocalDate.parse(day) }.getOrDefault(LocalDate.now())

    val rows = remember(transactions, currentLocation.id, day, blockCode, materialCode, query) {
        DailyReport.mrfRecords(transactions, currentLocation.id, date, blockCode.ifEmpty { null }, materialCode.ifEmpty { null }, query)
    }
    val balances = remember(rows, materials, transactions, currentLocation.id, day) {
        val shown = rows.map { it.materialCode }.toSet()
        DailyReport.balances(materials, transactions, currentLocation.id, date).filter { it.code in shown }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Text("Today's MRF Records", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("Dispatched to blocks and returned from them.", fontSize = 12.sp, color = Slate600)
        }
        item { DateField("Date", day, { day = it }) }
        item {
            DropdownField(
                label = "Block",
                selectedLabel = blocks.firstOrNull { it.code == blockCode }?.name ?: "All blocks",
                options = listOf("" to "All blocks") + blocks.map { it.code to it.name },
                onSelect = { blockCode = it }
            )
        }
        item {
            DropdownField(
                label = "Material",
                selectedLabel = materials.firstOrNull { it.code == materialCode }?.name ?: "All materials",
                options = listOf("" to "All materials") + materials.map { it.code to it.name },
                onSelect = { materialCode = it }
            )
        }
        item { SearchInput(query = query, onQueryChange = { query = it }, placeholder = "Search material") }

        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        HeaderCell("MRF", Modifier.weight(1.1f))
                        HeaderCell("Materials", Modifier.weight(1.5f))
                        HeaderCell("Dispatch", Modifier.weight(0.9f), end = true)
                        HeaderCell("Returned", Modifier.weight(0.9f), end = true)
                        HeaderCell("Damaged", Modifier.weight(0.9f), end = true)
                    }
                    HorizontalDivider()
                    if (rows.isEmpty()) {
                        Text("No MRF dispatches or returns for these filters.", fontSize = 13.sp, color = Slate600)
                    }
                    rows.forEach { r ->
                        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                            Text(r.mrf, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.weight(1.1f))
                            Text(r.materialName, fontSize = 13.sp, modifier = Modifier.weight(1.5f))
                            listOf(r.dispatchQty, r.returnQty, r.damagedQty).forEach { q ->
                                Column(modifier = Modifier.weight(0.9f), horizontalAlignment = Alignment.End) {
                                    Text(DecimalSafe.format(q), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                    Text(r.unit, fontSize = 10.sp, color = Slate600)
                                }
                            }
                        }
                    }
                }
            }
        }

        if (balances.isNotEmpty()) {
            item {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Starting and closing balance • $day", fontWeight = FontWeight.Bold, color = PrimaryBlue, fontSize = 13.sp)
                        Row(modifier = Modifier.fillMaxWidth()) {
                            HeaderCell("Material Name", Modifier.weight(1.6f))
                            HeaderCell("Starting", Modifier.weight(1f), end = true)
                            HeaderCell("Closing", Modifier.weight(1f), end = true)
                        }
                        HorizontalDivider()
                        balances.forEach { b ->
                            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text(b.name, fontSize = 13.sp, modifier = Modifier.weight(1.6f))
                                Text("${DecimalSafe.format(b.start)} ${b.unit}", fontSize = 12.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                                Text(
                                    "${DecimalSafe.format(b.close)} ${b.unit}", fontSize = 12.sp, fontWeight = FontWeight.Bold,
                                    color = if (b.close.signum() < 0) DangerRed else Slate900,
                                    textAlign = TextAlign.End, modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun HeaderCell(text: String, modifier: Modifier, end: Boolean = false) {
    Text(
        text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Slate600,
        textAlign = if (end) TextAlign.End else TextAlign.Start, modifier = modifier
    )
}
