package com.campstock.inventory.model

import com.campstock.inventory.data.DecimalSafe
import com.campstock.inventory.data.MaterialEntity
import com.campstock.inventory.data.TransactionEntity
import com.campstock.inventory.data.TransactionLineEntity
import com.campstock.inventory.data.TransactionWithLines
import java.time.Instant
import java.util.UUID
import java.math.BigDecimal
import java.time.LocalDate
import java.time.LocalTime

/**
 * Catalogue maintenance (opening stock, bulk add) and staff handover.
 * Pure functions, same rules as the Windows app (src/utils/catalogueOps.ts).
 */
object CatalogueOps {
    private val QTY = Regex("^\\d{1,9}(\\.\\d{1,4})?$")
    private val PHONE = Regex("^[+0-9][0-9 ()\\-]*$")

    /** Opening quantity typed in the catalogue: zero or more, at most 4 decimals. */
    fun isValidOpeningQty(text: String): Boolean = QTY.matches(text.trim())

    /**
     * Opening stock stays an append-only ledger: "change the quantity" adds one OPENING_STOCK record
     * holding the difference (desired - current opening). It can be negative; zero means no record.
     */
    fun openingDelta(desired: String, currentOpening: BigDecimal): BigDecimal =
        DecimalSafe.parse(desired).subtract(currentOpening)

    /** Opening stock of one material at one location (sum of OPENING_STOCK records). */
    fun openingFor(materialCode: String, locationId: String, transactions: List<TransactionWithLines>): BigDecimal =
        StockCalculator.calculate(materialCode, locationId, transactions).let { DecimalSafe.parse(it.openingStock) }

    /** Effective baseline per material: newest STOCK_BASELINE wins; legacy opening entries remain fallback. */
    fun openingBalances(locationId: String, transactions: List<TransactionWithLines>): Map<String, BigDecimal> {
        val legacy = HashMap<String, BigDecimal>()
        val baseline = HashMap<String, Pair<String, BigDecimal>>()
        for (item in transactions) {
            val tx = item.transaction
            if (tx.destinationLocationId != locationId) continue
            for (line in item.lines) {
                when (tx.txType) {
                    "OPENING_STOCK" -> legacy[line.materialCode] = (legacy[line.materialCode] ?: BigDecimal.ZERO).add(DecimalSafe.parse(line.quantity))
                    "STOCK_BASELINE" -> {
                        val old = baseline[line.materialCode]
                        if (old == null || tx.txDateTime >= old.first) baseline[line.materialCode] = tx.txDateTime to DecimalSafe.parse(line.quantity)
                    }
                }
            }
        }
        val result = legacy.toMutableMap()
        baseline.forEach { (code, value) -> result[code] = value.second }
        // a stock-count snapshot is reported as the opening value that makes opening + movements = current stock
        val snapshotCodes = transactions.filter { BaselineRules.isSnapshot(it.transaction.txType, it.transaction.referenceNumber) && it.transaction.destinationLocationId == locationId }
            .flatMap { it.lines.map { l -> l.materialCode } }.toSet()
        for (code in snapshotCodes) {
            result[code] = DecimalSafe.parse(StockCalculator.calculate(code, locationId, transactions).openingStock)
        }
        return result
    }

    // ------------------------------------------------------------------ exact stock counts (one material = one Kobo submission)

    /** A transaction and its lines, ready to save. [replaces] = it changes an existing record (same clientTxUuid, same Kobo ids). */
    data class StockPlan(val tx: TransactionEntity, val lines: List<TransactionLineEntity>, val replaces: Boolean)

    private fun autoRef(prefix: String, now: Instant) =
        "$prefix-${now.toString().take(10).replace("-", "")}-${UUID.randomUUID().toString().take(4).uppercase()}"

    /** The record a quantity edit must update: newest single-material STOCK_BASELINE of this material at this location. */
    fun findBaselineRecord(code: String, locationId: String, transactions: List<TransactionWithLines>): TransactionWithLines? =
        transactions
            .filter { it.transaction.txType == "STOCK_BASELINE" && it.transaction.destinationLocationId == locationId && it.lines.size == 1 && it.lines[0].materialCode == code }
            .maxByOrNull { BaselineRules.instant(it.transaction.txDateTime) }

    /**
     * Sets the current stock of one material to EXACTLY [desiredQty]. First time: one new single-material record.
     * Later: the SAME record (same clientTxUuid and Kobo _id/_uuid) with the new quantity and status PENDING, so the next
     * sync updates the existing Kobo submission. Returns null when the stock already equals the quantity.
     */
    fun planStockCount(
        material: MaterialEntity, locationId: String, desiredQty: String, staff: String,
        transactions: List<TransactionWithLines>, now: Instant = Instant.now()
    ): StockPlan? {
        val current = StockCalculator.calculate(material.code, locationId, transactions).currentStock
        if (DecimalSafe.compare(desiredQty, current) == 0) return null
        val qty = DecimalSafe.format(DecimalSafe.parse(desiredQty))
        val iso = now.toString()
        val notes = "Current stock count: $current -> $qty ${material.unit}"
        val existing = findBaselineRecord(material.code, locationId, transactions)
        if (existing != null) {
            val old = existing.transaction
            val reopen = old.syncStatus == "SYNCED" || old.syncStatus == "SYNCING"
            val tx = old.copy(
                txDateTime = iso, staffId = staff.trim().ifEmpty { old.staffId },
                referenceNumber = if (BaselineRules.isSnapshot(old.txType, old.referenceNumber)) old.referenceNumber else autoRef("SNAP", now),
                notes = notes, syncStatus = if (reopen) "PENDING" else old.syncStatus, syncErrorMessage = "", modifiedAt = iso
            )
            return StockPlan(tx, listOf(existing.lines[0].copy(materialName = material.name, unit = material.unit, quantity = qty)), true)
        }
        val tx = newBaseline(material, locationId, qty, staff, notes, now)
        return StockPlan(tx, listOf(newLine(tx, material, qty)), false)
    }

