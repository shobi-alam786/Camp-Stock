package com.campstock.inventory.model

import com.campstock.inventory.data.MaterialEntity
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** A material chosen on a form, with the quantity typed so far. */
data class QtyLine(val material: MaterialEntity, val qty: String = "", val damagedQty: String = "0")

object FormUtil {
    private val QTY = Regex("^\\d{1,9}(\\.\\d{1,4})?$")

    /** Positive number with at most 4 decimals (same scale as DecimalSafe). */
    fun isValidQty(text: String): Boolean {
        val t = text.trim()
        return QTY.matches(t) && t.toBigDecimal().signum() > 0
    }

    /** Counted quantity: zero is allowed (shelf is empty), negative is not. */
    fun isValidCountQty(text: String): Boolean = QTY.matches(text.trim()) 

    /**
     * "2026-10-20" -> ISO instant using the current time of day.
     * Returns null when the text is not a date or the date is in the future.
     */
    fun dateToIsoInstant(text: String, today: LocalDate = LocalDate.now(), now: LocalTime = LocalTime.now()): String? {
        val d = try { LocalDate.parse(text.trim()) } catch (e: Exception) { return null }
        if (d.isAfter(today)) return null
        return d.atTime(now).atZone(ZoneId.systemDefault()).toInstant().toString()
    }
}
