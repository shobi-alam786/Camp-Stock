package com.campstock.inventory.sync

import com.campstock.inventory.data.AppDao
import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.SupplierEntity
import com.campstock.inventory.data.UNIT_NEEDS_CONFIRMATION
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import com.campstock.inventory.model.DuplicateCheck
import com.campstock.inventory.model.ReportBuilder
import com.campstock.inventory.model.BaselineRules
import com.campstock.inventory.model.StockCalculator
import java.math.BigDecimal
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant

data class SyncResult(
    val processedCount: Int,
    val successCount: Int,
    val failureCount: Int,
    val outcomeUnknownCount: Int,
    val summaryMessage: String
)

data class ResolvedForm(val uid: String, val idString: String, val uuid: String)

data class RestoreResult(
    val importedCount: Int,
    val skippedLocalCount: Int,
    val message: String
)

object KoboSyncManager {

    // The background worker and the manual "Sync now" button must never run at the same time,
    // otherwise the same transaction could be posted twice.
    private val syncMutex = Mutex()

    /** Kept for existing callers/tests; the logic lives in [OpenRosaXml] (plain Kotlin, unit-testable). */
    fun buildOpenRosaXml(item: TransactionWithLines, formId: String, formUuid: String = ""): String =
        OpenRosaXml.build(item, formId, formUuid)

    private val formCache = java.util.concurrent.ConcurrentHashMap<String, ResolvedForm>()

    fun clearFormCache() = formCache.clear()

    /**
     * Reads a deployed form from the asset API: its id_string (XML root) and deployment__uuid.
     * Kobo's /submission endpoint finds the form through <formhub><uuid> in the XML; without it the
     * server answers HTTP 404 "Not found". Returns Pair(form, null) or Pair(null, errorMessage).
     */
    suspend fun resolveForm(uid: String): Pair<ResolvedForm?, String?> = withContext(Dispatchers.IO) {
        formCache[uid]?.let { return@withContext it to null }
        if (uid.isBlank()) return@withContext null to "A Kobo form UID is missing in Settings."
        try {
            val url = "${KoboConfig.serverUrl}/api/v2/assets/${URLEncoder.encode(uid, "UTF-8")}/?format=json"
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.setRequestProperty("Authorization", "Token ${KoboConfig.token}")
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            val code = conn.responseCode
            if (code != 200) {
                conn.disconnect()
                return@withContext null to "Cannot open Kobo form $uid (HTTP $code). Check server, form UID, token and that the token's account can see the form."
            }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            conn.disconnect()
            val uuid = json.optString("deployment__uuid")
            val idString = json.optJSONObject("content")?.optJSONObject("settings")?.optString("id_string").orEmpty()
            if (!json.optBoolean("has_deployment", false) || uuid.isBlank() || idString.isBlank()) {
                return@withContext null to "Kobo form $uid is not deployed. Deploy it in Kobo first."
            }
            val form = ResolvedForm(uid, idString, uuid)
            formCache[uid] = form
            form to null
        } catch (e: IOException) {
            null to "Network problem while checking the Kobo form (${e.message})."
        }
    }

    /**
     * Queries KoboToolbox REST API to check if a clientTxUuid was already submitted.
     * Prevents duplicate entries on ambiguous timeouts.
     */
    suspend fun checkExistingSubmissionId(clientTxUuid: String, formUid: String = KoboConfig.formUid): Long? = withContext(Dispatchers.IO) {
        if (!KoboConfig.isConfigured) return@withContext null
        try {
            val queryJson = JSONObject().put("client_tx_uuid", clientTxUuid).toString()
            val encodedQuery = URLEncoder.encode(queryJson, "UTF-8")
            val urlString = "${KoboConfig.serverUrl}/api/v2/assets/$formUid/data/?format=json&limit=5&query=$encodedQuery"

            val conn = URL(urlString).openConnection() as HttpURLConnection
            conn.setRequestProperty("Authorization", "Token ${KoboConfig.token}")
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            val code = conn.responseCode
            if (code == 200) {
                val respText = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val json = JSONObject(respText)
                val results = json.optJSONArray("results")
                if (results != null && results.length() > 0) {
                    return@withContext results.getJSONObject(0).optLong("_id")
                }
            } else {
                conn.disconnect()
            }
        } catch (e: Exception) {
            // Network failure during check: caller handles as OUTCOME_UNKNOWN
        }
        null
    }

