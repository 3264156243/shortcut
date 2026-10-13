package com.wanan.shortcut.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.ui.theme.IconSizes
import com.wanan.shortcut.ui.theme.Radii
import com.wanan.shortcut.ui.theme.Sizes
import com.wanan.shortcut.ui.theme.Spacing
import com.wanan.shortcut.ui.theme.Strokes

/**
 * 三态视图（加载 / 空 / 错误）。
 *
 * ## 为什么重做
 *
 * 用户反馈"完全就是把文字摆在上面一样"。原来的实现确实如此：
 * - 空态 = 一行灰色 `Text` 居中
 * - 错误态 = 一行红字 + 一个按钮
 *
 * 重做后每个状态都有**图标 + 标题 + 说明 + 容器**四层。
 * 空态容器照搬 web `.clip-empty` 的手法：**虚线圆角描边**。
 * 这是很省力但观感提升明显的一招 —— 边界一旦画出来，就不再像"裸文字"。
 *
 * ## 可重试性的语义
 *
 * [ErrorState] 的 `retryable` 由调用方按 `ApiResult` 的类型决定：
 * 传输失败（网络/超时）可重试；业务失败（如"绑定码无效"）重试无意义。
 * 给不可重试的错误显示"重试"按钮只会误导用户。
 */

@Composable
fun LoadingState(
    modifier: Modifier = Modifier,
    text: String = "正在读取…",
) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.primary,
                strokeWidth = 2.5.dp,
                modifier = Modifier.size(28.dp),
            )
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * 空态：圆角容器 + 图标 + 标题 + 说明 +（可选）操作。
 *
 * @param actionText 非空时显示一个主按钮（例如"去连接""写第一条"）
 */
@Composable
fun EmptyState(
    text: String,
    modifier: Modifier = Modifier,
    icon: String = "📭",
    title: String? = null,
    actionText: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Box(
        modifier = modifier.fillMaxSize().padding(Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 360.dp)
                .clip(MaterialTheme.shapes.large)
                .border(
                    width = Strokes.hairline,
                    color = MaterialTheme.colorScheme.outline,
                    shape = MaterialTheme.shapes.large,
                )
                .padding(horizontal = Spacing.xl, vertical = Spacing.huge),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            // 图标放在一个柔和的圆形底上，比裸 emoji 稳
            Box(
                modifier = Modifier
                    .size(Sizes.emptyIcon)
                    .clip(RoundedCornerShape(Radii.pill))
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                contentAlignment = Alignment.Center,
            ) {
                Text(text = icon, fontSize = IconSizes.empty)
            }

            if (title != null) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = Spacing.xs),
                )
            }

            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            if (actionText != null && onAction != null) {
                Button(
                    onClick = onAction,
                    modifier = Modifier.padding(top = Spacing.sm),
                ) {
                    Text(actionText)
                }
            }
        }
    }
}

/**
 * 错误态：图标 + 标题 + 具体原因 +（可重试时）重试按钮。
 *
 * @param retryable 传输类失败传 true；业务类失败传 false（不显示重试按钮）
 */
@Composable
fun ErrorState(
    message: String,
    retryable: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = "出错了",
) {
    Box(
        modifier = modifier.fillMaxSize().padding(Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 360.dp)
                .clip(MaterialTheme.shapes.large)
                .border(
                    width = Strokes.hairline,
                    color = MaterialTheme.colorScheme.error.copy(alpha = 0.35f),
                    shape = MaterialTheme.shapes.large,
                )
                .padding(horizontal = Spacing.xl, vertical = Spacing.huge),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Box(
                modifier = Modifier
                    .size(Sizes.emptyIcon)
                    .clip(RoundedCornerShape(Radii.pill))
                    .background(MaterialTheme.colorScheme.errorContainer),
                contentAlignment = Alignment.Center,
            ) {
                Text(text = "⚠️", fontSize = IconSizes.empty)
            }

            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = Spacing.xs),
            )

            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            if (retryable) {
                Button(
                    onClick = onRetry,
                    modifier = Modifier.padding(top = Spacing.sm),
                ) {
                    Text("重试")
                }
            }
        }
    }
}

/** 内联错误提示（表单用：不占满整屏，保留用户已填内容） */
@Composable
fun InlineError(
    message: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.small)
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

/** 信息行（设置页用）：左标签右值。 */
@Composable
fun InfoRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = valueColor,
            textAlign = TextAlign.End,
            modifier = Modifier.padding(start = Spacing.md),
        )
    }
}
