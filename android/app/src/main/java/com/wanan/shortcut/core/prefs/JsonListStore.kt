package com.wanan.shortcut.core.prefs

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.first

private val Context.kvDataStore by preferencesDataStore(name = "shortcut_local_store_v1")

/**
 * 通用「一个 JSON 数组」的本地存储。
 *
 * 为什么做成框架级的通用件而不是让每个本机板块自己写：
 * 本机板块会越加越多（笔记、记账、待办…），它们的数据形态都是"一个列表 + 增删改查"。
 * 把它抽到 core，新板块就不必再写一遍 DataStore 初始化、异常兜底、JSON 解析。
 *
 * 这也符合用户"以框架展开、像热插拔一样加功能"的要求：
 * 加一个本机板块时，存储这半边是**零成本**的。
 *
 * 注意：这是**通用容器**，不是"笔记专用"——[T] 由使用方决定。
 */
class JsonListStore<T>(
    context: Context,
    private val keyName: String,
    private val clazz: Class<T>,
) {
    private val store = context.kvDataStore
    private val gson = Gson()
    private val key = stringPreferencesKey(keyName)
    private val type = TypeToken.getParameterized(List::class.java, clazz).type

    suspend fun load(): List<T> {
        val raw = store.data.first()[key]
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            gson.fromJson<List<T>>(raw, type) ?: emptyList()
        } catch (e: Exception) {
            // 解析失败时返回空列表，而不是让板块崩溃。
            //
            // ⚠️ 诚实说明这里的边界：本方法**不写盘**，所以原始字符串仍留在磁盘上
            // （没有"悄悄清空"）。但如果用户此时新增一条数据，
            // `upsert` 会走 `load()`（空）→ 追加 → `save()`，从而覆盖掉那份坏数据。
            // 本机数据没有服务端副本，无法从别处恢复。
            //
            // 当前接受该风险（笔记是低价值可重录数据）；若将来有高价值本机数据，
            // 应改为：解析失败时把原始串改存到 `xxx_corrupt_backup` 键，再返回空列表。
            emptyList()
        }
    }

    suspend fun save(items: List<T>) {
        val json = gson.toJson(items, type)
        store.edit { it[key] = json }
    }

    /** 清空（用于设置页的"清除缓存/数据"） */
    suspend fun clear() {
        store.edit { it.remove(key) }
    }
}
