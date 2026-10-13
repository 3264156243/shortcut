package com.wanan.shortcut

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.LocalModuleSubRoute
import com.wanan.shortcut.framework.ProvideModuleSubRoute
import com.wanan.shortcut.ui.components.EmptyState

/**
 * 板块宿主 —— 框架统一渲染板块页面。
 *
 * 它替所有板块处理掉这些"每个板块都会忘、忘了就出 bug"的事情：
 *   1. 身份未绑定时不放行（直接提示去绑定，而不是让板块发一个必然失败的请求）；
 *   2. 模块未注册 / 服务端未声明时给出明确提示，而不是白屏；
 *   3. 统一提供带返回按钮的容器、[ModuleNavigator] 实现与**板块内部子路由**。
 *
 * 因此板块的 [com.wanan.shortcut.framework.ShortcutModule.Screen] 里
 * **不需要**写任何"如果没绑定就…"的判断，也**不需要**自己接导航框架——
 * 用 [ModuleNavigator.to] 声明"我要去哪个子页"，再用
 * [com.wanan.shortcut.framework.ModuleSubRoute] 读当前子页即可。
 */
@Composable
fun ModuleHostScreen(
    moduleId: String,
    identity: Identity,
    onBack: () -> Unit,
    onSwitchModule: (String) -> Unit,
) {
    val container = LocalContext.current.appContainer
    val module = remember(moduleId) { container.moduleRegistry.get(moduleId) }

    // 板块内部子路由。用 rememberSaveable 以便旋转/重建后仍停在原页；
    // 换板块时重置（key = moduleId）。
    var subRoute by rememberSaveable(moduleId) { mutableStateOf<String?>(null) }

    val navigator = remember(moduleId) {
        object : ModuleNavigator {
            override fun to(route: String) { subRoute = route }
            override fun back() {
                // 有子页则退回板块首页，否则退出板块 —— 符合返回键直觉
                if (subRoute != null) subRoute = null else onBack()
            }
            override fun switchModule(moduleId: String) = onSwitchModule(moduleId)
        }
    }

    Column(Modifier.fillMaxSize()) {
        // 统一标题栏：图标 + 名称来自模块自身 meta，框架不关心具体是谁
        TextButton(onClick = onBack) { Text("← 返回") }
        if (module != null) {
            Text(
                text = "${module.meta.icon}  ${module.meta.label}",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
            )
        }

        when {
            module == null -> {
                // 理论上不会发生（入口由注册表生成），这里是防御性分支
                EmptyState("该功能不可用")
            }

            !identity.isBound -> {
                EmptyState("请先连接电脑")
            }

            else -> {
                // 把当前子路由通过 CompositionLocal 提供给板块，
                // 板块据此决定渲染首页还是子页（见 ModuleContract 的 ModuleSubRoute）。
                ProvideModuleSubRoute(subRoute) {
                    module.Screen(navigator)
                }
            }
        }
    }
}
