package com.wanan.shortcut.feature.linked.control

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.ui.components.EmptyState
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 电脑粘贴板（对齐 web `#clipSheet`）。
 *
 * ## web 的交互定义
 *
 * - 打开抽屉时**自动读取**电脑剪贴板（`refreshClipUi()`）；
 * - **点条目 = 输出到电脑光标处**（`/api/clipboard/paste`）；
 * - 「复制」= 复制到**手机**剪贴板；
 * - 「刷新」重新读；「清历史」只清历史，**不影响**电脑当前剪贴板。
 */
@Composable
fun ClipboardSection(viewModel: ControlViewModel) {
    val state by viewModel.clipboard.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // 打开分区即自动读取（对齐 web 的 openSheet('clip') → refreshClipUi()）
    LaunchedEffect(Unit) { viewModel.refreshClipboard() }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ControlChip("刷新") { viewModel.refreshClipboard() }
            ControlChip("清历史") { viewModel.clearClipboardHistory() }
        }

        Text(
            text = "点条目 = 输出到电脑光标处 · 「复制」= 复制到手机剪贴板",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (state.loading) {
            Text(
                text = "正在读取电脑粘贴板…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        state.notice?.let { n ->
            LaunchedEffect(n) {
                kotlinx.coroutines.delay(2600)
                viewModel.consumeClipboardNotice()
            }
            Text(
                text = n,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        // 当前电脑剪贴板
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(
                text = "当前电脑剪贴板",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp, max = 120.dp)
                    .clip(MaterialTheme.shapes.small)
                    .background(MaterialTheme.colorScheme.surfaceContainerLowest)
                    .padding(Spacing.md),
            ) {
                Text(
                    text = state.current.ifBlank { "—" },
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = if (state.current.isBlank()) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                ControlChip("输出到光标") {
                    if (state.current.isNotBlank()) viewModel.pasteToDesktop(state.current)
                }
                ControlChip("复制到手机") {
                    if (state.current.isNotBlank()) copyToPhoneClipboard(context, state.current)
                }
            }
        }

        Text(
            text = "历史记录",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (state.history.isEmpty()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 96.dp)
                    .clip(MaterialTheme.shapes.medium)
                    .background(MaterialTheme.colorScheme.surfaceContainerLow),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "暂无记录，点「刷新」读取电脑剪贴板",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            // 历史条目不多（服务端有上限），但用 LazyColumn 更省；外面已有 scroll，
            // 所以这里用普通 Column 展开（避免嵌套滚动冲突）
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                state.history.forEach { item ->
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(MaterialTheme.shapes.small)
                            .background(MaterialTheme.colorScheme.surfaceContainerLow)
                            .padding(Spacing.md),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                            Text(
                                text = item,
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                maxLines = 4,
                                overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                                ControlChip("输出到光标") { viewModel.pasteToDesktop(item) }
                                ControlChip("复制") { copyToPhoneClipboard(context, item) }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun copyToPhoneClipboard(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    cm.setPrimaryClip(ClipData.newPlainText("ShortCut", text))
}