    sealed class Lookup {
        object NotFound : Lookup()
        class Found(val row: JSONObject) : Lookup()
        class Error(val message: String) : Lookup()
    }

    /** Finds the Kobo submission of a record by its client_tx_uuid. An error is NOT the same as "not found". */
    suspend fun lookupByClientUuid(clientTxUuid: String, formUid: String): Lookup = withContext(Dispatchers.IO) {
        try {
            val encodedQuery = URLEncoder.encode(JSONObject().put("client_tx_uuid", clientTxUuid).toString(), "UTF-8")
            val conn = URL("${KoboConfig.serverUrl}/api/v2/assets/$formUid/data/?format=json&limit=10&query=$encodedQuery").openConnection() as HttpURLConnection
            conn.setRequestProperty("Authorization", "Token ${KoboConfig.token}")
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            val code = conn.responseCode
            if (code != 200) { conn.disconnect(); return@withContext Lookup.Error("Remote duplicate check failed (HTTP $code); not retrying yet.") }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            conn.disconnect()
            val results = json.optJSONArray("results")
            if (results != null) for (i in 0 until results.length()) {
                val r = results.getJSONObject(i)
                if (r.optString("client_tx_uuid") == clientTxUuid) return@withContext Lookup.Found(r)
            }
            Lookup.NotFound
        } catch (e: Exception) {
            Lookup.Error("Remote duplicate check error: ${e.message}")
        }
    }

    /** Reads ONE submission by its Kobo _id. Returns (HTTP status, row). 404 = it no longer exists on Kobo. */
    suspend fun getRowById(formUid: String, id: Long): Pair<Int, JSONObject?> = withContext(Dispatchers.IO) {
        val conn = URL("${KoboConfig.serverUrl}/api/v2/assets/$formUid/data/$id/?format=json").openConnection() as HttpURLConnection
        try {
            conn.setRequestProperty("Authorization", "Token ${KoboConfig.token}")
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            val code = conn.responseCode
            if (code != 200) return@withContext code to null
            code to JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
        } finally { conn.disconnect() }
    }

    /** Text describing a quantity that differs between the local record and what Kobo holds. Empty = identical. */
    fun quantityMismatch(local: TransactionWithLines, remote: TransactionWithLines): String {
        for (l in local.lines) {
            val r = remote.lines.firstOrNull { it.materialCode == l.materialCode } ?: return "Kobo has no line for ${l.materialCode}."
            if (DecimalSafe.compare(l.quantity, r.quantity) != 0) return "Kobo stored ${r.quantity} for ${l.materialCode} but ${l.quantity} was entered."
        }
        return ""
    }

    /**
     * Executes multipart OpenRosa POST to /submission.
     */
    suspend fun postOpenRosaSubmission(xml: String): Pair<Int, String> = withContext(Dispatchers.IO) {
        val boundary = "----CampStockBoundary" + System.currentTimeMillis()
        val conn = URL(KoboConfig.submissionUrl).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        conn.setRequestProperty("Authorization", "Token ${KoboConfig.token}")
        conn.setRequestProperty("X-OpenRosa-Version", "1.0")
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")

        val payload = buildString {
            append("--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"xml_submission_file\"; filename=\"submission.xml\"\r\n")
            append("Content-Type: text/xml; charset=utf-8\r\n\r\n")
            append(xml)
            append("\r\n--$boundary--\r\n")
        }

        conn.outputStream.use { out ->
            out.write(payload.toByteArray(Charsets.UTF_8))
        }

        val code = conn.responseCode
        val body = (if (code >= 400) conn.errorStream else conn.inputStream)
            ?.bufferedReader()?.use { it.readText() }?.take(300) ?: ""
        conn.disconnect()

        code to body
    }

