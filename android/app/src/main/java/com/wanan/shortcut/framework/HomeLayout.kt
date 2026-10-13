package com.wanan.shortcut.framework

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.first

/**
 * 用户对首页的个性化（设计文档 §3.3）。
 *
 * ## 为什么现在就定义，即使这一轮不实现这些功能
 *
 * 用户明确要求"很多东西不想要一下子定死，而且可以长期扩展完善"，
 * 并点名了**自定义板块位置、分组、移动、标签、搜索**。
 *
 * 如果现在首页直接按 `ModuleSpec.order` 渲染，将来做拖动排序就必须回头改渲染代码；
 * 而先把"覆盖层"这个概念放进数据模型，**将来只需换一个 [HomeLayoutStore] 实现**，
 * 首页渲染逻辑一行都不用动。
 *
 * 也就是说：字段现在就留全，行为现在只给默认值。
 */
data class HomeLayout(
    /** moduleId → 顺序（缺省用 [ModuleSpec.order]） */
    val orderOverrides: Map<String, Int> = emptyMap(),

    /** moduleId → 自定义分组名（缺省用 [ModuleSpec.defaultGroup]） */
    val groupOverrides: Map<String, String> = emptyMap(),

    /** 被用户隐藏的 moduleId（"从首页移除"，不等于禁用板块） */
    val hidden: Set<String> = emptySet(),

    /** moduleId → 标签（为将来的标签筛选预留） */
    val tags: Map<String, List<String>> = emptyMap(),
) {
    /** 用户自定义优先，否则用板块默认分组。 */
    fun groupOf(spec: ModuleSpec): String = groupOverrides[spec.id] ?: spec.defaultGroup

    /** 用户自定义优先，否则用板块默认排序。 */
    fun orderOf(spec: ModuleSpec): Int = orderOverrides[spec.id] ?: spec.order

    fun isHidden(spec: ModuleSpec): Boolean = spec.id in hidden

    companion object {
        /** 默认布局：没有任何个性化，一切走板块默认值。 */
        val DEFAULT = HomeLayout()
    }
}

/**
 * 布局持久化接口。
 *
 * 这一轮用 [InMemoryHomeLayoutStore]（即"永远返回默认布局"）。
 * 将来实现拖动排序时，换成 DataStore 版本即可 —— **首页渲染代码不受影响**，
 * 因为首页只依赖这个接口。
 */
interface HomeLayoutStore {
    suspend fun load(): HomeLayout
    suspend fun save(layout: HomeLayout)
}

/** 当前实现：不持久化，永远返回默认布局。行为上等价于"还没有个性化功能"。 */
class InMemoryHomeLayoutStore : HomeLayoutStore {
    private var current: HomeLayout = HomeLayout.DEFAULT
    override suspend fun load(): HomeLayout = current
    override suspend fun save(layout: HomeLayout) { current = layout }
}

private val Context.layoutDataStore by preferencesDataStore(name = "shortcut_home_layout_v1")

/**
 * DataStore 实现。
 *
 * **本轮未被启用**，但先写好：它是 [HomeLayoutStore] 的"真"实现，
 * 将来做自定义排序/分组时，只需在 `AppContainer` 里把
 * `InMemoryHomeLayoutStore()` 换成 `DataStoreHomeLayoutStore(context)`，其余不动。
 *
 * 存 JSON 而非逐字段拆成 Preferences key，理由是 [HomeLayout] 的结构以后会加字段，
 * 用 JSON 可以向前兼容（老数据缺字段时用默认值补上）。
 */
class DataStoreHomeLayoutStore(private val context: Context) : HomeLayoutStore {

    private val gson = Gson()
    private val type = object : TypeToken<HomeLayout>() {}.type

    override suspend fun load(): HomeLayout {
        val raw = context.layoutDataStore.data.first()[KEY_LAYOUT]
        if (raw.isNullOrBlank()) return HomeLayout.DEFAULT
        return try {
            gson.fromJson<HomeLayout>(raw, type) ?: HomeLayout.DEFAULT
        } catch (e: Exception) {
            // 数据损坏时退回默认布局，不要因为一个偏好文件让首页起不来
            HomeLayout.DEFAULT
        }
    }

    override suspend fun save(layout: HomeLayout) {
        val json = gson.toJson(layout, type)
        context.layoutDataStore.edit { it[KEY_LAYOUT] = json }
    }

    private companion object {
        val KEY_LAYOUT = stringPreferencesKey("home_layout_json")
    }
}
