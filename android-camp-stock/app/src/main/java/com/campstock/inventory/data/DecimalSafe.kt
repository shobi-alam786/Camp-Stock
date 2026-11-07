package com.campstock.inventory.data

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Fixed-point decimal arithmetic utilities for inventory quantities.
 * Prevents IEEE-754 floating point precision issues across arithmetic operations.
 */
object DecimalSafe {
    private const val SCALE = 4

    fun parse(value: String): BigDecimal {
        val clean = value.trim()
        if (clean.isEmpty()) return BigDecimal.ZERO.setScale(SCALE, RoundingMode.HALF_UP)
        return try {
            BigDecimal(clean).setScale(SCALE, RoundingMode.HALF_UP)
        } catch (e: Exception) {
            BigDecimal.ZERO.setScale(SCALE, RoundingMode.HALF_UP)
        }
    }

    fun format(value: BigDecimal): String {
        return value.stripTrailingZeros().toPlainString()
    }

    fun add(a: String, b: String): String {
        return format(parse(a).add(parse(b)))
    }

    fun subtract(a: String, b: String): String {
        return format(parse(a).subtract(parse(b)))
    }

    fun compare(a: String, b: String): Int {
        return parse(a).compareTo(parse(b))
    }

    fun isPositive(a: String): Boolean {
        return parse(a) > BigDecimal.ZERO
    }

    fun isNegative(a: String): Boolean {
        return parse(a) < BigDecimal.ZERO
    }

    fun isZero(a: String): Boolean {
        return parse(a).compareTo(BigDecimal.ZERO) == 0
    }
}
