package com.campstock.inventory.security

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Local PIN lock (4 or 6 digits) for the hidden "clean local records" tool.
 * Only a salted SHA-256 hash is stored; the PIN itself is never saved.
 * After 5 wrong tries the tool is locked for 60 seconds.
 */
object PinLock {
    private const val PREFS = "camp_stock_pin_lock"
    private const val K_HASH = "pin_hash"
    private const val K_SALT = "pin_salt"
    private const val K_FAILS = "fails"
    private const val K_LOCK_UNTIL = "lock_until"
    private const val MAX_FAILS = 5
    private const val LOCK_MS = 60_000L

    sealed class Result {
        object Ok : Result()
        data class Wrong(val triesLeft: Int) : Result()
        data class Locked(val seconds: Int) : Result()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isValidFormat(pin: String) = (pin.length == 4 || pin.length == 6) && pin.all { it in '0'..'9' }

    fun isPinSet(context: Context) = prefs(context).getString(K_HASH, null) != null

    fun setPin(context: Context, pin: String) {
        val saltBytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val salt = toHex(saltBytes)
        prefs(context).edit()
            .putString(K_SALT, salt)
            .putString(K_HASH, hash(salt, pin))
            .putInt(K_FAILS, 0)
            .putLong(K_LOCK_UNTIL, 0L)
            .apply()
    }

    fun lockedSeconds(context: Context): Int {
        val left = prefs(context).getLong(K_LOCK_UNTIL, 0L) - System.currentTimeMillis()
        return if (left > 0) ((left + 999) / 1000).toInt() else 0
    }

    fun verify(context: Context, pin: String): Result {
        val locked = lockedSeconds(context)
        if (locked > 0) return Result.Locked(locked)
        val p = prefs(context)
        val expected = p.getString(K_HASH, null) ?: return Result.Wrong(0)
        val salt = p.getString(K_SALT, "") ?: ""
        val ok = MessageDigest.isEqual(hash(salt, pin).toByteArray(), expected.toByteArray())
        if (ok) {
            p.edit().putInt(K_FAILS, 0).putLong(K_LOCK_UNTIL, 0L).apply()
            return Result.Ok
        }
        val fails = p.getInt(K_FAILS, 0) + 1
        if (fails >= MAX_FAILS) {
            p.edit().putInt(K_FAILS, 0).putLong(K_LOCK_UNTIL, System.currentTimeMillis() + LOCK_MS).apply()
            return Result.Locked((LOCK_MS / 1000).toInt())
        }
        p.edit().putInt(K_FAILS, fails).apply()
        return Result.Wrong(MAX_FAILS - fails)
    }

    private fun hash(salt: String, pin: String): String =
        toHex(MessageDigest.getInstance("SHA-256").digest("$salt:$pin".toByteArray()))

    private fun toHex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
}
