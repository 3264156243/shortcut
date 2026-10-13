package com.wanan.shortcut.feature.local.notes

import com.wanan.shortcut.framework.Capability
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ModuleSpec
import com.wanan.shortcut.framework.ShortcutModule
import androidx.compose.runtime.Composable

/**
 * 笔记板块 —— **本机板块（LOCAL）的样例**。
 *
 * 与任务墙（LINKED）形成对照，用来证明框架两条路都通：
 *
 * | | 笔记（本文件） | 任务墙 |
 * |---|---|---|
 * | 归属域 | `LOCAL` | `LINKED` |
 * | 需要绑定 | ❌ | ✅ |
 * | 参与 `module.list` 对账 | ❌ | ✅ |
 * | 未绑定时 | 正常可用 | 置灰，点击提示去绑定 |
 * | 服务端能远程下架它吗 | **不能** | 能 |
 * | 断网时 | 完全正常 | 只能操作已有数据 |
 *
 * 加入它同样**只改 `Modules.kt` 一行**（外加 AppContainer 一行 ViewModel 构造）。
 */
class NotesModule : ShortcutModule {

    override val spec: ModuleSpec = ModuleSpec(
        id = "notes",
        label = "笔记",
        icon = "📝",
        desc = "随手记，存在本机，不联网",
        domain = ModuleDomain.LOCAL,     // ★ 本机板块：不参与服务端对账
        capability = Capability.NONE,    // ★ 不用任何网络能力
        order = 10,                      // 排在联动板块前面
    )

    @Composable
    override fun Screen(navigator: ModuleNavigator) {
        NotesScreen(navigator)
    }
}
