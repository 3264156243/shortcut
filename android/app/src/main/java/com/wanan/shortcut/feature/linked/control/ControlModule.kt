package com.wanan.shortcut.feature.linked.control

import androidx.compose.runtime.Composable
import com.wanan.shortcut.core.realtime.RelayMessage
import com.wanan.shortcut.framework.Capability
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ModuleSpec
import com.wanan.shortcut.framework.ShortcutModule

/**
 * 电脑控制板块（realtime 能力，契约 §7 / §8）。
 *
 * ## 与 web 参考实现的能力对照
 *
 * | web 能力 | 本板块 |
 * |---|---|
 * | 双入口：局域网直连（推荐）/ 云端连接 | ✅ |
 * | 备用：手动填地址 | ✅ |
 * | 输入区 + **差量同步** | ✅（算法见 [TextDiffSync]） |
 * | 方向键 / 快捷键 chips | ✅ |
 * | 触控板（单指移动、单击、长按右键、滚轮、灵敏度） | ✅ |
 * | 虚拟键盘（粘滞修饰键 + 组合发送） | ✅ |
 * | 电脑粘贴板（读取/输出到光标/复制/清历史） | ✅ |
 *
 * ## 关于实时通道（重要）
 *
 * 本板块**不自己建 WebSocket** —— 用的是 `core/realtime/RelayClient` 这条
 * **全应用唯一**的连接。原因：契约 §7.6 限制每 `bindId` 最多 3 条连接，
 * 每个实时板块各建一条会直接把用户踢下线。
 */
class ControlModule : ShortcutModule {

    override val spec: ModuleSpec = ModuleSpec(
        id = "control",                      // 与服务端 modules.json 的 id 对齐
        label = "电脑控制",
        icon = "🖥️",
        desc = "手机向电脑打字、控制鼠标、粘贴板",
        domain = ModuleDomain.LINKED,
        capability = Capability.REALTIME,
        order = 120,
    )

    @Composable
    override fun Screen(navigator: ModuleNavigator) {
        ControlScreen(navigator)
    }

    /** 子页标题：让顶部栏显示"输入/触控板…"而不是板块名 */
    override fun subRouteTitle(subRoute: String): String? = when (subRoute) {
        "panel" -> "控制面板"
        else -> null
    }

    override fun onRealtimeMessage(message: RelayMessage) {
        // 控制板块的指令回执由 RelayClient 按 id 直接投递给调用方，
        // 不需要在这里广播处理。
        //
        // 特别说明 `auth-ok.desktopOnline`（契约 §7.3：**只有手机收得到**）：
        // 它由 RelayClient 写入自身状态，控制面板通过 state 观察，无需在此重复处理。
    }
}