    /**
     * Processes pending sync queue items with state machine transitions:
     * PENDING -> SYNCING -> (SYNCED | OUTCOME_UNKNOWN | FAILED)
     */
    suspend fun processSyncQueue(dao: AppDao): SyncResult = withContext(Dispatchers.IO) {
        if (!syncMutex.tryLock()) {
            return@withContext SyncResult(0, 0, 0, 0, "Another synchronization is already running.")
        }
        try { processSyncQueueLocked(dao) } finally { syncMutex.unlock() }
    }

    private class One(val kind: String, val error: String = "", val unknown: Boolean = false, val authFailed: Boolean = false, val warning: String = "")

    /** Keeps the Kobo _id/_uuid of the record when only its status changes. */
    private suspend fun markStatus(dao: AppDao, uuid: String, status: String, error: String) {
        val t = dao.getTransactionWithLines(uuid)?.transaction ?: return
        dao.updateTransactionSyncStatus(uuid, status, t.koboSubmissionId, t.koboInstanceId, error)
    }

    /**
     * Sends ONE record: creates it on Kobo the first time, updates that same submission afterwards.
     * A record whose earlier attempt failed or timed out is looked up on Kobo first, so it is never sent twice.
     */
    private suspend fun syncOne(dao: AppDao, first: TransactionWithLines, form: ResolvedForm, formUid: String, retried: Boolean): One {
        var cur = first
        val uuid = first.transaction.clientTxUuid
        if (SyncRules.actionFor(cur.transaction) == SyncRules.Action.CREATE &&
            (retried || cur.transaction.syncStatus == "OUTCOME_UNKNOWN" || cur.transaction.syncStatus == "FAILED")) {
            when (val f = lookupByClientUuid(uuid, formUid)) {
                is Lookup.Error -> return One("unknown", f.message, unknown = true)
                is Lookup.Found -> {
                    val remote = KoboRows.toTransaction(f.row)
                    dao.updateTransactionSyncStatus(uuid, cur.transaction.syncStatus, remote.transaction.koboSubmissionId, remote.transaction.koboInstanceId, "")
                    cur = dao.getTransactionWithLines(uuid) ?: cur
                    if (SyncRules.sameContent(cur, remote)) {
                        dao.updateTransactionSyncStatus(uuid, "SYNCED", remote.transaction.koboSubmissionId, remote.transaction.koboInstanceId, "")
                        return One("linked")
                    }
                }
                Lookup.NotFound -> {}
            }
        }
        return if (SyncRules.actionFor(cur.transaction) == SyncRules.Action.UPDATE) updateOne(dao, cur, form, formUid) else createOne(dao, cur, form, formUid)
    }

    private suspend fun createOne(dao: AppDao, cur: TransactionWithLines, form: ResolvedForm, formUid: String): One {
        val tx = cur.transaction
        val xml = OpenRosaXml.buildForForm(cur, form.idString, form.uuid)
        val (code, body) = postOpenRosaSubmission(xml)
        return when {
            code == 201 || code == 202 -> {
                // Remember which Kobo submission this record is (_id / _uuid): later edits update it instead of adding another one.
                val found = lookupByClientUuid(tx.clientTxUuid, formUid)
                val remote = (found as? Lookup.Found)?.let { KoboRows.toTransaction(it.row) }
                dao.updateTransactionSyncStatus(tx.clientTxUuid, "SYNCED", remote?.transaction?.koboSubmissionId,
                    remote?.transaction?.koboInstanceId?.ifEmpty { null } ?: "uuid:${tx.clientTxUuid}", "")
                One("created", warning = remote?.let { quantityMismatch(cur, it) } ?: "")
            }
            code == 401 || code == 403 -> One("failed", "Authentication refused (HTTP $code). Token may be invalid or revoked.", authFailed = true)
            else -> One("failed", "Server rejected submission (HTTP $code: $body)")
        }
    }

