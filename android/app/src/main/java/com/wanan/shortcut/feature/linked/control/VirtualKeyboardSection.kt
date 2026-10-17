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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 虚拟键盘（对齐 web `#vkSheet` 的 `pressVk()`）。
 *
 * ## ★ 关键规则：有修饰键才走组合，否则走单键
 *
 * web 的原文（`control/app/js/phone.js:753`）：
 * ```js
 * function pressVk(key) {
 *   const k = String(key).toLowerCase();
 *   if (['ctrl','shift','alt','win'].includes(k)) return;   // 修饰键本身不发
 *   const active = [];
 *   if (mods.ctrl) active.push('ctrl'); ...
 *   if (active.length) sendCombo(active.concat([key]));     // 有修饰 → /api/combo
 *   else sendKey(key);                                      // 没修饰 → /api/key
 * }
 * ```
 *
 * ⚠️ 我此前**一律走 `sendCombo`**，这是踩过的真实 bug（用户反馈
 * "**键盘打字母却是一些快捷键一样的**"）：
 * `/api/key` 是"按下一个键"（`inject("KEY <vk>")`），
 * 而 `/api/combo` 是"按键序列"，单个字母走它会被当成序列处理。
 *
 * ## 与 web 的一处有意差异
 *
 * web 的修饰键是**粘滞**的（点亮后一直有效，直到手动「释放修饰」）。
 * 安卓端改为**发完即清**（web 的 `pressVk` 末尾其实也调了 `clearMods()`，
 * 只是按钮上的高亮另外维护）—— 这样不会出现"忘了释放修饰导致后续按键全变组合"。
 */
@Composable
fun VirtualKeyboardSection(viewModel: ControlViewModel) {
    // 修饰键（web 的 `mods` 对象）
    var mods by remember { mutableStateOf(emptySet<String>()) }

    fun toggleModifier(name: String) {
        mods = if (name in mods) mods - name else mods + name
    }

    /**
     * 按一个键 —— 严格照 web 的 `pressVk` 分支。
     *
     * 修饰键本身不发送（web 第一行就 `return`）；有修饰才组合。
     */
    fun pressKey(label: String) {
        // ★ 字母要用大写发（见 VirtualKeyboard.toServerKey 的说明）：
        //   桌面端把单字符直接当 VK 用，而 Windows 字母键的 VK 是大写 ASCII。
        //   发小写 'a'=0x61 会变成"小键盘 1"，'z'=0x7A 会变成 F11 ——
        //   表现就是用户说的"点字母，电脑收到的却是些快捷键"。
        val keyName = VirtualKeyboard.toServerKey(label)

        // 修饰键本身不发送：它只是"待生效状态"
        if (keyName.lowercase() in VirtualKeyboard.MODIFIERS) return

        if (mods.isEmpty()) {
            // 无修饰 → 单键（/api/key）
            viewModel.sendSingleKey(keyName)
        } else {
            viewModel.sendCombo(mods.toList() + keyName)
            // 发完即清：避免用户忘了释放修饰，后续每个字母都变成组合键
            mods = emptySet()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (mods.isEmpty()) "未选修饰键" else "修饰：${mods.joinToString("+")}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ControlChip("释放修饰") { mods = emptySet() }
        }

        Text(
            text = "点修饰键（可多选）再点字母键，即发送组合键。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // 主键区（web 的 `#vkBody`）
        VirtualKeyboard.ROWS.forEach { row ->
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                row.forEach { label ->
                    KeyCap(
                        label = label,
                        modifier = Modifier.weight(keyWeight(label)),
                        onClick = { pressKey(label) },
                    )
                }
            }
        }

        // 修饰键区（web 的 `#vkMods`）
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            VirtualKeyboard.MODIFIERS.forEach { name ->
                val active = name in mods
                Box(
                    Modifier
                        .weight(1f)
                        .clip(MaterialTheme.shapes.small)
                        .background(
                            if (active) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.surfaceContainerHigh,
                        )
                        .clickable { toggleModifier(name) }
                        .padding(vertical = Spacing.md),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = name.replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.labelMedium,
                        color = if (active) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                    )
                }
            }
        }
    }
}

/**
 * 一个键帽。
 *
 * 触摸目标高度 44dp：比 48dp 略小 —— 因为键盘要在一屏内容纳 6 行，
 * 每行都 48dp 会超出屏幕。宽度由 `weight` 决定。
 */
@Composable
private fun KeyCap(
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(MaterialTheme.shapes.small)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .clickable(onClick = onClick)
            .padding(vertical = Spacing.md, horizontal = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = displayLabel(label),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            textAlign = TextAlign.Center,
        )
    }
}

/** 显示名（把 `backspace` 这类长名字压缩到能放进键帽） */
private fun displayLabel(label: String): String = when (label) {
    "backspace" -> "⌫"
    "enter" -> "⏎"
    "tab" -> "⇥"
    "caps" -> "Caps"
    "shift" -> "⇧"
    "ctrl" -> "Ctrl"
    "alt" -> "Alt"
    "win" -> "Win"
    "space" -> "空格"
    "escape" -> "Esc"
    "delete" -> "Del"
    else -> label
}

/** 长键名的宽度权重（对齐 web 的 `.vk.w1..w6`） */
private fun keyWeight(label: String): Float = when (label) {
    "backspace" -> 2.0f
    "enter" -> 1.8f
    "tab", "caps" -> 1.5f
    "shift" -> 2.2f
    "ctrl", "alt", "win" -> 1.4f
    "space" -> 5.0f
    else -> 1.0f
}
