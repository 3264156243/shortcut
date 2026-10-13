package com.wanan.shortcut.feature.local.notes

import com.google.gson.annotations.SerializedName
import com.wanan.shortcut.core.prefs.JsonListStore

/**
 * 一条笔记。
 *
 * 本机板块的数据模型：只存本机，不与任何服务端交互。
 * 用 [id] 而非列表下标做键，这样将来支持拖动排序/删除时不会错位。
 */
data class Note(
    @SerializedName("id") val id: String = "",
    @SerializedName("title") val title: String = "",
    @SerializedName("body") val body: String = "",
    /** 创建/更新时间（毫秒），用于排序与显示 */
    @SerializedName("updatedAt") val updatedAt: Long = 0L,
)

/**
 * 笔记的本地存储。
 *
 * 复用框架的 [JsonListStore]（DataStore + JSON），不自己碰文件与序列化细节——
 * 这样将来把笔记改成"绑定后同步到电脑"时，只需再加一层同步逻辑，
 * 本地读写这半边不用重写。
 *
 * ⚠️ 本类**完全不涉及** bindId / mobileToken：这就是 [com.wanan.shortcut.framework.ModuleDomain.LOCAL]
 * 板块该有的样子（框架设计 §2.1）。
 */
class NotesRepository(
    private val store: JsonListStore<Note>,
) {
    suspend fun load(): List<Note> =
        store.load().sortedByDescending { it.updatedAt }

    suspend fun upsert(note: Note): List<Note> {
        val current = store.load().toMutableList()
        val index = current.indexOfFirst { it.id == note.id }
        if (index >= 0) current[index] = note else current.add(note)
        store.save(current)
        return current.sortedByDescending { it.updatedAt }
    }

    suspend fun delete(id: String): List<Note> {
        val current = store.load().filterNot { it.id == id }
        store.save(current)
        return current.sortedByDescending { it.updatedAt }
    }

    suspend fun get(id: String): Note? = store.load().firstOrNull { it.id == id }
}
