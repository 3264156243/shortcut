package com.wanan.shortcut.feature.linked.control

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.ui.theme.Spacing
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 触控板（对齐 web `#pad` 的手势语义）。
 *
 * ## web 的手势定义（逐条照做）
 *
 * | 手势 | 动作 |
 * |---|---|
 * | 单指滑动 | 移动鼠标（按灵敏度缩放） |
 * | 单指短按（<320ms，未移动） | 左键单击 |
 * | 单指长按（550ms，未移动） | 右键 |
 * | 双指轻点 | 右键 |
 * | 双指上下滑 | 滚轮（`dy >= 12` 才触发，避免抖动） |
 *
 * ## 与 web 的差异（有意）
 *
 * web 用原生 `touchstart/move/end` 手写全部判定；Compose 侧用
 * `detectDragGestures` + `detectTapGestures(onLongPress)` 组合。
 * 双指手势 Compose 的通用 API 支持较弱，因此这里**用按钮补足**滚轮与右键
 * （web 本来也提供了"滚轮↑↓/左中右键"按钮作为替代路径）。
 */
@Composable
fun TouchPadSection(viewModel: ControlViewModel) {
    var sensitivity by remember { mutableFloatStateOf(1.0f) }
    var moved by remember { mutableStateOf(false) }
    var lastPos by remember { mutableStateOf(Offset.Zero) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Text(
            text = "单指滑动 = 移动　单击 = 左键　长按 = 右键　下方按钮 = 滚轮/中键",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // 触控面
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(300.dp)
                .clip(MaterialTheme.shapes.large)
                .background(MaterialTheme.colorScheme.surfaceContainerLow)
                .pointerInput(sensitivity) {
                    detectDragGestures(
                        onDragStart = {
                            moved = false
                            lastPos = Offset.Zero
                        },
                        onDrag = { change, dragAmount ->
                            change.consume()
                            moved = true
                            // 按灵敏度缩放（web 是 `Math.round(dx * sens)`）
                            val dx = (dragAmount.x * sensitivity).roundToInt()
                            val dy = (dragAmount.y * sensitivity).roundToInt()
                            if (abs(dx) + abs(dy) > 0) viewModel.sendMouse(dx, dy)
                        },
                    )
                }
                .pointerInput(Unit) {
                    detectTapGestures(
                        onTap = {
                            // 只有没拖动过才算单击（web 用 `!lastTouch.moved` 判断）
                            if (!moved) viewModel.sendClick("left")
                            moved = false
                        },
                        onLongPress = {
                            if (!moved) viewModel.sendClick("right")
                            moved = false
                        },
                        onDoubleTap = { viewModel.sendDoubleClick() },
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "在此滑动控制鼠标\n单击左键 · 长按右键 · 双击两下",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }

        // 灵敏度（web 是 range 0.3..2.5 step 0.1）
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Text(
                text = "灵敏度",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Slider(
                value = sensitivity,
                onValueChange = { sensitivity = it },
                valueRange = 0.3f..2.5f,
                steps = 21,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = String.format("%.1fx", sensitivity),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }

        // 左右中键（web 的 `.pad-tools`）
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            ControlKeyButton("左键", Modifier.weight(1f)) { viewModel.sendClick("left") }
            ControlKeyButton("右键", Modifier.weight(1f)) { viewModel.sendClick("right") }
            ControlKeyButton("中键", Modifier.weight(1f)) { viewModel.sendClick("middle") }
        }

        // 滚轮 + 双击（web 的 `wheelUp/wheelDn/btnDbl`；web 的步长是 ±240）
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            ControlKeyButton("滚轮↑", Modifier.weight(1f)) { viewModel.sendWheel(240) }
            ControlKeyButton("滚轮↓", Modifier.weight(1f)) { viewModel.sendWheel(-240) }
            ControlKeyButton("双击", Modifier.weight(1f)) { viewModel.sendDoubleClick() }
        }

        // 更多快捷键（web 的"更多快捷键"折叠区，这里直接展开）
        Text(
            text = "更多快捷键",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PAD_MORE_SHORTCUTS.chunked(3).forEach { row ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    row.forEach { sc ->
                        ControlKeyButton(sc.label, Modifier.weight(1f)) {
                            viewModel.sendCombo(sc.keys)
                        }
                    }
                    // 补齐占位，避免最后一行被拉伸
                    repeat(3 - row.size) {
                        Box(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}