    /** One current-stock record PER new material (quantity 0 rows are skipped). */
    fun planBaselineRecords(items: List<Pair<MaterialEntity, String>>, locationId: String, staff: String, now: Instant = Instant.now()): List<StockPlan> =
        items.filter { DecimalSafe.parse(it.second).signum() != 0 }.map { (m, q) ->
            val qty = DecimalSafe.format(DecimalSafe.parse(q))
            val tx = newBaseline(m, locationId, qty, staff, "Current stock entered with new catalogue material", now)
            StockPlan(tx, listOf(newLine(tx, m, qty)), false)
        }

    private fun newBaseline(m: MaterialEntity, locationId: String, qty: String, staff: String, notes: String, now: Instant): TransactionEntity {
        val iso = now.toString()
        return TransactionEntity(
            clientTxUuid = UUID.randomUUID().toString(), txType = "STOCK_BASELINE", txDateTime = iso,
            sourceLocationId = locationId, destinationLocationId = locationId, staffId = staff.trim(),
            referenceNumber = autoRef("SNAP", now), notes = notes, syncStatus = "PENDING", createdAt = iso, modifiedAt = iso
        )
    }

    private fun newLine(tx: TransactionEntity, m: MaterialEntity, qty: String) = TransactionLineEntity(
        lineId = "${tx.clientTxUuid}-line-1", clientTxUuid = tx.clientTxUuid, materialCode = m.code,
        materialName = m.name, quantity = qty, unit = m.unit
    )

    // ------------------------------------------------------------------ bulk add

    data class BulkRow(val line: Int, val name: String, val unit: String, val qty: String, val error: String? = null)

    /**
     * One material per line: "Name, Unit, Quantity" (comma, semicolon or tab).
     * Use semicolons or tabs if decimals are written with a comma. Quantity is optional (blank = 0).
     */
    fun parseBulk(text: String, existingNames: List<String>): List<BulkRow> {
        val seen = existingNames.map { it.trim().lowercase() }.toMutableSet()
        val rows = ArrayList<BulkRow>()
        text.lines().forEachIndexed { i, raw ->
            if (raw.isBlank()) return@forEachIndexed
            val sep = if (raw.contains(';') || raw.contains('\t')) Regex("[;\t]") else Regex(",")
            val parts = raw.split(sep).map { it.trim() }
            val name = (parts.getOrNull(0) ?: "").replace(Regex("\\s+"), " ")
            val unit = (parts.getOrNull(1) ?: "").uppercase()
            val qty = (parts.getOrNull(2) ?: "").replace(',', '.').ifEmpty { "0" }
            val error = when {
                name.isEmpty() -> "Missing name."
                unit.isEmpty() -> "Missing unit."
                !isValidOpeningQty(qty) -> "\"${parts.getOrNull(2)}\" is not a valid quantity."
                name.lowercase() in seen -> "Already in the catalogue or repeated above."
                else -> null
            }
            if (error == null) seen.add(name.lowercase())
            rows.add(BulkRow(i + 1, name, unit, qty, error))
        }
        return rows
    }

    // ------------------------------------------------------------------ staff handover

    fun isValidPhone(text: String): Boolean {
        val t = text.trim()
        return PHONE.matches(t) && t.count { it.isDigit() } >= 6
    }

    data class HandoverInput(
        val fromName: String, val fromPhone: String,
        val toName: String, val toPhone: String,
        val date: String
    )

    /** Returns an error text, or "" when the form is complete. */
    fun validateHandover(
        i: HandoverInput,
        today: LocalDate = LocalDate.now(),
        now: LocalTime = LocalTime.now()
    ): String = when {
        i.fromName.isBlank() -> "Enter the name of the staff who is handing over."
        !isValidPhone(i.fromPhone) -> "Enter a valid phone number for the staff who is handing over."
        i.toName.isBlank() -> "Enter the name of the staff who is taking over."
        !isValidPhone(i.toPhone) -> "Enter a valid phone number for the staff who is taking over."
        i.fromName.trim().equals(i.toName.trim(), true) &&
            i.fromPhone.filter { it.isDigit() } == i.toPhone.filter { it.isDigit() } -> "The two staff are the same person."
        FormUtil.dateToIsoInstant(i.date, today, now) == null -> "Date must be yyyy-MM-dd and not in the future."
        else -> ""
    }

    /** Every material with a balance other than zero at the location (a deficit is shown too). */
    fun handoverSnapshot(
        materials: List<MaterialEntity>,
        locationId: String,
        transactions: List<TransactionWithLines>
    ): List<Pair<MaterialEntity, BigDecimal>> {
        val balances = StockCalculator.balancesFor(locationId, transactions)
        return materials.mapNotNull { m ->
            val b = balances[m.code] ?: BigDecimal.ZERO
            if (b.signum() != 0) m to b else null
        }
    }
}
