package com.wanan.shortcut

import android.content.Context
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.IdentityProvider
import com.wanan.shortcut.core.identity.IdentityStore
import com.wanan.shortcut.core.identity.TokenBox
import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.prefs.AppPrefsStore
import com.wanan.shortcut.core.prefs.HomePrefsStore
import com.wanan.shortcut.core.prefs.JsonListStore
import com.wanan.shortcut.feature.bind.BindViewModel
import com.wanan.shortcut.feature.linked.taskwall.TaskwallRepository
import com.wanan.shortcut.feature.linked.taskwall.TaskwallViewModel
import com.wanan.shortcut.feature.local.notes.Note
import com.wanan.shortcut.feature.local.notes.NotesRepository
import com.wanan.shortcut.feature.local.notes.NotesViewModel
import com.wanan.shortcut.framework.HomeLayoutStore
import com.wanan.shortcut.framework.InMemoryHomeLayoutStore
import com.wanan.shortcut.framework.ModuleRegistry

/**
 * 极简手写 DI 容器。
 *
 * 为什么不用 Hilt/Koin：本项目的依赖图很小（十来个对象），
 * 引入注解处理器会拉长构建时间、增加版本兼容面，收益有限。
 * 这里用 `by lazy` 保证单例与线程安全，够用且零额外依赖。
 *
 * **规则**：只有这里能 `new` 出全局单例；板块不得自己构造 [ApiClient] 等基础设施，
 * 一律通过 ViewModel 的构造参数注入——将来换 DI 方案时只改本文件。
 */
class AppContainer(context: Context) {

    private val appContext: Context = context.applicationContext

    // ---- core/identity ----
    val identityStore: IdentityStore by lazy { IdentityStore(appContext) }
    val tokenBox: TokenBox by lazy { TokenBox(appContext) }
    val identityProvider: IdentityProvider by lazy { IdentityProvider(identityStore, tokenBox) }

    // ---- core/error ----
    val errorMapper: ErrorMapper by lazy { ErrorMapper() }

    // ---- core/net ----
    val apiClient: ApiClient by lazy { ApiClient(identityProvider, errorMapper) }

    // ---- core/prefs ----
    val appPrefs: AppPrefsStore by lazy { AppPrefsStore(appContext) }
    val homePrefs: HomePrefsStore by lazy { HomePrefsStore(appContext) }

    /**
     * 首页布局存储。
     *
     * 当前用内存实现（等价于"还没有个性化功能"）。
     * 将来做自定义排序/分组/标签时，**只把这里换成**
     * `DataStoreHomeLayoutStore(appContext)` **即可**，首页渲染代码不受影响
     * （设计与预留见 `docs/android/安卓端框架设计.md` §3.3）。
     */
    val homeLayoutStore: HomeLayoutStore by lazy { InMemoryHomeLayoutStore() }

    // ---- framework ----
    /**
     * 模块注册表。
     *
     * ★ 加板块 = 在 `Modules.all()` 里加一行（框架给自己定的验收标准）。
     */
    val moduleRegistry: ModuleRegistry by lazy { ModuleRegistry(moduleList, apiClient) }

    private val moduleList: List<com.wanan.shortcut.framework.ShortcutModule> by lazy {
        Modules.all()
    }

    // ---- feature ViewModels ----
    fun bindViewModel(): BindViewModel = BindViewModel(apiClient, identityProvider, errorMapper)

    /**
     * 板块的 ViewModel 也在这里构造，保证依赖只有一处来源。
     *
     * 这是"加板块只改一个文件"的**唯一例外**：`Modules.all()` 加一行，这里加一个构造方法。
     * 之所以接受：ViewModel 需要依赖注入，而 Kotlin 没有零成本自动装配；
     * 两处改动都是"加一行"，且都集中在框架可见的位置，不会漏。
     */
    fun taskwallViewModel(): TaskwallViewModel =
        TaskwallViewModel(TaskwallRepository(apiClient), errorMapper)

    /** 笔记（本机板块）：注意它**不需要** apiClient / errorMapper。 */
    fun notesViewModel(): NotesViewModel =
        NotesViewModel(notesRepository)

    private val notesRepository: NotesRepository by lazy {
        NotesRepository(
            JsonListStore(appContext, keyName = "notes_v1", clazz = Note::class.java),
        )
    }

    /**
     * 清除本机板块数据（设置页"存储"分片用）。
     *
     * 集中在这里而不是让设置页直接 new 一个 store：
     * 本机板块的数据 key 属于该板块，设置页不该知道。
     * 将来本机板块变多时，这里改成遍历各板块自己声明的"可清理数据"，设置页不用改。
     */
    suspend fun clearLocalModuleData() {
        JsonListStore(appContext, keyName = "notes_v1", clazz = Note::class.java).clear()
    }
}
