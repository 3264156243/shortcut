package com.wanan.shortcut.core.identity

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.identityDataStore by preferencesDataStore(name = "shortcut_identity_v1")

/**
 * 非敏感身份的持久化（bindId / deviceKey / deviceId / deviceName）。
 *
 * 敏感 token 不放这里，走 [TokenBox] 加密存储。
 *
 * ⚠️ **deviceKey 的持久性是本类存在的最重要理由**（契约 §3.4）：
 * 它必须"首次生成后长期保存"，重装/清数据之外不得改变。
 */
class IdentityStore(private val context: Context) {

    private val store = context.identityDataStore

    private object Keys {
        val BIND_ID = stringPreferencesKey("bind_id")
        val DEVICE_KEY = stringPreferencesKey("device_key")
        val DEVICE_ID = stringPreferencesKey("device_id")
        val DEVICE_NAME = stringPreferencesKey("device_name")
    }

    /**
     * 读取已持久化的 deviceKey；不存在或形状损坏时生成并**立即落盘**。
     *
     * 放在读取路径上做"惰性初始化"，好处是任何调用点都不会拿到空值，
     * 也从结构上避免"某条绑定路径忘了生成 deviceKey"。
     */
    suspend fun deviceKey(): String {
        val existing = store.data.map { it[Keys.DEVICE_KEY] }.first()
        if (!existing.isNullOrBlank() && DeviceKey.isValid(existing)) return existing

        val fresh = DeviceKey.generate()
        store.edit { it[Keys.DEVICE_KEY] = fresh }
        return fresh
    }

    suspend fun read(): PersistedIdentity = store.data.map { prefs ->
        PersistedIdentity(
            bindId = prefs[Keys.BIND_ID].orEmpty(),
            deviceKey = prefs[Keys.DEVICE_KEY].orEmpty(),
            deviceId = prefs[Keys.DEVICE_ID].orEmpty(),
            deviceName = prefs[Keys.DEVICE_NAME].orEmpty(),
        )
    }.first()

    suspend fun saveBinding(bindId: String, deviceId: String, deviceName: String) {
        store.edit { prefs ->
            prefs[Keys.BIND_ID] = bindId
            prefs[Keys.DEVICE_ID] = deviceId
            prefs[Keys.DEVICE_NAME] = deviceName
        }
    }

    suspend fun updateDeviceName(name: String) {
        store.edit { it[Keys.DEVICE_NAME] = name }
    }

    /**
     * 清除绑定信息，但**刻意保留 deviceKey**。
     *
     * 理由：契约 §3.4 的判定顺序第 1 条依赖 deviceKey 才能"原地轮换"。
     * 如果解除绑定时把 deviceKey 一起清掉，用户重新绑定就会新增一台设备，
     * 反复几次就占满上限（默认 5）——这正是契约要避免的僵尸设备问题。
     */
    suspend fun clearBinding() {
        store.edit { prefs ->
            prefs.remove(Keys.BIND_ID)
            prefs.remove(Keys.DEVICE_ID)
            prefs.remove(Keys.DEVICE_NAME)
        }
    }
}

/** 非敏感部分的快照 */
data class PersistedIdentity(
    val bindId: String,
    val deviceKey: String,
    val deviceId: String,
    val deviceName: String,
)
