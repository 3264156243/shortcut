package com.wanan.shortcut.feature.local.demo

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.core.realtime.RelayMessage
import com.wanan.shortcut.framework.Capability
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ModuleSpec
import com.wanan.shortcut.framework.ShortcutModule

/**
 * 框架自证用假板块（`_demo` 前缀表示它不是产品功能）。
 *
 * ## 它存在的唯一目的
 *
 * 证明"**加一个板块只改一个文件**"这个框架承诺是真的：
 * 1. 本文件实现 [ShortcutModule]；
 * 2. `Modules.all()` 加一行 [DemoModule]；
 * 3. 完。首页自动多一张卡片/图标、点进去是这个页面、设置页无需改动。
 *
 * **没有**改导航图、没有改首页、没有在 `AndroidManifest` 加 Activity、
 * 没有写任何权限/身份/错误处理代码——那些都在框架层。
 *
 * ## 与"笔记"的区别
 *
 * 本模块声明为 [ModuleDomain.LOCAL] 且 id 以 `_demo` 开头。
 * 现在框架**允许** LOCAL 板块不出现在服务端 `modules.json` 里就能显示
 * （这正是本次重构修正的 P0 缺陷），所以本卡片是真机上**可见**的。
 * 若把它改成 `LINKED`，则会因为服务端没有 `_demo` 声明而消失——
 * 这可以顺手验证"联动板块受服务端控制"这条规则。
 */
class DemoModule : ShortcutModule {

    override val spec: ModuleSpec = ModuleSpec(
        id = "_demo",
        label = "框架自检",
        icon = "🧪",
        desc = "证明加板块只需注册一行",
        domain = ModuleDomain.LOCAL,      // 本机板块：不需要绑定、不受服务端控制
        capability = Capability.NONE,
        order = 900,                       // 排在最后，不干扰真实功能
    )

    @Composable
    override fun Screen(navigator: ModuleNavigator) {
        Column(Modifier.fillMaxSize().padding(20.dp)) {
            Text("框架自检板块", style = MaterialTheme.typography.headlineSmall)
            Text(
                text = "你看到这个页面，说明 ModuleSpec / ModuleRegistry / 导航宿主 " +
                    "已经按预期工作，且没有为它改动任何其它文件。",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 12.dp),
            )
            Text(
                text = "· 本机板块：不需要绑定，未连接电脑也能进\n" +
                    "· 身份由框架注入（联动板块才有意义）\n" +
                    "· 错误/加载/重试由通用组件提供\n" +
                    "· 首页图标与分区由注册表自动生成",
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
