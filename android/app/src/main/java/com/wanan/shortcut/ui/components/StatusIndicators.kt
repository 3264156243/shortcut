package com.wanan.shortcut.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.ui.theme.Sizes
import com.wanan.shortcut.ui.theme.Spacing
import com.wanan.shortcut.ui.theme.StatusColors
import com.wanan.shortcut.ui.theme.Strokes

/**
 * 连接状态圆点。
 *
 * 复刻 web 的做法（`.dot` / `.dot.ok`）：
 * 离线是灰色实心点；在线是绿点 + 一圈半透明外环（`box-shadow: 0 0 0 4px ...`）。
 *
 * 这个外环是"在线"与"离线"最直观的区别 —— 只靠颜色深浅，用户不容易一眼分辨，
 * 加上光晕之后即使色弱也能看出状态。
 */
@Composable
fun StatusDot(
    online: Boolean,
    modifier: Modifier = Modifier,
) {
    val color = if (online) StatusColors.online else StatusColors.offline

    Box(
        modifier = modifier.size(Sizes.statusDot + Sizes.statusDotHalo * 2),
        contentAlignment = Alignment.Center,
    ) {
        if (online) {
            // 半透明光晕外环
            Box(
                Modifier
                    .size(Sizes.statusDot + Sizes.statusDotHalo * 2)
                    .clip(CircleShape)
                    .background(color.copy(alpha = 0.12f)),
            )
        }
        Box(
            Modifier
                .size(Sizes.statusDot)
                .clip(CircleShape)
                .background(color),
        )
    }
}

/**
 * 胶囊标签（复刻 web `.pill` / `.chip`）。
 *
 * 用来表达"绑定中/未绑定""在线/离线"这类短状态。
 */
@Composable
fun StatusChip(
    text: String,
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
) {
    val shape = MaterialTheme.shapes.extraLarge
    val borderColor = if (highlighted) {
        StatusColors.online.copy(alpha = 0.30f)
    } else {
        MaterialTheme.colorScheme.outline
    }
    val textColor = if (highlighted) {
        StatusColors.online
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Box(
        modifier = modifier
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .border(Strokes.hairline, borderColor, shape)
            .padding(horizontal = Spacing.md, vertical = Spacing.xs),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = textColor,
        )
    }
}

/** 状态圆点 + 文字的横排（web `.status`） */
@Composable
fun StatusLine(
    online: Boolean,
    text: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StatusDot(online = online)
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