    private suspend fun updateOne(dao: AppDao, cur: TransactionWithLines, form: ResolvedForm, formUid: String, relinked: Boolean = false): One {
        val tx = cur.transaction
        val id = tx.koboSubmissionId ?: return One("failed", "This record has no Kobo submission id yet.")
        if (cur.lines.size != 1) return One("failed", "Only single-material records can be updated in place on Kobo.")
        val (status, row) = getRowById(formUid, id)
        if (status == 404) {
            // The saved _id is not in THIS form (deleted, or the record was first sent to another form). Look the record up by
            // client_tx_uuid; only when it is really absent from this form is it sent once as a new submission here.
            when (val f = lookupByClientUuid(tx.clientTxUuid, formUid)) {
                is Lookup.Error -> return One("unknown", f.message, unknown = true)
                is Lookup.Found -> {
                    val r = KoboRows.toTransaction(f.row).transaction
                    if (relinked || r.koboSubmissionId == id) return One("failed", "Kobo submission $id cannot be read. Nothing was sent.")
                    dao.updateTransactionSyncStatus(tx.clientTxUuid, tx.syncStatus, r.koboSubmissionId, r.koboInstanceId, "")
                    return updateOne(dao, dao.getTransactionWithLines(tx.clientTxUuid) ?: cur, form, formUid, true)
                }
                Lookup.NotFound -> {
                    dao.updateTransactionSyncStatus(tx.clientTxUuid, "PENDING", null, "", "")
                    val fresh = dao.getTransactionWithLines(tx.clientTxUuid) ?: cur
                    val r = createOne(dao, fresh, form, formUid)
                    return if (r.kind == "created") One("created", warning = "Old Kobo submission $id is not in this form, so the record was sent again as a new submission here.") else r
                }
            }
        }
        if (status == 401 || status == 403) return One("failed", "Authentication refused (HTTP $status). Token may be invalid or revoked.", authFailed = true)
        if (status != 200 || row == null) return One("failed", "Cannot read Kobo submission $id (HTTP $status).")
        val remote = KoboRows.toTransaction(row)
        if (remote.transaction.clientTxUuid != tx.clientTxUuid) return One("failed", "Kobo submission $id belongs to a different record. Nothing was sent.")
        if (SyncRules.sameContent(cur, remote)) {
            dao.updateTransactionSyncStatus(tx.clientTxUuid, "SYNCED", id, tx.koboInstanceId.ifEmpty { remote.transaction.koboInstanceId }, "")
            return One("updated")
        }
        // Kobo holds a NEWER version (edited on another device): it wins, nothing is sent.
        if (BaselineRules.instant(remote.transaction.txDateTime) > BaselineRules.instant(tx.txDateTime)) {
            val merged = SyncRules.applyRemote(cur, remote, Instant.now().toString())
            dao.replaceTransactionContent(merged.transaction, merged.lines)
            return One("remote_newer")
        }
        val data = JSONObject().apply { OpenRosaXml.updateData(cur).forEach { (k, v) -> put(k, v) } }
        val payload = JSONObject().put("payload", JSONObject().put("submission_ids", org.json.JSONArray().put(id.toString())).put("data", data))
        val (code, body) = withContext(Dispatchers.IO) { sendJson("PATCH", "${KoboConfig.serverUrl.trimEnd('/')}/api/v2/assets/$formUid/data/bulk/", payload.toString()) }
        if (code !in 200..299) return One("failed", "Kobo rejected the update (HTTP $code: $body)")
        val failures = Regex("\"failures\"\\s*:\\s*(\\d+)").find(body)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        if (failures > 0) return One("failed", "Kobo did not update the submission: $body")
        // Read it back: the exact quantity must be what Kobo now holds.
        val after = getRowById(formUid, id).second
        val warning = after?.let { quantityMismatch(cur, KoboRows.toTransaction(it)) } ?: ""
        dao.updateTransactionSyncStatus(tx.clientTxUuid, "SYNCED", id, tx.koboInstanceId.ifEmpty { remote.transaction.koboInstanceId }, "")
        return One("updated", warning = warning)
    }

