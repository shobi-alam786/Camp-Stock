package com.campstock.inventory.security

import android.content.Context
import com.campstock.inventory.model.IomRecords
import java.security.MessageDigest

/**
 * Access gate and connection settings for IOM Stock Records.
 * Only a salted SHA-256 hash of the password is in the app, not the password itself.
 * This is a casual lock: it hides the screen from ordinary users, it does not stop someone who takes the app apart.
 * The Kobo API token is the real secret; it is typed in on the device and never in the source.
 */
object IomAccess {
    private const val PASSWORD_HASH = "00418d850403533c52ffff0a6a77c0808f011baa20e83557d15ca4bcc3374d2b"
    private const val SALT = "campstock-iom"
    private const val PREFS = "camp_stock_iom"
    private const val K_FAILS = "fails"
    private const val K_LOCK_UNTIL = "lock_until"
    private const val K_SERVER = "server"
    private const val K_UID = "uid"
    private const val K_TOKEN = "token"
    private const val MAX_FAILS = 5
    private const val LOCK_MS = 60_000L

    sealed class Result {
        object Ok : Result()
        data class Wrong(val triesLeft: Int) : Result()
        data class Locked(val seconds: Int) : Result()
    }

    data class Settings(val server: String, val uid: String, val token: String)

    private fun prefs(c: Context) = c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun hashOf(password: String): String =
        MessageDigest.getInstance("SHA-256").digest("$SALT:$password".toByteArray()).joinToString("") { "%02x".format(it) }

    fun lockedSeconds(c: Context): Int {
        val left = prefs(c).getLong(K_LOCK_UNTIL, 0L) - System.currentTimeMillis()
        return if (left > 0) ((left + 999) / 1000).toInt() else 0
    }

    fun verify(c: Context, password: String): Result {
        val locked = lockedSeconds(c)
        if (locked > 0) return Result.Locked(locked)
        val p = prefs(c)
        if (MessageDigest.isEqual(hashOf(password).toByteArray(), PASSWORD_HASH.toByteArray())) {
            p.edit().putInt(K_FAILS, 0).putLong(K_LOCK_UNTIL, 0L).apply()
            return Result.Ok
        }
        val fails = p.getInt(K_FAILS, 0) + 1
        return if (fails >= MAX_FAILS) {
            p.edit().putInt(K_FAILS, 0).putLong(K_LOCK_UNTIL, System.currentTimeMillis() + LOCK_MS).apply()
            Result.Locked((LOCK_MS / 1000).toInt())
        } else {
            p.edit().putInt(K_FAILS, fails).apply()
            Result.Wrong(MAX_FAILS - fails)
        }
    }

    fun load(c: Context): Settings {
        val p = prefs(c)
        return Settings(
            server = p.getString(K_SERVER, null)?.ifBlank { null } ?: IomRecords.DEFAULT_SERVER,
            uid = p.getString(K_UID, null)?.ifBlank { null } ?: IomRecords.DEFAULT_UID,
            token = p.getString(K_TOKEN, "") ?: ""
        )
    }

    fun save(c: Context, s: Settings) {
        prefs(c).edit().putString(K_SERVER, s.server.trim()).putString(K_UID, s.uid.trim()).putString(K_TOKEN, s.token.trim()).apply()
    }
}
