package com.wanan.shortcut

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ProvideModuleSubRoute
import com.wanan.shortcut.ui.components.EmptyState

/**
 * 板块宿主 —— 框架统一渲染板块页面。
 *
 * ## 它替所有板块处理的四件事
 *
 * 1. **按归属域决定是否拦截未绑定**（只拦 `LINKED`，`LOCAL` 直接放行）；
 * 2. 模块未注册时给出明确提示，而不是白屏；
 * 3. **子路由来自导航图**（不再自己维护一份状态）——
 *    这样系统返回、右滑、顶部栏返回三者行为完全一致，且子页是真正的返回栈条目；
 * 4. 未绑定时的引导面板（给"去连接"按钮，而不是一句干巴巴的提示）。
 *
 * ## 关于 inset
 *
 * 本组件**不消费任何 inset** —— 顶部栏与底部内边距已由 `MainActivity` 里
 * 唯一的那个 `Scaffold` 处理。这里再加会双重叠加（设计规范 §3 的坑）。
 */
@Composable
fun ModuleHostScreen(
    moduleId: String,
    subRoute: String?,
    identity: Identity,
    onBack: () -> Unit,
    onNavigateSub: (String) -> Unit,
    onGoBind: () -> Unit,
    navController: NavHostController? = null,
) {
    val container = LocalContext.current.appContainer
    val module = remember(moduleId) { container.moduleRegistry.get(moduleId) }

    // 进入板块时刷新一次身份：用户可能刚在设置页绑定完就切过来
    LaunchedEffect(moduleId) { container.identityProvider.restore() }

    if (module == null) {
        // 防御性分支（入口由注册表生成，正常不会走到）
        EmptyState(
            text = "这个功能当前不可用，可能已被下架。",
            title = "功能不存在",
            icon = "🚫",
        )
        return
    }

    val spec = module.spec

    // 板块内导航统一走导航图：进子页 = 压栈，返回 = 出栈。
    // 板块代码只调 navigator.to(...)，不关心实现 —— 这正是导航收敛成接口的价值。
    val navigator = remember(moduleId, onNavigateSub, onBack) {
        object : ModuleNavigator {
            override fun to(route: String) = onNavigateSub(route)

            override fun back() = onBack()

            override fun switchModule(targetId: String) {
                navController?.navigate(com.wanan.shortcut.ui.nav.Routes.module(targetId))
            }
        }
    }

    // ★ 只有联动板块需要绑定（本机板块不拦）
    val blockedByBinding = spec.domain == ModuleDomain.LINKED && !identity.isBound

    if (blockedByBinding) {
        EmptyState(
            text = "在电脑端 ShortCut 打开「移动互联」，用 6 位绑定码连接后即可使用。",
            title = "这个功能需要先连接电脑",
            icon = "🔗",
            actionText = "去连接",
            onAction = onGoBind,
        )
        return
    }

    Box(Modifier.fillMaxSize()) {
        ProvideModuleSubRoute(subRoute) {
            module.Screen(navigator)
        }
    }
}
