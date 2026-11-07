package com.campstock.inventory.model

import android.content.Context
import com.campstock.inventory.data.AppDao
import com.campstock.inventory.data.AppSettingEntity
import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.ui.components.TxWriter
import java.util.UUID

/**
 * One-time import of the "Stock Balance - Camp 13" list dated 18-10-2026 into Central Camp Warehouse.
 * Safe to run twice: it only writes the DIFFERENCE between the list and the opening stock already recorded.
 * Rows starting with NEW: are materials that were not in the 45-item catalogue.
 */
object OpeningBalance20261018 {
    private const val FLAG = "opening_balance_2026_10_18"
    private const val LOCATION = "LOC-CENTRAL"

    // code (or NEW:name), unit, quantity (blank = quantity not given, unit is still confirmed)
    private val ROWS = listOf(
        Triple("MAT-0005", "BAG", "860.16"),
        Triple("MAT-0004", "PCS", "151280"),
        Triple("MAT-0003", "CUM", "198.918"),
        Triple("MAT-0006", "CUM", "50.948"),
        Triple("MAT-0001", "PCS", "165"),
        Triple("MAT-0045", "PCS", "200"),
        Triple("MAT-0002", "PCS", "3818"),
        Triple("MAT-0026", "BUNDLE", "3745"),
        Triple("MAT-0027", "BUNDLE", "3759"),
        Triple("MAT-0010", "M", "1523.356"),
        Triple("MAT-0030", "PCS", "3332"),
        Triple("MAT-0009", "PCS", "800"),
        Triple("MAT-0008", "PCS", "400"),
        Triple("MAT-0007", "PCS", "650"),
        Triple("MAT-0013", "KG", "12.82"),
        Triple("MAT-0014", "KG", "10.46"),
        Triple("MAT-0015", "KG", "2"),
        Triple("MAT-0029", "KG", "0.85"),
        Triple("MAT-0028", "KG", "173.353"),
        Triple("MAT-0043", "KG", "50"),
        Triple("MAT-0022", "PCS", "155"),
        Triple("MAT-0021", "PCS", "96"),
        Triple("MAT-0011", "CUM", "6.408"),
        Triple("MAT-0012", "CUM", "382.6"),
        Triple("MAT-0018", "PCS", "12"),
        Triple("MAT-0020", "PCS", "16"),
        Triple("MAT-0019", "PCS", "47"),
        Triple("MAT-0036", "FT", "130.014"),
        Triple("MAT-0037", "PCS", "146"),
        Triple("MAT-0031", "PCS", "6"),
        Triple("MAT-0032", "PCS", "40"),
        Triple("MAT-0033", "PCS", "40"),
        Triple("MAT-0035", "PCS", "40"),
        Triple("MAT-0017", "PCS", "129"),
        Triple("NEW:Nut", "PCS", "129"),
        Triple("MAT-0039", "PCS", ""),
        Triple("MAT-0040", "PCS", "5"),
        Triple("MAT-0041", "PCS", "10"),
        Triple("NEW:Steel Brackets", "PCS", "58"),
        Triple("MAT-0023", "PCS", "6"),
        Triple("MAT-0024", "PCS", "18")
    )

    suspend fun applyOnce(context: Context, dao: AppDao) {
        if (dao.getSetting(FLAG) != null) return
        val materials = dao.getAllMaterials()
        if (materials.size < 45) return // catalogue not seeded yet; try again next launch

        val txs = dao.getAllTransactionsWithLines()
        val opening = CatalogueOps.openingBalances(LOCATION, txs)
        val lines = ArrayList<QtyLine>()

        for ((key, unit, qty) in ROWS) {
            var m: MaterialEntity? = if (key.startsWith("NEW:")) dao.findMaterialByName(key.removePrefix("NEW:")) else dao.getMaterial(key)
            if (m == null && key.startsWith("NEW:")) {
                m = MaterialEntity(
                    code = "CUS-" + UUID.randomUUID().toString().take(6).uppercase(),
                    name = key.removePrefix("NEW:"), unit = unit, isUnitConfirmed = true,
                    notes = "Added from Camp 13 stock balance 18-10-2026", isCustom = true
                )
                dao.insertMaterialIfAbsent(m)
            }
            if (m == null) return // unexpected: leave flag unset so it is retried
            val updated = m.copy(unit = unit, isUnitConfirmed = true)
            if (updated != m) dao.updateMaterial(updated)
            if (qty.isNotEmpty()) {
                val delta = DecimalSafe.parse(qty).subtract(opening[updated.code] ?: java.math.BigDecimal.ZERO)
                if (delta.signum() != 0) lines.add(QtyLine(updated, DecimalSafe.format(delta)))
            }
        }

        if (lines.isNotEmpty()) {
            TxWriter.save(
                context, dao, "OPENING_STOCK", "2026-10-18", src = LOCATION, dst = LOCATION,
                staff = "Opening balance", ref = "OPN-20261018-CAMP13",
                notes = "Stock Balance - Camp 13, 18-10-2026", items = lines, rememberStaff = false
            )
        }
        dao.setSetting(AppSettingEntity(FLAG, "done"))
    }
}
