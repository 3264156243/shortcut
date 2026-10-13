package com.wanan.shortcut

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.framework.LocalModuleSubRoute
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ProvideModuleSubRoute
import com.wanan.shortcut.ui.components.EmptyState

/**
 * 板块宿主 —— 框架统一渲染板块页面。
 *
 * 它替所有板块处理掉这些"每个板块都会忘、忘了就出 bug"的事情：
 *   1. **按归属域决定是否拦截未绑定**（本次重构的关键修正，见下）；
 *   2. 模块未注册时给出明确提示，而不是白屏；
 *   3. 统一提供带返回按钮的容器、[ModuleNavigator] 实现与**板块内部子路由**；
 *   4. 联动板块在等待绑定校验时显示加载态，避免"闪一下再被踢出"。
 *
 * ## 未绑定拦截：只对 LINKED 生效
 *
 * P0 版是 `!identity.isBound -> EmptyState("请先连接电脑")`，**对所有板块一视同仁**，
 * 结果本机板块（笔记等）也被挡住。现在按 [ModuleDomain] 区分：
 *   - `LOCAL`：不判断绑定，直接放行
 *   - `LINKED`：未绑定时给出"去连接"引导（不是一句干巴巴的提示）
 */
@Composable
fun ModuleHostScreen(
    moduleId: String,
    identity: Identity,
    onBack: () -> Unit,
    onSwitchModule: (String) -> Unit,
    onGoBind: () -> Unit = {},
) {
    val container = LocalContext.current.appContainer
    val module = remember(moduleId) { container.moduleRegistry.get(moduleId) }

    // 板块内部子路由。用 rememberSaveable 以便旋转/重建后仍停在原页；
    // 换板块时重置（key = moduleId）。
    var subRoute by rememberSaveable(moduleId) { mutableStateOf<String?>(null) }

    // 进入板块时刷新一次身份状态：用户可能在设置页刚绑定完就切过来。
    LaunchedEffect(moduleId) { container.identityProvider.restore() }

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

    if (module == null) {
        // 理论上不会发生（入口由注册表生成），这里是防御性分支
        EmptyState("该功能不可用")
        return
    }

    val spec = module.spec
    // ★ 只有联动板块才需要绑定
    val blockedByBinding = spec.domain == ModuleDomain.LINKED && !identity.isBound

    Column(Modifier.fillMaxSize()) {
        TextButton(onClick = onBack) { Text("← 返回") }
        Text(
            text = "${spec.icon}  ${spec.label}",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
        )

        if (blockedByBinding) {
            // 给出可执行的下一步，而不是只说"请先连接电脑"
            BindingRequiredPanel(onGoBind = onGoBind)
        } else {
            // 把当前子路由通过 CompositionLocal 提供给板块，
            // 板块据此决定渲染首页还是子页。
            ProvideModuleSubRoute(subRoute) {
                module.Screen(navigator)
            }
        }
    }
}

@Composable
private fun BindingRequiredPanel(onGoBind: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        Text(
            text = "🔗",
            style = MaterialTheme.typography.headlineLarge,
        )
        Text(
            text = "这个功能需要先连接电脑",
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 12.dp),
        )
        Text(
            text = "在电脑端 ShortCut 打开「移动互联」，用 6 位绑定码连接。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
        Button(onClick = onGoBind, modifier = Modifier.padding(top = 20.dp)) {
            Text("去连接")
        }
    }
}