    private suspend fun processSyncQueueLocked(dao: AppDao): SyncResult {
        if (!KoboConfig.isConfigured) {
            return SyncResult(0, 0, 0, 0, "Kobo is not configured. Enter server, form UID, and token in Settings.")
        }
        val pendingItems = dao.getPendingQueueItems()
        if (pendingItems.isEmpty()) {
            return SyncResult(0, 0, 0, 0, "Synchronized: 0 succeeded, 0 failed, 0 outcome unknown.")
        }
        val formErrors = linkedSetOf<String>()
        val warnings = linkedSetOf<String>()
        val seen = HashSet<String>()
        var success = 0
        var failed = 0
        var unknown = 0
        var created = 0
        var updated = 0
        var lastError = ""

        for (queueItem in pendingItems) {
            val txWithLines = dao.getTransactionWithLines(queueItem.clientTxUuid) ?: continue
            val tx = txWithLines.transaction
            // Already confirmed (for example linked while pulling): nothing left to send.
            if (tx.syncStatus == "SYNCED") { dao.updateQueueItem(queueItem.queueId, "SYNCED", Instant.now().toString(), ""); continue }
            if (!seen.add(tx.clientTxUuid)) continue // queued twice: one send carries the latest content
            val formUid = KoboConfig.uidFor(tx.txType)
            val (form, formError) = resolveForm(formUid)
            if (form == null) {
                // Nothing was sent for this record; it stays in the queue and is retried next time.
                formErrors.add(formError ?: "Could not verify the Kobo form.")
                continue
            }
            dao.updateQueueItem(queueItem.queueId, "SYNCING", Instant.now().toString(), "")
            val one = try {
                syncOne(dao, txWithLines, form, formUid, queueItem.status == "OUTCOME_UNKNOWN" || queueItem.retryCount > 0)
            } catch (e: IOException) {
                // Network drop: the outcome is unknown. A CREATE is looked up before any retry; an UPDATE is idempotent.
                One("unknown", "Network timeout during transmission (${e.message}). State unknown, checking before retry.", unknown = true)
            } catch (e: Exception) {
                One("failed", "Submission failed: ${e.message}")
            }
            val now = Instant.now().toString()
            when (one.kind) {
                "created", "updated", "linked", "remote_newer" -> {
                    dao.updateQueueItem(queueItem.queueId, "SYNCED", now, "")
                    success++
                    if (one.kind == "created") created++
                    if (one.kind == "updated") updated++
                    if (one.warning.isNotEmpty()) warnings.add(one.warning)
                }
                else -> {
                    val status = if (one.unknown) "OUTCOME_UNKNOWN" else "FAILED"
                    markStatus(dao, tx.clientTxUuid, status, one.error)
                    dao.updateQueueItem(queueItem.queueId, status, now, one.error)
                    if (one.unknown) unknown++ else failed++
                    lastError = one.error
                    if (one.authFailed) break // stop the queue on an authentication failure
                }
            }
        }

        if (success > 0) KoboConfig.updateLastSync(Instant.now().toString())

        return SyncResult(
            processedCount = pendingItems.size,
            successCount = success,
            failureCount = failed,
            outcomeUnknownCount = unknown,
            summaryMessage = "Synchronized: $success succeeded ($created new, $updated updated), $failed failed, $unknown outcome unknown." +
                (if (lastError.isNotEmpty()) "\nLast error: $lastError" else "") +
                (if (warnings.isNotEmpty()) "\nCheck: ${warnings.joinToString(" ")}" else "") +
                (if (formErrors.isNotEmpty()) "\nNot sent: ${formErrors.joinToString("; ")}" else "")
        )
    }

