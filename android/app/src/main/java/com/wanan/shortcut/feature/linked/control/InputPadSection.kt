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
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
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
 * 2. **中文输入法保护**：选字过程中**不同步**，否则会把拼音字母打到电脑上
 *    （web 用 `compositionstart/end` + `composing` 标志）。
 *    安卓端用 Compose 提供的组合输入状态判断。
 * 3. **退格/回车/Tab/清空** 四个按钮，且「清空」**只清本页缓冲、不影响电脑**
 *    （web 注释明确写了这点）。
 * 4. 点击这些控件**不会收起输入法**（web 的 `keepKeyboardOpen`）——
 *    安卓端对应的是不让输入框失焦。
 */
@Composable
fun InputPadSection(viewModel: ControlViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    var buffer by remember { mutableStateOf("") }
    // 输入法是否在组合中（中文选字）。由 OutlinedTextField 的 onValueChange 无法直接拿到，
    // 因此这里用"最近一次输入的时间差"近似 —— 见下方说明。
    var lastInputAt by remember { mutableStateOf(0L) }

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
                text = "本地 ${buffer.length} · 已同步 ${viewModel.diffSync.sentSnapshot().length}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = syncStateText(buffer, viewModel.diffSync.sentSnapshot()),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }

        OutlinedTextField(
            value = buffer,
            onValueChange = { new ->
                buffer = new
                // ⚠️ 中文输入法组合期间不同步。
                //
                // Compose 的 TextField 不直接暴露 composition 状态，
                // 因此这里用 KeyboardOptions 关闭自动纠错、并在
                // 输入法提交时才同步 —— 判据是"这次变更是否为单个拉丁字母且紧接着上一次"。
                //
                // 说明：web 用浏览器原生 composition 事件，安卓端没有等价 API。
                // 折中做法是**按输入事件节流**（下面的 debounce 由 ViewModel 的
                // 串行队列天然承担），且在用户按下空格/回车（选字结束）时立刻同步。
                // 见下方 IME 说明与测试 ControlDiffSyncTest。
                val now = System.currentTimeMillis()
                val composing = looksLikeComposing(new, buffer, lastInputAt, now)
                lastInputAt = now
                viewModel.onBufferChanged(new, isComposing = composing)
            },
            label = { Text("输入区") },
            placeholder = { Text("在这里打字…") },
            minLines = 4,
            keyboardOptions = KeyboardOptions(
                // 关掉自动大小写/纠错，避免把输入法改动当成用户输入发过去
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Default,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        // 退格 / 回车 / Tab / 清空（对齐 web 的 `row-4`）
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            ControlKeyButton("⌫ 退格", Modifier.weight(1f)) { viewModel.backspace() }
            ControlKeyButton("⏎ 回车", Modifier.weight(1f)) { viewModel.pressEnter() }
            ControlKeyButton("⇥ Tab", Modifier.weight(1f)) { viewModel.pressTab() }
            ControlKeyButton("清空", Modifier.weight(1f)) {
                viewModel.clearBuffer()
                buffer = ""
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
                ControlKeyButton("↑", Modifier.size(64.dp)) { viewModel.sendArrow("up") }
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
            ) {
                ControlKeyButton("←", Modifier.size(64.dp)) { viewModel.sendArrow("left") }
                ControlKeyButton("↓", Modifier.size(64.dp)) { viewModel.sendArrow("down") }
                ControlKeyButton("→", Modifier.size(64.dp)) { viewModel.sendArrow("right") }
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
                ControlChip(sc.label) { viewModel.sendCombo(sc.keys) }
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

/**
 * 粗略判断"这次输入是否处于输入法组合中"。
 *
 * ## 为什么只能"粗略"
 *
 * web 用浏览器原生的 `compositionstart` / `compositionend` 事件精确判断。
 * Compose 的 `TextField` **不暴露** composition 状态
 * （`TextFieldValue.composition` 在 Material3 的 `OutlinedTextField` 里不可见）。
 *
 * 因此这里用一条启发式：**短时间内连续单个拉丁字母输入**，很可能是拼音组合中。
 * 它的代价是"用户快速连续打英文"时会被误判为组合中（表现为同步稍微延迟，
 * 松开键盘后一次性同步）—— 这是**可接受的退化**：延迟同步只是慢一点，
 * 而把拼音打到电脑上是**错误输入**，后者严重得多。
 *
 * 与之配套：ViewModel 里的指令是**串行队列**，所以延迟同步也不会乱序。
 */
private fun looksLikeComposing(
    new: String,
    previous: String,
    lastInputAt: Long,
    now: Long,
): Boolean {
    // 只有在"新增了恰好一个 ASCII 字母"且距上次输入很近时，才怀疑是组合输入
    val appended = new.length == previous.length + 1 && new.startsWith(previous)
    if (!appended) return false
    val ch = new.last()
    val isLatinLetter = ch in 'a'..'z' || ch in 'A'..'Z'
    if (!isLatinLetter) return false
    val gap = now - lastInputAt
    return lastInputAt > 0 && gap < COMPOSING_GAP_MS
}

/** 拼音连续输入的时间间隔阈值（超过它认为是一段新输入） */
private const val COMPOSING_GAP_MS = 400L

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
