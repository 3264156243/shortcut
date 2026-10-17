package com.wanan.shortcut.feature.linked.control

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 输入区（对齐 web `#inputCard`）。
 *
 * ## 与 web 一致的关键行为
 *
 * 1. **差量同步**：输入内容不是整段重发，而是只发变化部分
 *    （算法在 [TextDiffSync]，已单测覆盖）。
 * 2. **中文输入法保护**：选字过程中**不同步**，否则会把拼音字母打到电脑上。
 *    web 用 `compositionstart/end`；安卓端用 `TextFieldValue.composition`
 *    —— 见下方说明，这是**精确**判据。
 * 3. **退格/回车/Tab/清空** 四个按钮，且「清空」**只清本页缓冲、不影响电脑**。
 */
@Composable
fun InputPadSection(viewModel: ControlViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // ★ 用 TextFieldValue 而不是 String：只有它暴露 `composition`，
    //   这正是 web 的 compositionstart/end 在 Compose 里的等价物。
    var field by remember { mutableStateOf(TextFieldValue("")) }

    // 输入区焦点：用于"点控件时不收起输入法"（对齐 web 的 keepKeyboardOpen）
    val focusRequester = remember { FocusRequester() }
    val softwareKeyboard = LocalSoftwareKeyboardController.current

    // 焦点当前是否在输入区（用于判断要不要保持键盘）。
    // ⚠️ 必须声明在 keepKeyboardIfWasFocused 之前：
    // Kotlin 局部函数不能引用在其之后声明的局部变量。
    val inputFocused = remember { mutableStateOf(false) }

    /**
     * 点控件后把焦点还给输入区，从而**保持输入法不收起**。
     *
     * 对齐 web `keepKeyboardOpen` 的克制逻辑（`phone.js:252`）：
     * **只有焦点本来就在输入区时**才还焦点 —— 不主动拉起键盘。
     * 否则用户只想点个方向键，却会被强制弹出输入法，很烦。
     */
    fun keepKeyboardIfWasFocused() {
        if (!inputFocused.value) return
        runCatching {
            focusRequester.requestFocus()
            softwareKeyboard?.show()
        }
    }

    // 已同步文本用 ViewModel 里的**响应式**镜像，而不是直接读 diffSync.sentSnapshot()
    // —— 后者不是 Compose 状态，改了不会重组，界面上的数字可能一直是旧值。
    val sentText by viewModel.sentText.collectAsStateWithLifecycle()

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        // 顶部状态：本地/已同步字数（对齐 web 的 `.meter`）
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "本地 ${field.text.length} · 已同步 ${sentText.length}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = syncStateText(field.text, sentText),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }

        OutlinedTextField(
            value = field,
            onValueChange = { new ->
                field = new

                // ★ 输入法组合状态的**精确**判据（等价于 web 的 composition 事件）：
                //   composition 为 null            → 没有组合
                //   composition 非 null 且非 collapsed → 输入法正在组合（如拼音选字中）
                //
                // 早先版本用"短时间内连续单个拉丁字母"的启发式猜测 ——
                // 中文用户打字快时几乎全程被误判为组合中，结果**完全没同步**
                // （用户反馈"输入里安卓端输入并没有同步"）。现已改为精确判断。
                val composing = new.composition?.let { !it.collapsed } ?: false

                viewModel.onBufferChanged(new.text, isComposing = composing)
            },
            label = { Text("输入区") },
            placeholder = { Text("在这里打字…") },
            minLines = 4,
            keyboardOptions = KeyboardOptions(
                // 关掉自动大小写/纠错，避免把输入法的自动改动当成用户输入发过去
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Default,
            ),
            modifier = Modifier
                .fillMaxWidth()
                // 重新进入本页时自动聚焦，便于直接开打（web 是 title.focus()）
                .focusRequester(focusRequester)
                .onFocusChanged { inputFocused.value = it.isFocused },
        )

        // 退格 / 回车 / Tab / 清空（对齐 web 的 `row-4`）
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            ControlKeyButton("⌫ 退格", Modifier.weight(1f)) {
                viewModel.backspace(); keepKeyboardIfWasFocused()
            }
            ControlKeyButton("⏎ 回车", Modifier.weight(1f)) {
                viewModel.pressEnter(); keepKeyboardIfWasFocused()
            }
            ControlKeyButton("⇥ Tab", Modifier.weight(1f)) {
                viewModel.pressTab(); keepKeyboardIfWasFocused()
            }
            ControlKeyButton("清空", Modifier.weight(1f)) {
                viewModel.clearBuffer()
                field = TextFieldValue("")
                keepKeyboardIfWasFocused()
            }
        }

        // 方向键（对齐 web 的 `.arrows` 四宫格）
        Text(
            text = "方向",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                ControlKeyButton("↑", Modifier.size(64.dp)) {
                    viewModel.sendArrow("up"); keepKeyboardIfWasFocused()
                }
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
            ) {
                ControlKeyButton("←", Modifier.size(64.dp)) {
                    viewModel.sendArrow("left"); keepKeyboardIfWasFocused()
                }
                ControlKeyButton("↓", Modifier.size(64.dp)) {
                    viewModel.sendArrow("down"); keepKeyboardIfWasFocused()
                }
                ControlKeyButton("→", Modifier.size(64.dp)) {
                    viewModel.sendArrow("right"); keepKeyboardIfWasFocused()
                }
            }
        }

        // 快捷键 chips（对齐 web 的 TYPE_SHORTCUTS）
        Text(
            text = "快捷键",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            items(TYPE_SHORTCUTS) { sc ->
                ControlChip(sc.label) {
                    viewModel.sendCombo(sc.keys); keepKeyboardIfWasFocused()
                }
            }
        }

        if (!state.ready) {
            Text(
                text = "未连接电脑，指令不会送达。请先在上一页选择连接方式。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/**
 * 同步状态文案（对齐 web `updateMeter()` 的四种状态）。
 *
 * 把它抽成纯函数便于单测 —— 文案分支多了很容易漏。
 */
internal fun syncStateText(buffer: String, sent: String): String = when {
    buffer == sent -> "已同步"
    buffer.startsWith(sent) -> "待同步"
    sent.startsWith(buffer) -> "将退格差量"
    else -> "差量同步"
}

/*
 * 已删除：`looksLikeComposing()` 启发式 + `COMPOSING_GAP_MS`。
 *
 * 它原本用"短时间内连续单个拉丁字母"**猜**输入法是否在组合。
 * 这是错的方向 —— 中文用户打字快时几乎全程被误判为组合中，
 * 结果**完全没同步**（用户反馈"输入里安卓端输入并没有同步"）。
 *
 * 正确做法是用 `TextFieldValue.composition`：它不是 collapsed 就说明在组合中，
 * 与 web 的 `compositionstart/end` 等价且**精确**。见 `InputPadSection` 里的用法。
 */

/** 快捷键定义（逐条对齐 web `TYPE_SHORTCUTS`） */
internal data class Shortcut(val label: String, val keys: List<String>)

internal val TYPE_SHORTCUTS = listOf(
    Shortcut("复制", listOf("ctrl", "c")),
    Shortcut("粘贴", listOf("ctrl", "v")),
    Shortcut("全选", listOf("ctrl", "a")),
    Shortcut("粘贴板", listOf("win", "v")),
    Shortcut("撤回", listOf("ctrl", "z")),
    Shortcut("任务视图", listOf("win", "tab")),
)

/** 更多快捷键（对齐 web `PAD_MORE_SHORTCUTS`，用于触控板抽屉的"更多"） */
internal val PAD_MORE_SHORTCUTS = listOf(
    Shortcut("剪切", listOf("ctrl", "x")),
    Shortcut("重做", listOf("ctrl", "y")),
    Shortcut("保存", listOf("ctrl", "s")),
    Shortcut("查找", listOf("ctrl", "f")),
    Shortcut("关闭", listOf("alt", "f4")),
    Shortcut("切换", listOf("alt", "tab")),
    Shortcut("桌面", listOf("win", "d")),
    Shortcut("任务管理", listOf("ctrl", "shift", "esc")),
    Shortcut("运行", listOf("win", "r")),
    Shortcut("截图", listOf("printscreen")),
    Shortcut("锁屏", listOf("win", "l")),
    Shortcut("刷新", listOf("f5")),
)

/**
 * 控制面板上的一个按钮。
 *
 * 统一"最小 48dp 触摸目标 + 一致观感"，避免每处各写一遍样式。
 *
 * ⚠️ 用 `defaultMinSize` 而不是 `size`：调用方常传 `Modifier.weight(1f)` 让它均分宽度，
 * 若这里写死 `size(48.dp)` 会把 weight 的结果覆盖掉（按钮又变回 48dp 宽）。
 * `defaultMinSize` 只保证**下限**，不干扰外部给的尺寸。
 */
@Composable
internal fun ControlKeyButton(
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
            .clip(MaterialTheme.shapes.small)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(onClick = onClick)
            .padding(horizontal = Spacing.xs, vertical = Spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
        )
    }
}

/** 胶囊按钮（快捷键 chips，对齐 web `.chip`） */
@Composable
internal fun ControlChip(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(MaterialTheme.shapes.small)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(onClick = onClick)
            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