    /** Downloads every submission of one Kobo form (all pages). Throws IOException on a non-200 answer. */
    private fun fetchAllRows(formUid: String): List<JSONObject> {
        val rows = ArrayList<JSONObject>()
        var nextUrl: String? = "${KoboConfig.serverUrl}/api/v2/assets/$formUid/data/?format=json&limit=500"
        while (nextUrl != null) {
            val conn = URL(nextUrl).openConnection() as HttpURLConnection
            conn.setRequestProperty("Authorization", "Token ${KoboConfig.token}")
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            val code = conn.responseCode
            if (code != 200) { conn.disconnect(); throw IOException("HTTP $code from Kobo form $formUid") }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            conn.disconnect()
            val results = json.optJSONArray("results") ?: break
            for (i in 0 until results.length()) rows.add(results.getJSONObject(i))
            nextUrl = if (json.isNull("next")) null else json.optString("next").replace("http://", "https://").ifEmpty { null }
        }
        return rows
    }

    private fun field(obj: JSONObject, group: String, name: String): String =
        obj.optString("$group/$name").ifEmpty { obj.optString(name) }

    /** Newest catalogue record per material code (records are append-only; the latest one wins). */
    private fun latestCatalogueRecords(rows: List<JSONObject>): Map<String, JSONObject> {
        val latest = LinkedHashMap<String, JSONObject>()
        rows.sortedWith(compareBy({ it.optString("_submission_time") }, { it.optLong("_id") })).forEach { r ->
            val code = r.optString("material_code").trim()
            if (code.isNotEmpty()) latest[code] = r
        }
        return latest
    }

    /** Latest stock/catalogue row for each material in this warehouse; old rows without location are central. */
    private fun latestCatalogueRecordsForLocation(rows: List<JSONObject>, locationId: String): Map<String, JSONObject> {
        val latest = LinkedHashMap<String, JSONObject>()
        rows.sortedWith(compareBy({ it.optString("_submission_time") }, { it.optLong("_id") })).forEach { r ->
            val code = r.optString("material_code").trim()
            val loc = r.optString("location_id").ifBlank { "LOC-CENTRAL" }
            if (code.isNotEmpty() && loc == locationId) latest[code] = r
        }
        return latest
    }

    private val ORIGINAL_CODE = Regex("MAT-00(0[1-9]|[1-3][0-9]|4[0-5])")

    /** Material Catalogue (Kobo) -> this device. New codes are added; existing ones take the newest name / unit / status. */
    suspend fun downloadCatalogue(dao: AppDao): String = withContext(Dispatchers.IO) {
        if (!KoboConfig.isConfigured) return@withContext "Kobo configuration missing."
        try {
            val latest = latestCatalogueRecords(fetchAllRows(KoboConfig.uidCatalogue))
            if (latest.isEmpty()) return@withContext "The Kobo catalogue is empty. Use \"Upload catalogue to Kobo\" first."
            var added = 0
            var updated = 0
            for ((code, r) in latest) {
                val name = r.optString("material_name").trim().ifEmpty { code }
                val unit = r.optString("unit").trim().ifEmpty { UNIT_NEEDS_CONFIRMATION }
                val confirmed = r.optString("unit_confirmed").equals("yes", ignoreCase = true)
                val active = !r.optString("status").equals("inactive", ignoreCase = true)
                val notes = r.optString("notes")
                val local = dao.getMaterial(code)
                if (local == null) {
                    dao.insertMaterialIfAbsent(MaterialEntity(code, name, unit, confirmed, notes, !ORIGINAL_CODE.matches(code), active))
                    added++
                } else if (local.name != name || local.unit != unit || local.isUnitConfirmed != confirmed || local.isActive != active) {
                    dao.updateMaterial(local.copy(name = name, unit = unit, isUnitConfirmed = confirmed, isActive = active))
                    updated++
                }
            }
            "Catalogue downloaded from Kobo: $added added, $updated updated, ${latest.size - added - updated} unchanged."
        } catch (e: Exception) {
            "Catalogue download failed: ${e.message}"
        }
    }

