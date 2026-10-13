package com.wanan.shortcut.feature.linked.taskwall

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.core.util.DateFormats
import com.wanan.shortcut.ui.components.EmptyState
import com.wanan.shortcut.ui.components.ErrorState
import com.wanan.shortcut.ui.components.LoadingState
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.components.StatusChip
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 任务墙页面。
 *
 * 本文件里**没有任何**身份/网络/错误处理代码 —— 那些由框架层处理好了，
 * 板块只关心"怎么显示任务"。
 */
@Composable
fun TaskwallScreen(
    onCompose: () -> Unit,
    viewModel: TaskwallViewModel = containerViewModel { it.taskwallViewModel() },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Box(Modifier.fillMaxSize()) {
        when (val s = state) {
            TaskwallUiState.Loading -> LoadingState(text = "正在读取待接收任务…")

            is TaskwallUiState.Failed -> ErrorState(
                message = s.message,
                retryable = s.retryable,
                onRetry = viewModel::refresh,
                title = "读取失败",
            )

            is TaskwallUiState.Ready ->
                if (s.tasks.isEmpty()) {
                    EmptyState(
                        text = "把任务钉到电脑上，桌面端启动后会自动接收。",
                        title = "还没有待接收的任务",
                        icon = "🗂️",
                        actionText = "新建任务",
                        onAction = onCompose,
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = Spacing.lg,
                            end = Spacing.lg,
                            top = Spacing.sm,
                            bottom = 96.dp,   // 给 FAB 留位
                        ),
                        verticalArrangement = Arrangement.spacedBy(Spacing.md),
                    ) {
                        items(s.tasks, key = { it.id }) { task ->
                            TaskRow(task = task, onDone = { viewModel.ack(task.id) })
                        }
                    }
                }
        }

        // 只有成功状态下才显示新建按钮（加载/错误时先让用户处理当前问题）
        if (state is TaskwallUiState.Ready) {
            ExtendedFloatingActionButton(
                onClick = onCompose,
                modifier = Modifier.align(Alignment.BottomEnd).padding(Spacing.xl),
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                text = { Text("新建") },
                icon = { Text("＋") },
            )
        }
    }
}

@Composable
private fun TaskRow(task: TaskItem, onDone: () -> Unit) {
    ScCard(contentPadding = Spacing.md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            // 勾选 = 确认消费（ack）。给一个圆形底，触摸目标更大也更像"待办"
            Box(
                modifier = Modifier.size(44.dp).clip(CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Checkbox(checked = false, onCheckedChange = { if (it) onDone() })
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Text(
                    text = task.text,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )

                // 长文本任务才显示详情（契约 §5.1：details 仅当 longText===true 有效）
                if (task.longText && task.details.isNotBlank()) {
                    Text(
                        text = task.details,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                // 元信息用胶囊标签，而不是一行灰字 —— 可读性与观感都更好
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    if (task.boardName.isNotBlank()) {
                        StatusChip(text = "→ ${task.boardName}")
                    }
                    if (task.reminderEnabled && task.reminderAt.isNotBlank()) {
                        StatusChip(
                            text = "⏰ ${DateFormats.formatReminder(task.reminderAt)}",
                            highlighted = true,
                        )
                    }
                }

                if (task.createdAt.isNotBlank()) {
                    Text(
                        text = DateFormats.formatForDisplay(task.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
