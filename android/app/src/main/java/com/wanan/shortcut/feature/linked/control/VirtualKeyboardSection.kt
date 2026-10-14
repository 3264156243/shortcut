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
 * 虚拟键盘（对齐 web `#vkSheet`）。
 *
 * ## web 的关键行为
 *
 * - 修饰键（Ctrl/Shift/Alt/Win）是**粘滞**的：点亮后与下一个普通键**组合**发出；
 * - 有「释放修饰」按钮一次性清掉所有修饰；
 * - 键盘**始终按横屏形态展示**（与手机方向无关）。
 *
 * 安卓端：
 * - 保持粘滞修饰 + 组合发送的语义（这是虚拟键盘最实用的地方）；
 * - **不做横屏旋转**：那个设计是为了在竖屏手机上看清 14 列的键位。
 *   安卓端改为**横向可滚动**（14 列挤在一屏会小到按不准）。
 */
@Composable
fun VirtualKeyboardSection(viewModel: ControlViewModel) {
    // 粘滞修饰键（web 的 `mods` 对象）
    var mods by remember { mutableStateOf(emptySet<String>()) }

    fun toggleModifier(name: String) {
        mods = if (name in mods) mods - name else mods + name
    }

    /** 发一个普通键：有修饰则发组合，否则单键 */
    fun pressKey(label: String) {
        val keyName = VirtualKeyboard.toKeyName(label)
        if (mods.isEmpty()) {
            viewModel.sendCombo(listOf(keyName))
        } else {
            viewModel.sendCombo(mods.toList() + keyName)
        }
        // web 里修饰键是粘滞的（发完组合后仍保持点亮），这里保持一致
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
