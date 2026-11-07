package com.campstock.inventory.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.campstock.inventory.data.AppDao
import com.campstock.inventory.security.PinLock
import com.campstock.inventory.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class CleanStage { CREATE, ENTER, MENU, CHANGE, CONFIRM, DONE }

/** Hidden tool (long-press the Camp Stock icon): PIN first, then delete every local record on this phone. */
@Composable
fun CleanRecordsDialog(dao: AppDao, onDismiss: () -> Unit, onCleaned: () -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var stage by remember { mutableStateOf(if (PinLock.isPinSet(context)) CleanStage.ENTER else CleanStage.CREATE) }
    var pin by remember { mutableStateOf("") }
    var pin2 by remember { mutableStateOf("") }
    var typed by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var total by remember { mutableStateOf(0) }
    var unsynced by remember { mutableStateOf(0) }
    var removed by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var wait by remember { mutableStateOf(PinLock.lockedSeconds(context)) }

    LaunchedEffect(wait) {
        if (wait > 0) { delay(1000); wait = PinLock.lockedSeconds(context) }
    }
    LaunchedEffect(stage) {
        if (stage == CleanStage.MENU || stage == CleanStage.CONFIRM) {
            total = dao.countAllTransactions()
            unsynced = dao.countUnsyncedTransactions()
        }
    }

    fun go(next: CleanStage) { stage = next; pin = ""; pin2 = ""; typed = ""; error = "" }
    fun digits(v: String) = v.filter { it in '0'..'9' }.take(6)

    val pinOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword)
    val hide = PasswordVisualTransformation()

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            Text(
                when (stage) {
                    CleanStage.CREATE -> "Create a PIN"
                    CleanStage.CHANGE -> "Change PIN"
                    CleanStage.ENTER -> "Enter PIN"
                    CleanStage.MENU -> "Clean local records"
                    CleanStage.CONFIRM -> "Delete all local records?"
                    CleanStage.DONE -> "Done"
                },
                color = if (stage == CleanStage.CONFIRM) DangerRed else MaterialTheme.colorScheme.onSurface
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                when (stage) {
                    CleanStage.CREATE, CleanStage.CHANGE -> {
                        Text("Use 4 or 6 digits. You need this PIN to open the clean tool.", fontSize = 13.sp)
                        OutlinedTextField(pin, { pin = digits(it) }, label = { Text("PIN") }, singleLine = true,
                            keyboardOptions = pinOptions, visualTransformation = hide)
                        OutlinedTextField(pin2, { pin2 = digits(it) }, label = { Text("Repeat PIN") }, singleLine = true,
                            keyboardOptions = pinOptions, visualTransformation = hide)
                    }
                    CleanStage.ENTER -> {
                        OutlinedTextField(pin, { pin = digits(it) }, label = { Text("PIN") }, singleLine = true,
                            enabled = wait == 0, keyboardOptions = pinOptions, visualTransformation = hide)
                        if (wait > 0) Text("Too many wrong PINs. Wait $wait seconds.", color = DangerRed, fontSize = 13.sp)
                    }
                    CleanStage.MENU -> {
                        Text("Records on this phone: $total", fontSize = 14.sp)
                        Text(
                            "Not sent to Kobo yet: $unsynced",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (unsynced > 0) DangerRed else MaterialTheme.colorScheme.onSurface
                        )
                        Button(
                            onClick = { go(CleanStage.CONFIRM) },
                            colors = ButtonDefaults.buttonColors(containerColor = DangerRed),
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("Delete all local records") }
                        OutlinedButton(onClick = { go(CleanStage.CHANGE) }, modifier = Modifier.fillMaxWidth()) { Text("Change PIN") }
                    }
                    CleanStage.CONFIRM -> {
                        Text("This removes $total records and all physical counts from this phone. Stock becomes empty. You cannot undo this.", fontSize = 13.sp)
                        if (unsynced > 0) {
                            Text(
                                "$unsynced records were NOT sent to Kobo. They will be lost forever. Cancel and tap Close day and sync first.",
                                color = DangerRed, fontWeight = FontWeight.Bold, fontSize = 13.sp
                            )
                        }
                        OutlinedTextField(typed, { typed = it }, label = { Text("Type DELETE to continue") }, singleLine = true, enabled = !busy)
                    }
                    CleanStage.DONE -> {
                        Text(
                            "$removed records were removed from this phone. To bring back records that were already sent, use Restore Ledger from Kobo in Sync Centre.",
                            fontSize = 13.sp
                        )
                    }
                }
                if (error.isNotEmpty()) Text(error, color = DangerRed, fontSize = 13.sp)
            }
        },
        confirmButton = {
            when (stage) {
                CleanStage.CREATE, CleanStage.CHANGE -> TextButton(onClick = {
                    when {
                        !PinLock.isValidFormat(pin) -> error = "The PIN must be 4 or 6 digits."
                        pin != pin2 -> error = "The two PINs are not the same."
                        else -> { PinLock.setPin(context, pin); go(CleanStage.MENU) }
                    }
                }) { Text("Save PIN") }
                CleanStage.ENTER -> TextButton(
                    enabled = wait == 0 && PinLock.isValidFormat(pin),
                    onClick = {
                        when (val r = PinLock.verify(context, pin)) {
                            is PinLock.Result.Ok -> go(CleanStage.MENU)
                            is PinLock.Result.Locked -> { pin = ""; wait = r.seconds; error = "" }
                            is PinLock.Result.Wrong -> { pin = ""; error = "Wrong PIN. ${r.triesLeft} tries left." }
                        }
                    }
                ) { Text("Open") }
                CleanStage.MENU -> TextButton(onClick = onDismiss) { Text("Close") }
                CleanStage.CONFIRM -> TextButton(
                    enabled = !busy && typed.trim().uppercase() == "DELETE",
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                removed = total
                                dao.wipeLocalRecords()
                                go(CleanStage.DONE)
                            } catch (e: Exception) {
                                error = "Could not delete: ${e.message ?: "unknown error"}"
                            } finally {
                                busy = false
                            }
                        }
                    }
                ) { Text(if (busy) "Deleting..." else "Delete everything", color = DangerRed) }
                CleanStage.DONE -> TextButton(onClick = { onCleaned(); onDismiss() }) { Text("Close") }
            }
        },
        dismissButton = {
            when (stage) {
                CleanStage.CHANGE -> TextButton(onClick = { go(CleanStage.MENU) }) { Text("Cancel") }
                CleanStage.CONFIRM -> TextButton(enabled = !busy, onClick = { go(CleanStage.MENU) }) { Text("Back") }
                CleanStage.CREATE, CleanStage.ENTER -> TextButton(onClick = onDismiss) { Text("Cancel") }
                else -> {}
            }
        }
    )
}
