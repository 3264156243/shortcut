package com.wanan.shortcut.feature.linked.control

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.feature.bind.scan.ScanBindScreen
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
    // 扫码界面开关
    var scanning by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.refreshAvailability() }

    // ---- 扫码连接（对齐桌面端"扫码即连"）----
    // 为什么单独做一个全屏扫码而不是塞进输入框：
    // 二维码里带的是**预授权令牌**，扫到就能直接连，比"手输地址 + 配对码"省两步，
    // 也是桌面端状态卡主推的方式。
    if (scanning) {
        ScanBindScreen(
            onClose = { scanning = false },
            onRecognized = { raw ->
                scanning = false
                when (val parsed = LanQrPayload.parse(raw)) {
                    is LanQrPayload.Result.Lan -> {
                        if (parsed.token.isBlank()) {
                            // 没带令牌（桌面端 lanEntry 未就绪时会退化成纯地址）
                            // → 回填地址，让用户走配对流程
                            host = parsed.host
                        } else {
                            viewModel.connectLanWithToken(parsed.host, parsed.token)
                        }
                    }
                    is LanQrPayload.Result.CloudControlPage ->
                        viewModel.showScanError("这是云端控制页的二维码，请用「云端连接」；局域网请扫桌面端「局域网直连」状态卡上的码。")
                    is LanQrPayload.Result.Unknown ->
                        viewModel.showScanError(parsed.reason)
                }
            },
        )
        return
    }

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

        // 扫码优先：桌面端状态卡的二维码里带预授权令牌，扫到就能连，不用输地址也不用输配对码
        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Text(
                    text = "最快的方式：用手机扫电脑屏幕上「局域网直连」状态卡的二维码，" +
                        "扫到即连，不用输任何东西。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(
                    onClick = { scanning = true },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("扫码连接") }
            }
        }

        // 备用：手填地址（扫码不方便、或二维码没带令牌时用）
        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Text(
                    text = "或者手填：在电脑上打开 ShortCut「控制」板块，点开「局域网直连」，" +
                        "状态页会显示电脑的**局域网地址**（形如 192.168.1.5:9823）。\n" +
                        "配对码通常**不用填**（会自动从电脑读取）。",
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
                    label = { Text("6 位配对码（可留空）") },
                    placeholder = { Text("留空自动读取") },
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
    val context = LocalContext.current

    // 进入控制页时同步一次可用性（通道可能在入口页刚建立）
    LaunchedEffect(Unit) { viewModel.refreshAvailability() }

    // ★ 已连接时启动前台服务，让 App 退到后台也保持连接。
    // 用户要求："除非断网或者手动断联，否则长期维持连接状态"。
    LaunchedEffect(state.ready) {
        if (state.ready) viewModel.ensureForegroundService(context)
    }

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

        // ★ 连接状态 + 手动断开控件。
        //
        // 用户要求："除非断网或者手动断联，否则长期维持连接状态"——
        // 既然连接会长期保持，就必须给一个**明确、显眼**的断开出口，
        // 否则用户既不知道还连着没有，也没有办法主动结束。
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.lg),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "通道：${state.channelLabel.ifBlank { "未连接" }}" +
                    "　·　已发 ${state.sentCount} 条指令",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            if (state.ready) {
                TextButton(
                    onClick = { viewModel.disconnect(context) },
                    contentPadding = PaddingValues(horizontal = Spacing.sm, vertical = 0.dp),
                ) {
                    Text(
                        text = "断开",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }

        // ★ 指令诊断条：显示最近一条指令的真实结果。
        //
        // 加这个是因为用户连续反馈"打字没同步、任何提示没有" ——
        // 看不到任何信息时，只能靠反复描述现象，排查成本极高。
        // 现在这里会直接写出：发出了什么、结果如何、耗时多少。
        val traces by viewModel.recentCommands.collectAsStateWithLifecycle()
        traces.firstOrNull()?.let { t ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.lg, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Text(
                    text = if (t.ok) "✓" else "✗",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (t.ok) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                )
                Text(
                    text = "${t.path} ${t.result} · ${t.elapsedMs}ms",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (t.ok) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                    modifier = Modifier.weight(1f),
                )
            }
        }

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