    /** This device -> Material Catalogue (Kobo). Sends only materials that are new or different from Kobo's newest record. */
    suspend fun uploadCatalogue(dao: AppDao): String = withContext(Dispatchers.IO) {
        if (!KoboConfig.isConfigured) return@withContext "Kobo configuration missing."
        val (form, formError) = resolveForm(KoboConfig.uidCatalogue)
        if (form == null) return@withContext formError ?: "Could not open the catalogue form."
        try {
            val locationId = KoboConfig.deviceLocationId
            val remote = latestCatalogueRecordsForLocation(fetchAllRows(KoboConfig.uidCatalogue), locationId)
            val ledger = dao.getAllTransactionsWithLines()
            var sent = 0
            var same = 0
            for (m in dao.getAllMaterials()) {
                val stock = StockCalculator.calculate(m.code, locationId, ledger).currentStock
                val r = remote[m.code]
                val unchanged = r != null && r.optString("material_name") == m.name && r.optString("unit") == m.unit &&
                    r.optString("unit_confirmed").equals(if (m.isUnitConfirmed) "yes" else "no", ignoreCase = true) &&
                    r.optString("status").equals(if (m.isActive) "active" else "inactive", ignoreCase = true) &&
                    r.optString("current_stock", "0") == stock && r.optString("location_id").ifBlank { "LOC-CENTRAL" } == locationId
                if (unchanged) { same++; continue }
                if (r != null) {
                    val data = JSONObject().apply {
                        put("material_name", m.name); put("unit", m.unit)
                        put("unit_confirmed", if (m.isUnitConfirmed) "yes" else "no")
                        put("status", if (m.isActive) "active" else "inactive")
                        put("notes", m.notes); put("updated_by", "app-$locationId")
                        put("location_id", locationId); put("current_stock", stock)
                    }
                    val payload = JSONObject().apply {
                        put("payload", JSONObject().apply {
                            put("submission_ids", org.json.JSONArray().put(r.optString("_id")))
                            put("data", data)
                        })
                    }
                    val (status, body) = sendJson("PATCH", "${KoboConfig.serverUrl.trimEnd('/')}/api/v2/assets/${KoboConfig.uidCatalogue}/data/bulk/", payload.toString())
                    if (status in 200..299) sent++ else return@withContext "Catalogue update stopped after $sent: HTTP $status $body"
                } else {
                    val recordUuid = java.util.UUID.randomUUID().toString()
                    val xml = OpenRosaXml.buildCatalogueRecord(
                        form.idString, form.uuid, recordUuid, m.code, m.name, m.unit, m.isUnitConfirmed, m.isActive,
                        m.notes, "app-$locationId", locationId, stock
                    )
                    val (status, body) = postOpenRosaSubmission(xml)
                    if (status == 201 || status == 202) sent++ else return@withContext "Catalogue upload stopped after $sent: HTTP $status $body"
                }
            }
            "Catalogue and current stock uploaded for $locationId: $sent updated, $same already up to date."
        } catch (e: Exception) {
            "Catalogue upload failed: ${e.message}"
        }
    }

    data class CloseDayPlan(val pullMessage: String, val hits: List<DuplicateCheck.Hit>)

    /** Step 1 of "Close day and sync": pull what others recorded, then look for drafts that repeat an existing record. */
    suspend fun prepareCloseDay(dao: AppDao): CloseDayPlan {
        val pulled = restoreLedgerFromKobo(dao)
        val all = dao.getAllTransactionsWithLines()
        val drafts = all.filter { (it.transaction.syncStatus == "PENDING" || it.transaction.syncStatus == "FAILED") && it.transaction.koboSubmissionId == null }
        return CloseDayPlan(pulled.message, DuplicateCheck.find(all, drafts))
    }

