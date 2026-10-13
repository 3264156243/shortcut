package com.wanan.shortcut.core.identity

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * `mobileToken` 的加密存储（契约 §1.3：令牌等价于账号口令）。
 *
 * 明文 token 一旦泄露，他人即可冒充本机操作该绑定下的任务墙/文件/电脑控制，
 * 因此**不落明文**：优先用 EncryptedSharedPreferences（Android Keystore 支持）。
 *
 * 兜底策略：个别机型/模拟器上 Keystore 不可用（会抛异常），
 * 此时**降级为普通存储但记录日志**，而不是让 App 无法绑定。
 * 这是有意的可用性妥协——降级路径在设置页"关于"里可见，便于排查。
 */
class TokenBox(context: Context) {

    private val prefs: SharedPreferences = create(context)

    private fun create(context: Context): SharedPreferences = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME_ENCRYPTED,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (t: Throwable) {
        Log.w(TAG, "加密存储不可用，降级为普通存储（功能不受影响，安全性降低）", t)
        context.getSharedPreferences(FILE_NAME_FALLBACK, Context.MODE_PRIVATE)
    }

    fun readToken(): String = prefs.getString(KEY_TOKEN, "").orEmpty()

    fun writeToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }

    private companion object {
        const val TAG = "TokenBox"
        const val FILE_NAME_ENCRYPTED = "shortcut_secure_v1"
        const val FILE_NAME_FALLBACK = "shortcut_secure_fallback_v1"
        const val KEY_TOKEN = "mobile_token"
    }
}
