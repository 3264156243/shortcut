package com.wanan.shortcut.feature.demo

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.core.realtime.RelayMessage
import com.wanan.shortcut.framework.ModuleMeta
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ShortcutModule

/**
 * 框架自证用假板块（`_demo` 前缀表示它不是产品功能）。
 *
 * ## 它存在的唯一目的
 *
 * 证明"**加一个板块只改一个文件**"这个框架承诺是真的：
 * 1. 本文件实现 [ShortcutModule]；
 * 2. `Modules.all()` 加一行 [DemoModule]；
 * 3. 完。首页自动多一张卡片、点进去是这个页面、设置页无需改动。
 *
 * **没有**改导航图、没有改首页、没有在 `AndroidManifest` 加 Activity、
 * 没有写任何权限/身份/错误处理代码——那些都在框架层。
 *
 * ## 注意
 *
 * 本模块 id 用 `_demo`（下划线开头）是刻意的：服务端 `modules.json` 里**没有**这个 id，
 * 因此按 [com.wanan.shortcut.framework.ModuleRegistry.resolve] 的规则，
 * 它在真实运行时**不会显示**（服务端没声明的模块不显示）。
 *
 * 这恰好同时验证了另一条规则：客户端不会显示服务端没下发的板块。
 * 想在真机上看到这张卡片，把 id 临时改成 `taskwall` 等已声明 id 即可。
 */
class DemoModule : ShortcutModule {

    override val id: String = "_demo"

    override val meta: ModuleMeta = ModuleMeta(
        id = id,
        label = "框架自检",
        icon = "🧪",
        desc = "证明加板块只需注册一行",
    )

    @Composable
    override fun Screen(navigator: ModuleNavigator) {
        Column(Modifier.fillMaxSize().padding(20.dp)) {
            Text("框架自检板块", style = MaterialTheme.typography.headlineSmall)
            Text(
                text = "你看到这个页面，说明 ModuleContract / ModuleRegistry / 导航宿主 " +
                    "已经按预期工作，且没有为它改动任何其它文件。",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 12.dp),
            )
            Text(
                text = "· 身份由框架注入（绑定信息见设置页）\n" +
                    "· 错误/加载/重试由通用组件提供\n" +
                    "· 首页卡片来自服务端 module.list",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp),
            )
        }
    }

    override fun onRealtimeMessage(message: RelayMessage) {
        // 假板块不关心实时消息；这里留空以证明默认实现可用（板块无需实现全部方法）。
    }
}
