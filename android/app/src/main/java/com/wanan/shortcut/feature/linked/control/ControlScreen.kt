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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
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
 * 入口页：填电脑地址 + 配对码直连（**不依赖云端**）。
 *
 * ## 为什么把"填地址"放在第一位
 *
 * 契约 §8.2 的"一键直连"要**经云端 WS 问 `/api/lan-entry`**，
 * 那要求云端通道可用。当前阶段**云端暂不做**，所以主力路径必须是
 * 那条完全独立于云端的：直接填电脑地址 → 读 `/api/status` → 用配对码换 token。
 *
 * 云端入口保留在下方，等功能可用时再启用。
 */
@Composable
private fun ControlEntryScreen(
    viewModel: ControlViewModel,
    onOpenPanel: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val conn by viewModel.connection.collectAsStateWithLifecycle()

    var host by remember { mutableStateOf("") }
    var pairCode by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { viewModel.refreshAvailability() }

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

        // ---- 主力入口：局域网直连（不依赖云端）----
        SectionHeader(title = "局域网直连")

        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Text(
                    text = "在电脑上打开 ShortCut「控制」板块，点开「局域网直连」，" +
                        "状态页会显示**地址**和**6 位配对码**，照着填进来即可。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                OutlinedTextField(
                    value = host,
                    onValueChange = { host = it.trim(); viewModel.clearConnectionError() },
                    label = { Text("电脑地址") },
                    placeholder = { Text("192.168.1.5:9823") },
                    supportingText = { Text("可只填 IP，端口默认 9823") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedTextField(
                    value = pairCode,
                    onValueChange = { input ->
                        pairCode = input.filter { it.isLetterOrDigit() }.take(6).uppercase()
                        viewModel.clearConnectionError()
                    },
                    label = { Text("6 位配对码") },
                    placeholder = { Text("电脑端状态页显示") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                Button(
                    onClick = { viewModel.connectLanDirect(host, pairCode) },
                    enabled = host.isNotBlank() && !conn.lanBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            conn.lanBusy -> "正在连接…"
                            conn.lanActive -> "重新连接"
                            else -> "连接"
                        },
                    )
                }

                if (conn.lanActive) {
                    Button(
                        onClick = onOpenPanel,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                        ),
                    ) { Text("进入控制面板") }
                }
            }
        }

        // 连不上时的可诊断提示（换行多，单独显示）
        conn.lanError?.let { err ->
            ScCard(
                containerColor = MaterialTheme.colorScheme.errorContainer,
                contentPadding = Spacing.md,
            ) {
                Text(
                    text = err,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
        }

        conn.lanNotice?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = Spacing.xs),
            )
        }

        // ---- 次要入口：云端（当前阶段暂不作为主力）----
        SectionHeader(title = "其他方式")

        ScListCard(
            icon = "☁️",
            title = "云端连接",
            subtitle = if (state.ready && state.channelLabel == "云端") {
                "已连接，点进入控制"
            } else {
                "经云端中继配对（需要电脑端开启「云端连接」）"
            },
            trailing = "›",
            onClick = {
                viewModel.connectCloud()
                onOpenPanel()
            },
        )

        ScListCard(
            icon = "📶",
            title = "一键直连（经云端问地址）",
            subtitle = "自动获取电脑地址，但需要云端通道可用",
            trailing = "›",
            onClick = { if (conn.lanActive) onOpenPanel() else viewModel.connectLan() },
        )
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

    // 进入控制页时同步一次可用性（通道可能在入口页刚建立）
    LaunchedEffect(Unit) { viewModel.refreshAvailability() }

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
