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

/** Daily Records: every material's starting and closing balance for the chosen date. */
@Composable
fun DailyRecordsScreen(currentLocation: LocationEntity, dao: AppDao) {
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    val materials by dao.getAllMaterialsFlow().collectAsState(initial = emptyList())
    var day by remember { mutableStateOf(LocalDate.now().toString()) }
    var query by remember { mutableStateOf("") }

    val date = runCatching { LocalDate.parse(day) }.getOrDefault(LocalDate.now())
    val rows = remember(transactions, materials, currentLocation.id, day) {
        DailyReport.balances(materials, transactions, currentLocation.id, date)
    }
    val shown = rows.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Daily Records", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Starting and closing balance of every material.", fontSize = 12.sp, color = Slate600)
        DateField("Date", day, { day = it })
        SearchInput(query = query, onQueryChange = { query = it }, placeholder = "Search material")
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
            HeaderCell("Material Name", Modifier.weight(1.6f))
            HeaderCell("Starting Balance", Modifier.weight(1f), end = true)
            HeaderCell("Closing Balance", Modifier.weight(1f), end = true)
        }
        HorizontalDivider()
        LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            items(shown, key = { it.code }) { b ->
                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(b.name, fontSize = 13.sp, modifier = Modifier.weight(1.6f))
                    Text("${DecimalSafe.format(b.start)} ${b.unit}", fontSize = 12.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                    Text(
                        "${DecimalSafe.format(b.close)} ${b.unit}", fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        color = if (b.close.signum() < 0) DangerRed else Slate900,
                        textAlign = TextAlign.End, modifier = Modifier.weight(1f)
                    )
                }
                HorizontalDivider(color = Slate100)
            }
        }
    }
}
