package com.campstock.inventory.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.ui.theme.*

@Composable
fun WarningBanner(
    title: String,
    message: String,
    isError: Boolean = false,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = if (isError) Color(0xFFFEF2F2) else Color(0xFFFFFBEB),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (isError) Color(0xFFFCA5A5) else Color(0xFFFCD34D)
        )
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = if (isError) Icons.Default.Warning else Icons.Default.Info,
                    contentDescription = null,
                    tint = if (isError) DangerRed else WarningAmber,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (isError) DangerRed else WarningAmber
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = Slate800
            )
            if (actionLabel != null && onAction != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = onAction,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isError) DangerRed else WarningAmber
                    ),
                    shape = RoundedCornerShape(8.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text(actionLabel, fontSize = 12.sp, color = Color.White)
                }
            }
        }
    }
}

@Composable
fun SyncStatusBadge(status: String) {
    val (bgColor, textColor, label) = when (status) {
        "SYNCED" -> Triple(Color(0xFFDCFCE7), SuccessGreen, "Synced")
        "SYNCING" -> Triple(Color(0xFFE0F2FE), PrimaryBlue, "Syncing...")
        "PENDING" -> Triple(Color(0xFFFEF3C7), WarningAmber, "Pending Sync")
        "OUTCOME_UNKNOWN" -> Triple(Color(0xFFFFEDD5), Color(0xFFC2410C), "Outcome Unknown")
        "FAILED" -> Triple(Color(0xFFFEE2E2), DangerRed, "Sync Failed")
        else -> Triple(Color(0xFFF1F5F9), Slate600, status)
    }

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = bgColor,
        modifier = Modifier.padding(vertical = 2.dp)
    ) {
        Text(
            text = label,
            color = textColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
        )
    }
}

@Composable
fun SearchInput(
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String = "Search materials or transactions...",
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text(placeholder, fontSize = 14.sp) },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = "Search", tint = Slate600) },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Clear, contentDescription = "Clear", tint = Slate600)
                }
            }
        },
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        modifier = modifier.fillMaxWidth()
    )
}
