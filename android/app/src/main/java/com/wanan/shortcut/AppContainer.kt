package com.wanan.shortcut

import android.content.Context
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.IdentityProvider
import com.wanan.shortcut.core.identity.IdentityStore
import com.wanan.shortcut.core.identity.TokenBox
import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.feature.bind.BindViewModel
import com.wanan.shortcut.framework.ModuleRegistry

/**
 * 极简手写 DI 容器。
 *
 * 为什么不用 Hilt/Koin：本项目的依赖图很小（十来个对象），
 * 引入注解处理器会拉长构建时间、增加版本兼容面，而收益有限。
 * 这里用 `by lazy` 保证单例与线程安全，够用且零额外依赖。
 *
 * **规则**：只有这里能 `new` 出全局单例；板块不得自己构造 [ApiClient] 等基础设施，
 * 一律通过 ViewModel 的构造参数注入——这样将来换成别的 DI 方案时只改本文件。
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

    // ---- framework ----
    /**
     * 模块注册表。
     *
     * ★ 加板块 = 在 [moduleList] 里加一行（这是框架给自己定的验收标准）。
     */
    val moduleRegistry: ModuleRegistry by lazy { ModuleRegistry(moduleList, apiClient) }

    private val moduleList: List<com.wanan.shortcut.framework.ShortcutModule> by lazy {
        com.wanan.shortcut.Modules.all()
    }

    // ---- feature ViewModels ----
    fun bindViewModel(): BindViewModel = BindViewModel(apiClient, identityProvider, errorMapper)
}
