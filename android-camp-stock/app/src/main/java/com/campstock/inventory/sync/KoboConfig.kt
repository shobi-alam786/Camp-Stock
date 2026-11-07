package com.campstock.inventory.sync

import android.content.Context
import android.content.SharedPreferences

object KoboConfig {
    private const val PREFS_NAME = "camp_stock_kobo_config"
    private const val KEY_SERVER = "kf_server"
    private const val KEY_FORM_UID = "form_uid"
    private const val KEY_FORM_ID = "form_id_string"
    private const val KEY_TOKEN = "api_token"
    private const val KEY_LAST_SYNC = "last_sync_timestamp"
    private const val KEY_DEVICE_LOCATION = "device_location_id"

    private const val KEY_UID_HANDOVER = "uid_handover"
    private const val KEY_UID_STOCK = "uid_stock"
    private const val KEY_UID_CATALOGUE = "uid_catalogue"
    private const val KEY_DAY_END = "day_end_mode"

    // Asset UIDs are identifiers, not secrets (the API token is the secret)
    const val DEFAULT_UID_CATALOGUE = "axcwQUvw74V3PnskvpjWZ9"

    private const val DEFAULT_KF = "https://kf.kobotoolbox.org"
    private const val DEFAULT_FORM_UID = "camp_stock_records"

    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    val serverUrl: String
        get() = prefs?.getString(KEY_SERVER, DEFAULT_KF)?.trimEnd('/') ?: DEFAULT_KF

    val submissionUrl: String
        get() = serverUrl.replace("//kf.", "//kc.") + "/submission"

    val formUid: String
        get() = prefs?.getString(KEY_FORM_UID, "") ?: ""

    /** Form ID (id_string) - XML root element for submissions. Not the asset UID. */
    val formId: String
        get() = prefs?.getString(KEY_FORM_ID, DEFAULT_FORM_UID) ?: DEFAULT_FORM_UID

    /** "Camp Stock - Staff Handover & Supplies" form. Empty = not set up yet. */
    val uidHandover: String
        get() = prefs?.getString(KEY_UID_HANDOVER, "") ?: ""

    /** "Camp Stock - Stock Balance" form (starting balance and stock adjustments). Empty = not set up yet. */
    val uidStock: String
        get() = prefs?.getString(KEY_UID_STOCK, "") ?: ""

    /** "Camp Stock - Material Catalogue" form. */
    val uidCatalogue: String
        get() = prefs?.getString(KEY_UID_CATALOGUE, DEFAULT_UID_CATALOGUE)?.ifBlank { DEFAULT_UID_CATALOGUE } ?: DEFAULT_UID_CATALOGUE

    /** Day-end mode (default ON): records stay drafts on this phone until "Close day and sync" is tapped. */
    val dayEndMode: Boolean
        get() = prefs?.getBoolean(KEY_DAY_END, true) ?: true

    fun setDayEndMode(on: Boolean) {
        prefs?.edit()?.putBoolean(KEY_DAY_END, on)?.apply()
    }

    /**
     * Which Kobo form a transaction type is sent to (blank = that form's UID is not set up yet).
     * [formUid] is the "Camp Stock - Records" form: received, dispatched and returned.
     */
    fun uidFor(txType: String): String = when (OpenRosaXml.formGroupFor(txType)) {
        OpenRosaXml.FormGroup.HANDOVER -> uidHandover
        OpenRosaXml.FormGroup.STOCK -> uidStock
        OpenRosaXml.FormGroup.RECORDS -> formUid
    }

    val token: String
        get() = prefs?.getString(KEY_TOKEN, "") ?: ""

    val deviceLocationId: String
        get() = prefs?.getString(KEY_DEVICE_LOCATION, "LOC-CENTRAL") ?: "LOC-CENTRAL"

    val lastSyncTimestamp: String
        get() = prefs?.getString(KEY_LAST_SYNC, "Never") ?: "Never"

    val isConfigured: Boolean
        get() = token.isNotBlank() && formUid.isNotBlank() && formId.isNotBlank()

    fun updateLastSync(timestamp: String) {
        prefs?.edit()?.putString(KEY_LAST_SYNC, timestamp)?.apply()
    }

    fun saveConfig(
        server: String, formUid: String, token: String, locationId: String, formId: String = DEFAULT_FORM_UID,
        uidHandover: String = this.uidHandover, uidStock: String = this.uidStock, uidCatalogue: String = this.uidCatalogue
    ) {
        KoboSyncManager.clearFormCache()
        prefs?.edit()
            ?.putString(KEY_UID_HANDOVER, uidHandover.trim())
            ?.putString(KEY_UID_STOCK, uidStock.trim())
            ?.putString(KEY_UID_CATALOGUE, uidCatalogue.trim())
            ?.putString(KEY_SERVER, server.trim())
            ?.putString(KEY_FORM_UID, formUid.trim())
            ?.putString(KEY_FORM_ID, formId.trim())
            ?.putString(KEY_TOKEN, token.trim())
            ?.putString(KEY_DEVICE_LOCATION, locationId.trim())
            ?.apply()
    }

    fun clear() {
        prefs?.edit()?.clear()?.apply()
    }
}
