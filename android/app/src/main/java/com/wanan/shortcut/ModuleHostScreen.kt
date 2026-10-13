package com.wanan.shortcut

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.ui.components.EmptyState

/**
 * 板块宿主 —— 框架统一渲染板块页面。
 *
 * 它替所有板块处理掉这些"每个板块都会忘、忘了就出 bug"的事情：
 *   1. 身份未绑定时不放行（直接提示去绑定，而不是让板块发一个必然失败的请求）；
 *   2. 模块未注册 / 服务端未声明时给出明确提示，而不是白屏；
 *   3. 统一提供带返回按钮的容器与 [ModuleNavigator] 实现。
 *
 * 因此板块的 [com.wanan.shortcut.framework.ShortcutModule.Screen] 里
 * **不需要**写任何"如果没绑定就…"的判断。
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

    val navigator = remember(moduleId) {
        object : ModuleNavigator {
            // P0：子路由暂用内部状态表达，P1 引入 navigation-compose 的嵌套图时只改这里，
            // 板块代码（调用 navigator.to(...)）不受影响。
            override fun to(route: String) { /* 见 P1 备注 */ }
            override fun back() = onBack()
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
                module.Screen(navigator)
            }
        }
    }
}
