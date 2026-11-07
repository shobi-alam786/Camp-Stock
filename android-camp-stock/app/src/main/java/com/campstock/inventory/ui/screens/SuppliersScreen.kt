package com.campstock.inventory.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.*
import com.campstock.inventory.ui.components.*
import com.campstock.inventory.ui.theme.*
import java.math.BigDecimal

/** Supplier list with delivery history and totals per material. */
@Composable
fun SuppliersScreen(dao: AppDao) {
    val suppliers by dao.getAllSuppliersFlow().collectAsState(initial = emptyList())
    val transactions by dao.getAllTransactionsWithLinesFlow().collectAsState(initial = emptyList())
    var query by remember { mutableStateOf("") }
    var expandedId by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<SupplierEntity?>(null) }
    var showAdd by remember { mutableStateOf(false) }

    val receipts = transactions.filter { it.transaction.txType == "RECEIPT" }
    val shown = suppliers.filter { query.isBlank() || it.name.contains(query, true) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Suppliers", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("${suppliers.size} suppliers • deliveries come from Receive Materials", fontSize = 12.sp, color = Slate600)
            }
            FilledTonalButton(onClick = { showAdd = true }, shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Default.Add, contentDescription = null); Spacer(Modifier.width(4.dp)); Text("Add")
            }
        }
        SearchInput(query = query, onQueryChange = { query = it }, placeholder = "Search suppliers")

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(shown, key = { it.supplierId }) { s ->
                val mine = receipts.filter {
                    it.transaction.supplierId == s.supplierId ||
                        (it.transaction.supplierId.isEmpty() && it.transaction.supplierName.equals(s.name, true))
                }.sortedByDescending { it.transaction.txDateTime }
                val expanded = expandedId == s.supplierId
                ElevatedCard(
                    onClick = { expandedId = if (expanded) null else s.supplierId },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(s.name, fontWeight = FontWeight.Bold)
                        val meta = listOfNotNull(
                            s.phone.takeIf { it.isNotBlank() },
                            s.contactPerson.takeIf { it.isNotBlank() }
                        ).joinToString(" • ")
                        if (meta.isNotEmpty()) Text(meta, fontSize = 12.sp, color = Slate600)
                        Text(
                            if (mine.isEmpty()) "No deliveries recorded yet"
                            else "${mine.size} deliver${if (mine.size == 1) "y" else "ies"} • last ${mine.first().transaction.txDateTime.take(10)}",
                            fontSize = 12.sp, color = if (mine.isEmpty()) Slate600 else SuccessGreen
                        )
                        if (expanded) {
                            HorizontalDivider(Modifier.padding(vertical = 6.dp))
                            if (s.notes.isNotBlank()) Text("Notes: ${s.notes}", fontSize = 12.sp)
                            val totals = mine.flatMap { it.lines }.groupBy { it.materialCode to it.unit }.map { (k, v) ->
                                Triple(v.first().materialName.ifBlank { k.first }, k.second, v.fold(BigDecimal.ZERO) { a, l -> a.add(DecimalSafe.parse(l.quantity)) })
                            }.sortedBy { it.first.lowercase() }
                            if (totals.isNotEmpty()) {
                                Text("Total supplied", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                totals.forEach { (n, u, q) -> Text("• $n: ${DecimalSafe.format(q)} $u", fontSize = 12.sp) }
                                Spacer(Modifier.height(4.dp))
                                Text("Deliveries", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            }
                            mine.forEach { d ->
                                val t = d.transaction
                                Text(
                                    "${t.txDateTime.take(10)} • GRN ${t.referenceNumber}" + if (t.poNumber.isNotBlank()) " • PO ${t.poNumber}" else "",
                                    fontSize = 12.sp, fontWeight = FontWeight.Medium
                                )
                                d.lines.forEach { l -> Text("   ${l.materialName.ifBlank { l.materialCode }}: ${l.quantity} ${l.unit}", fontSize = 12.sp, color = Slate600) }
                            }
                            Spacer(Modifier.height(4.dp))
                            TextButton(onClick = { editing = s }) { Text("Edit supplier") }
                        }
                    }
                }
            }
        }
    }

    if (showAdd) SupplierDialog(dao, null, onDismiss = { showAdd = false }) { showAdd = false }
    editing?.let { e -> SupplierDialog(dao, e, onDismiss = { editing = null }) { editing = null } }
}
