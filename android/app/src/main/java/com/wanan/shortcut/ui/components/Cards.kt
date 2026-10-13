package com.wanan.shortcut.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.ui.theme.IconSizes
import com.wanan.shortcut.ui.theme.Radii
import com.wanan.shortcut.ui.theme.Sizes
import com.wanan.shortcut.ui.theme.Spacing
import com.wanan.shortcut.ui.theme.Strokes

/**
 * 卡片容器 —— "样式包裹"的基本单位。
 *
 * ## 设计要点（对齐 web `.card` / `.nav-card`）
 *
 * 1. **用描边而不是阴影**：深色主题下阴影几乎看不见，反而让面发灰；
 *    web 全站卡片都是 `1px solid rgba(255,255,255,.09)`，不投阴影。
 * 2. **用 surfaceContainer 而不是默认 surface**：M3 的色调层级能表达
 *    "页面底 → 卡片 → 抬起元素"，比单纯改边框更有层次。
 * 3. 圆角统一走 `shapes.medium`（12dp），不写裸数字。
 */
@Composable
fun ScCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    containerColor: Color = MaterialTheme.colorScheme.surfaceContainer,
    contentPadding: Dp = Spacing.lg,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        shape = MaterialTheme.shapes.medium,
        color = containerColor,
        border = BorderStroke(Strokes.hairline, MaterialTheme.colorScheme.outline),
    ) {
        Box(Modifier.padding(contentPadding)) { content() }
    }
}

/**
 * 列表行卡片 —— 对齐 web `.nav-card` 的形态：
 *
 * ```
 * ┌──────────────────────────────────────┐
 * │ ┌────┐  标题                    ›    │
 * │ │ 🗂️ │  副标题                       │
 * │ └────┘                               │
 * └──────────────────────────────────────┘
 *   46dp        flex:1               右箭头
 * ```
 *
 * 整行可点（不是只有文字可点），最小高度 64dp，保证触摸目标足够大。
 */
@Composable
fun ScListCard(
    icon: String,
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailing: String? = "›",
    onClick: (() -> Unit)? = null,
    /** 置灰（例如"未连接电脑"的联动板块）：整行降透明度 */
    dimmed: Boolean = false,
) {
    ScCard(
        modifier = modifier
            .defaultMinSize(minHeight = Sizes.listRow)
            .alpha(if (dimmed) 0.55f else 1f),
        onClick = onClick,
        contentPadding = Spacing.md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            // 图标容器：这是"有包裹感"的关键 —— 裸 emoji 直接摆在卡片里会显得空
            Box(
                modifier = Modifier
                    .size(Sizes.listIcon)
                    .clip(RoundedCornerShape(Radii.sm))
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                contentAlignment = Alignment.Center,
            ) {
                Text(text = icon, fontSize = IconSizes.list)
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            if (trailing != null) {
                Text(
                    text = trailing,
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * 分区标题。
 *
 * 右侧接一条 1dp 细线并延伸到行尾，把标题与它下面的内容在视觉上绑成一组
 * —— 只写一行灰字的话，看起来就像"又一段裸文字"。
 */
@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (trailing != null) {
            Text(
                text = trailing,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box(
            Modifier
                .weight(1f)
                .height(Strokes.hairline)
                .background(MaterialTheme.colorScheme.outlineVariant),
        )
    }
}
