package com.wanan.shortcut.feature.linked.taskwall

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.wanan.shortcut.core.realtime.RelayMessage
import com.wanan.shortcut.framework.Capability
import com.wanan.shortcut.framework.LocalModuleSubRoute
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ModuleSpec
import com.wanan.shortcut.framework.ShortcutModule

/**
 * 任务墙板块（queue 能力，契约 §5）。
 *
 * ## 这个文件是框架的第一次真实验证
 *
 * 它**只实现 [ShortcutModule] 需要的东西**，没有做以下任何一件事——
 * 这些都由框架完成，所以本文件里看不到：
 *
 * | 通常每个板块都要写的 | 谁做了 |
 * |---|---|
 * | 请求带 `bindId` / `mobileToken` | `core/net/ApiClient` 自动注入 |
 * | 收到"移动端绑定已失效"跳绑定页 | `core/identity/IdentityProvider` 统一广播 |
 * | 区分 HTTP 200 与 `success:false` | `core/result/ApiResult` |
 * | 服务端文案 → 提示语 | `core/error/ErrorMapper` |
 * | 首页入口卡片 / 图标 / 标题 | `framework/ModuleRegistry` + `module.list` |
 * | 版本门禁 | `framework/VersionGate` |
 * | 未绑定的拦截 | `ModuleHostScreen` |
 * | 子页返回栈 | `ModuleHostScreen` + `LocalModuleSubRoute` |
 *
 * ## 自证结果（2026-10-13）
 *
 * 加入本板块只改了 `Modules.kt` **一行**，未触碰首页、导航、Manifest、设置页。
 */
class TaskwallModule : ShortcutModule {

    override val spec: ModuleSpec = ModuleSpec(
        id = "taskwall",
        // 本地兜底元数据：运行时优先用服务端 module.list 下发的值
        // （线上实测返回 label=任务墙、icon=🗂️、desc=把任务从手机钉到桌面任务墙）
        label = "任务墙",
        icon = "🗂️",
        desc = "把任务从手机钉到桌面任务墙",
        domain = ModuleDomain.LINKED,        // ★ 联动板块：需要绑定 + 服务端对账
        capability = Capability.QUEUE,       // ★ 用共享的队列能力
        // 与服务端线上值一致（契约 §4.1 实测 minAppVersion=2.4.5）
        minAppVersion = "2.4.5",
        order = 100,
    )

    @Composable
    override fun Screen(navigator: ModuleNavigator) {
        // 子路由由框架维护（来自导航图），板块只读
        val subRoute = LocalModuleSubRoute.current
        val viewModel = com.wanan.shortcut.ui.containerViewModel { it.taskwallViewModel() }

        var snackbar by remember { mutableStateOf<String?>(null) }

        Box(Modifier.fillMaxSize()) {
            when (subRoute) {
                null -> TaskwallScreen(
                    onCompose = { navigator.to(ROUTE_COMPOSE) },
                    viewModel = viewModel,
                )

                ROUTE_COMPOSE -> TaskComposeScreen(
                    onBack = { navigator.back() },
                    onSubmit = { text, longText, details, reminderAt, boardName ->
                        viewModel.push(text, longText, details, reminderAt, boardName) { outcome ->
                            snackbar = when (outcome) {
                                // 契约 §5.1：已排队不是失败，文案必须区分，否则用户以为发丢了
                                PushOutcome.Delivered -> "已送达电脑"
                                PushOutcome.Queued -> "电脑当前离线，任务已排队，等它上线就会收到"
                                is PushOutcome.Failed -> outcome.message
                            }
                            if (outcome !is PushOutcome.Failed) navigator.back()
                        }
                    },
                )
            }

            snackbar?.let { msg ->
                LaunchedEffect(msg) {
                    kotlinx.coroutines.delay(2600)
                    snackbar = null
                }
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(com.wanan.shortcut.ui.theme.Spacing.lg),
                ) { Text(msg) }
            }
        }
    }

    /** 子页标题：让顶部栏显示"新建任务"而不是板块名 */
    override fun subRouteTitle(subRoute: String): String? = when (subRoute) {
        ROUTE_COMPOSE -> "新建任务"
        else -> null
    }

    /**
     * 实时唤醒（可选实现）。
     *
     * 契约 §7.3：`sync-wake` **只发给桌面端**，手机端收不到，
     * 所以这里刻意不处理它——手机要拿新任务只能 `pull`。
     * 保留该覆写是为了留下"板块关心什么消息"的位置，并说明为什么不处理。
     */
    override fun onRealtimeMessage(message: RelayMessage) {
        // 手机侧不会收到 sync-wake；桌面上下线也没必要立刻刷新列表
        // （refresh 会真发请求，频繁触发只会浪费限流额度）。
    }

    private companion object {
        const val ROUTE_COMPOSE = "compose"
    }
}