    /** Step 2: send every draft to its Kobo form. */
    suspend fun closeDay(dao: AppDao): String = processSyncQueue(dao).summaryMessage

    private fun sendJson(method: String, url: String, body: String): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            try { conn.requestMethod = method } catch (e: java.net.ProtocolException) {
                conn.requestMethod = "POST"
                conn.setRequestProperty("X-HTTP-Method-Override", method)
            }
            conn.setRequestProperty("Authorization", "Token ${KoboConfig.token}")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            return code to text.take(200)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Disaster recovery & ledger restoration from KoboToolbox.
     * Downloads all submissions via pagination, reconstructs local transactions.
     * Preserves any local unsynced records.
     */
    suspend fun restoreLedgerFromKobo(dao: AppDao): RestoreResult = withContext(Dispatchers.IO) {
        if (!KoboConfig.isConfigured) {
            return@withContext RestoreResult(0, 0, "Kobo configuration missing.")
        }
        var imported = 0
        var skipped = 0
        var updatedCount = 0
        var linkedCount = 0
        try {
            // (form UID, kind): the Records form, the Staff Handover & Supplies form and the Stock Balance form
            val forms = listOf(KoboConfig.formUid to "TX", KoboConfig.uidHandover to "TX", KoboConfig.uidStock to "TX")
                .filter { it.first.isNotBlank() }.distinctBy { it.first }
            val nowIso = Instant.now().toString()
            for ((uid, _) in forms) {
                for (row in fetchAllRows(uid)) {
                    val remote = KoboRows.toTransaction(row)
                    val clientUuid = remote.transaction.clientTxUuid
                    val local = dao.getTransactionWithLines(clientUuid)
                    when (val d = SyncRules.decide(local, remote, nowIso)) {
                        SyncRules.Decision.Add -> {
                            // unknown materials / suppliers on the record are added so it can be shown
                            val lines = remote.lines.map { line ->
                                val known = dao.getMaterial(line.materialCode)
                                if (known == null && line.materialCode.isNotEmpty() && line.materialName.isNotEmpty()) {
                                    dao.insertMaterialIfAbsent(
                                        MaterialEntity(line.materialCode, line.materialName, line.unit.ifEmpty { UNIT_NEEDS_CONFIRMATION },
                                            isUnitConfirmed = line.unit.isNotEmpty(), notes = "Restored from Kobo", isCustom = true)
                                    )
                                }
                                line.copy(materialName = known?.name ?: line.materialName)
                            }
                            val tx = remote.transaction
                            if (tx.supplierName.isNotEmpty() && dao.findSupplierByName(tx.supplierName) == null) {
                                dao.upsertSupplier(SupplierEntity(tx.supplierId.ifEmpty { "SUP-" + clientUuid.take(8) }, tx.supplierName))
                            }
                            dao.saveTransactionWithLines(tx, lines)
                            imported++
                        }
                        is SyncRules.Decision.Replace -> { dao.replaceTransactionContent(d.merged.transaction, d.merged.lines); updatedCount++ }
                        is SyncRules.Decision.Link -> {
                            val old = local!!.transaction
                            dao.updateTransactionSyncStatus(clientUuid, if (d.markSynced) "SYNCED" else old.syncStatus, d.submissionId, d.instanceId, if (d.markSynced) "" else old.syncErrorMessage)
                            linkedCount++
                        }
                        else -> skipped++
                    }
                }
            }
        } catch (e: Exception) {
            return@withContext RestoreResult(imported + updatedCount, skipped, "Restoration error: ${e.message}")
        }
        RestoreResult(imported + updatedCount, skipped, "Restored from Kobo: $imported new, $updatedCount updated, $linkedCount linked to their Kobo submission ($skipped unchanged or newer on this phone).")
    }
}
