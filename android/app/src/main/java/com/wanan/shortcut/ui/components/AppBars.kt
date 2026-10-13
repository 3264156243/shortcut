package com.wanan.shortcut.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 统一顶部栏。
 *
 * ## 为什么必须换成 `TopAppBar`（这是用户反馈的 B1 缺陷）
 *
 * 原实现是：
 * ```kotlin
 * TextButton(onClick = onBack) { Text("← 返回") }
 * ```
 * 问题有两层：
 * 1. **触摸目标太小**：视觉上就是一行小字，用户明确反馈"那么小…点不到"。
 * 2. **直接画到状态栏底下**：`MainActivity` 开了 `enableEdgeToEdge()`，
 *    但没有做任何 inset 处理，内容从屏幕物理顶端开始绘制，于是被状态栏遮住。
 *
 * `TopAppBar` 同时解决两者：返回箭头是标准 `IconButton`（48dp 触摸目标，
 * 符合 Android 无障碍硬要求），且**默认自带状态栏 inset 处理**
 * （[TopAppBarDefaults.windowInsets]），不需要我再手动 `statusBarsPadding()`。
 *
 * > ⚠️ 若在这里再手动加一次 inset，会与 Scaffold 的 padding 叠加成双重留白 ——
 * > 这正是 edge-to-edge 最常见的坑。**只依赖默认值。**
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShortCutTopBar(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    TopAppBar(
        modifier = modifier,
        title = {
            if (subtitle == null) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            } else {
                Column {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        navigationIcon = {
            if (onBack != null) {
                // IconButton 自带 48dp 触摸目标 —— 不用自己凑 padding
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "返回",
                    )
                }
            }
        },
        actions = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(end = Spacing.xs),
            ) { actions() }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface,
            titleContentColor = MaterialTheme.colorScheme.onSurface,
            navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
            actionIconContentColor = MaterialTheme.colorScheme.onSurface,
        ),
    )
}

/**
 * 带状态点的顶部栏（首页用）：标题下方显示"已连接 · 设备名 / 未连接电脑"。
 *
 * 对应 web `/mobile/` 顶部的绑定信息条 —— 让用户一眼知道当前连接状态。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShortCutTopBarWithStatus(
    title: String,
    statusText: String,
    online: Boolean,
    modifier: Modifier = Modifier,
    actions: @Composable () -> Unit = {},
) {
    TopAppBar(
        modifier = modifier.fillMaxWidth(),
        title = {
            Column {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    maxLines = 1,
                )
                StatusLine(online = online, text = statusText)
            }
        },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface,
            titleContentColor = MaterialTheme.colorScheme.onSurface,
        ),
    )
}
