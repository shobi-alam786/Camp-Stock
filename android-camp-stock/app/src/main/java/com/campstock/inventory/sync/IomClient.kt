package com.campstock.inventory.sync

import com.campstock.inventory.model.IomRecords
import com.campstock.inventory.security.IomAccess
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** IOM Kobo reader (GET only). Follows the API's `next` link until every page is read. */
object IomClient {
    data class Result(
        val rows: List<IomRecords.Row> = emptyList(),
        val submissions: Int = 0,
        val total: Int = 0,
        val skippedDuplicates: Int = 0,
        val error: String? = null
    )

    private fun toValue(v: Any?): Any? = when (v) {
        is JSONObject -> toMap(v)
        is JSONArray -> (0 until v.length()).map { toValue(v.opt(it)) }
        JSONObject.NULL -> null
        else -> v
    }

    private fun toMap(o: JSONObject): Map<String, Any?> = o.keys().asSequence().associateWith { toValue(o.opt(it)) }

    suspend fun fetch(
        s: IomAccess.Settings, from: String, to: String,
        onProgress: (loaded: Int, total: Int) -> Unit = { _, _ -> }
    ): Result = withContext(Dispatchers.IO) {
        var rows: List<IomRecords.Row> = emptyList()
        var submissions = 0
        var skipped = 0
        var total = 0
        var url: String? = IomRecords.buildFirstUrl(s.server, s.uid, from, to)
        val visited = HashSet<String>()
        try {
            while (url != null && visited.add(url)) {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 20_000
                conn.readTimeout = 60_000
                if (s.token.isNotBlank()) conn.setRequestProperty("Authorization", "Token ${s.token.trim()}")
                conn.setRequestProperty("Accept", "application/json")
                try {
                    val code = conn.responseCode
                    if (code == 401 || code == 403) return@withContext Result(rows, submissions, total, skipped, "IOM Kobo refused access (HTTP $code). The data is not public: add an API token under Connection.")
                    if (code != 200) return@withContext Result(rows, submissions, total, skipped, "IOM Kobo returned HTTP $code.")
                    val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                    total = json.optInt("count", total)
                    val arr = json.optJSONArray("results") ?: JSONArray()
                    val incoming = (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(::toMap) }
                    val merged = IomRecords.merge(rows, incoming)
                    rows = merged.rows
                    submissions += merged.added
                    skipped += merged.skipped
                    onProgress(submissions, total)
                    url = IomRecords.safeNextUrl(if (json.isNull("next")) null else json.optString("next"))
                } finally {
                    conn.disconnect()
                }
            }
            Result(rows, submissions, total, skipped)
        } catch (e: Exception) {
            Result(rows, submissions, total, skipped, "Could not reach IOM Kobo: ${e.message ?: "network error"}")
        }
    }
}
