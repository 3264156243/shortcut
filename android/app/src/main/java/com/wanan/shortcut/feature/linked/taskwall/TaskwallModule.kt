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
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ModuleSpec
import com.wanan.shortcut.framework.ShortcutModule
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 任务墙板块（queue 能力，契约 §5）—— **手机端的角色是「下发任务」**。
 *
 * ## 与 web 参考实现对齐
 *
 * web `/taskwall/` 是一个**「新增任务」表单页**（只有 `push`），
 * 本板块与它能力集一致。此前我做成"任务列表 + 勾选完成"是错的，
 * 详见 [TaskwallRepository.ack] 的说明。
 *
 * ## 框架代劳的部分（本文件因此很薄）
 *
 * | 通常每个板块都要写的 | 谁做了 |
 * |---|---|
 * | 请求带 `bindId` / `mobileToken` | `core/net/ApiClient` 自动注入 |
 * | 收到"移动端绑定已失效"跳绑定页 | `core/identity/IdentityProvider` |
 * | 区分 HTTP 200 与 `success:false` | `core/result/ApiResult` |
 * | 服务端文案 → 提示语 | `core/error/ErrorMapper` |
 * | 首页入口图标 / 标题 / 版本门禁 | `framework/ModuleRegistry` |
 * | 未绑定的拦截与"去连接"引导 | `ModuleHostScreen` |
 */
class TaskwallModule : ShortcutModule {

    override val spec: ModuleSpec = ModuleSpec(
        id = "taskwall",
        // 本地兜底元数据：运行时优先用服务端 module.list 下发的值
        label = "任务墙",
        icon = "🗂️",
        desc = "把任务从手机钉到桌面任务墙",
        domain = ModuleDomain.LINKED,        // 联动板块：需要绑定 + 服务端对账
        capability = Capability.QUEUE,
        order = 100,
        // ⚠️ 不要填 minAppVersion（那是桌面端版本号，会把安卓端永久锁死）。
        // 详见 ModuleSpec.minAndroidVersion 的说明。
    )

    @Composable
    override fun Screen(navigator: ModuleNavigator) {
        // 顶部栏标题由框架渲染；表单是唯一页面，没有子路由
        var snackbar by remember { mutableStateOf<String?>(null) }
        val viewModel = containerViewModel { it.taskwallViewModel() }

        Box(Modifier.fillMaxSize()) {
            TaskwallScreen(
                viewModel = viewModel,
                onToast = { msg -> snackbar = msg },
            )

            snackbar?.let { msg ->
                LaunchedEffect(msg) {
                    kotlinx.coroutines.delay(2800)
                    snackbar = null
                }
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(Spacing.lg),
                ) { Text(msg) }
            }
        }
    }

    /**
     * 实时唤醒（可选实现）。
     *
     * 契约 §7.3：`sync-wake` **只发给桌面端**，手机端收不到。
     */
    override fun onRealtimeMessage(message: RelayMessage) {
        // 手机侧收不到 sync-wake；这里无需处理。
    }
}
