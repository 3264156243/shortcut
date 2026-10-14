package com.wanan.shortcut.feature.linked.control

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.framework.LocalModuleSubRoute
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.ui.components.InlineError
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.components.ScListCard
import com.wanan.shortcut.ui.components.SectionHeader
import com.wanan.shortcut.ui.components.StatusLine
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 电脑控制板块的界面（对齐 web：`/control/` 入口页 + `/control/app/` 控制页）。
 *
 * ## 与 web 对照的两层结构
 *
 * web 把控制分成两页：
 *   1. **`/control/`** —— 入口页：两个入口（**局域网直连**（推荐，更快）/ **云端连接**）
 *      + 「备用：手动填地址」折叠区；
 *   2. **`/control/app/`** —— 控制页：输入区 / 触控板 / 键盘 / 粘贴板。
 *
 * 安卓端用**子路由**表达这个层次（`LocalModuleSubRoute`）：
 *   子路由 `null` → 入口页；`"panel"` → 控制页。
 *
 * ## 为什么保留"两条通道"而不是只做云端
 *
 * 契约 §8.1：局域网延迟 5–15ms，云端 30–80ms。
 * 对"控制鼠标"这种交互，延迟差异**能直接感觉到**，
 * 所以 web 把局域网做成推荐项，安卓端保持同等能力。
 */
@Composable
fun ControlScreen(navigator: ModuleNavigator) {
    val subRoute = LocalModuleSubRoute.current

    // 入口页与控制页共用同一个 ViewModel，避免来回切换时重建通道
    val viewModel = containerViewModel { it.controlViewModel() }

    when (subRoute) {
        null -> ControlEntryScreen(
            viewModel = viewModel,
            onOpenPanel = { navigator.to(ROUTE_PANEL) },
        )

        ROUTE_PANEL -> ControlPanelScreen(viewModel = viewModel)

        else -> ControlEntryScreen(
            viewModel = viewModel,
            onOpenPanel = { navigator.to(ROUTE_PANEL) },
        )
    }
}

/**
 * 入口页：选择通道（对齐 web `/control/` 的双入口 + 手动填地址）。
 */
@Composable
private fun ControlEntryScreen(
    viewModel: ControlViewModel,
    onOpenPanel: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val conn by viewModel.connection.collectAsStateWithLifecycle()

    var manualHost by remember { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        // 顶部状态（对齐 web 的 `#dot` + `#statusText`）
        ScCard(contentPadding = Spacing.md) {
            StatusLine(
                online = state.ready,
                text = when {
                    state.ready -> "已连接电脑（${state.channelLabel}）"
                    conn.connecting -> "正在连接云端…"
                    conn.lastError != null -> conn.lastError!!
                    else -> "未连接"
                },
            )
        }

        // ---- 入口 1：局域网直连（推荐）----
        SectionHeader(title = "更快")
        ScListCard(
            icon = "📶",
            title = "局域网直连",
            subtitle = when {
                conn.lanActive -> "已直连 ${conn.lanBaseUrl}，点进入控制"
                conn.lanBusy -> "正在问电脑端要局域网入口…"
                else -> "手机与电脑连同一 Wi-Fi 时点一下直连，不用输地址、不用输绑定码"
            },
            trailing = "›",
            onClick = { if (conn.lanActive) onOpenPanel() else viewModel.connectLan() },
        )

        if (!conn.lanActive) {
            Text(
                text = "原理：电脑端 ShortCut「控制」板块点一下「局域网直连」后，" +
                    "这里点一下就自动拿到它的局域网地址并连上。要求两边在同一网络。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Spacing.xs),
            )
        }

        // ---- 入口 2：云端连接 ----
        SectionHeader(title = "任何网络可用")
        ScListCard(
            icon = "☁️",
            title = "云端连接",
            subtitle = if (state.ready && state.channelLabel == "云端") {
                "已连接，点进入控制"
            } else {
                "经云端中继自动配对（4G / 别处 Wi-Fi 均可）"
            },
            trailing = "›",
            onClick = {
                viewModel.connectCloud()
                onOpenPanel()
            },
        )
        Text(
            text = "前提：电脑端 ShortCut「控制」板块已启动「云端连接」。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = Spacing.xs),
        )

        // ---- 备用：手动填地址（对齐 web 的「🔧 备用：手动填地址」）----
        SectionHeader(title = "备用")
        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(
                    text = "手动填电脑的局域网地址（形如 192.168.1.5:9823）。" +
                        "电脑端「局域网直连」状态卡会显示这个地址。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = manualHost,
                    onValueChange = { manualHost = it.trim() },
                    label = { Text("地址") },
                    placeholder = { Text("192.168.1.5:9823") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { viewModel.connectLanManual(manualHost) },
                    enabled = manualHost.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("打开控制页") }
            }
        }

        conn.lanError?.let { InlineError(message = it) }
        conn.lanNotice?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

/**
 * 控制页：四个分区（对齐 web 的输入主页 + 触控板/键盘/粘贴板三个抽屉）。
 *
 * web 用"底部上滑抽屉"，安卓端用**分段切换** —— 上滑抽屉在手机上要两步操作，
 * 分段切换一步到位，且不会遮住输入区。
 */
@Composable
private fun ControlPanelScreen(viewModel: ControlViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var section by remember { mutableStateOf(PanelSection.INPUT) }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            PanelSection.entries.forEach { s ->
                val selected = section == s
                Box(
                    Modifier
                        .weight(1f)
                        .clip(MaterialTheme.shapes.small)
                        .background(
                            if (selected) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surfaceContainerHigh,
                        )
                        .clickable { section = s }
                        .padding(vertical = Spacing.sm),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = s.label,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (selected) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
        }

        Text(
            text = "通道：${state.channelLabel.ifBlank { "未连接" }}　·　已发 ${state.sentCount} 条指令",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = Spacing.lg),
        )

        Box(Modifier.weight(1f)) {
            when (section) {
                PanelSection.INPUT -> InputPadSection(viewModel)
                PanelSection.PAD -> TouchPadSection(viewModel)
                PanelSection.KEYBOARD -> VirtualKeyboardSection(viewModel)
                PanelSection.CLIPBOARD -> ClipboardSection(viewModel)
            }
        }

        state.notice?.let { n ->
            LaunchedEffect(n) {
                kotlinx.coroutines.delay(2600)
                viewModel.consumeNotice()
            }
            Text(
                text = n,
                style = MaterialTheme.typography.labelSmall,
                color = if (state.noticeIsError) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.primary
                },
                modifier = Modifier.padding(horizontal = Spacing.lg, vertical = Spacing.sm),
            )
        }
    }
}

/** 控制页的四个分区（对应 web 的输入主页 + 三个上滑抽屉） */
enum class PanelSection(val label: String) {
    INPUT("输入"),
    PAD("触控板"),
    KEYBOARD("键盘"),
    CLIPBOARD("粘贴板"),
}

private const val ROUTE_PANEL = "panel"
