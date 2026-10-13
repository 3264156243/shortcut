package com.wanan.shortcut.feature.linked.taskwall

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.core.util.DateFormats
import com.wanan.shortcut.ui.components.EmptyState
import com.wanan.shortcut.ui.components.ErrorState
import com.wanan.shortcut.ui.components.LoadingState
import com.wanan.shortcut.ui.containerViewModel

/**
 * 任务墙页面。
 *
 * 注意本文件里**没有任何**身份/网络/错误处理代码——
 * 那些都由框架层（[com.wanan.shortcut.framework.ModuleHostScreen] 与 core 各模块）
 * 处理好了，板块只关心"怎么显示任务"。
 * 这正是 `ShortcutModule` 契约想达到的效果。
 */
@Composable
fun TaskwallScreen(
    onCompose: () -> Unit,
    viewModel: TaskwallViewModel = containerViewModel { it.taskwallViewModel() },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "桌面待接收任务",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "＋ 新建",
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .padding(8.dp)
                    .clickableText(onCompose),
            )
        }

        when (val s = state) {
            TaskwallUiState.Loading -> LoadingState()

            is TaskwallUiState.Failed -> ErrorState(
                message = s.message,
                retryable = s.retryable,
                onRetry = viewModel::refresh,
            )

            is TaskwallUiState.Ready ->
                if (s.tasks.isEmpty()) {
                    EmptyState("还没有待接收的任务\n点右上角「新建」把任务钉到电脑上")
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(s.tasks, key = { it.id }) { task ->
                            TaskRow(task = task, onDone = { viewModel.ack(task.id) })
                        }
                    }
                }
        }
    }
}

@Composable
private fun TaskRow(task: TaskItem, onDone: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = false, onCheckedChange = { if (it) onDone() })
            Column(Modifier.weight(1f)) {
                Text(
                    text = task.text,
                    style = MaterialTheme.typography.bodyLarge,
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
                val meta = buildList {
                    if (task.boardName.isNotBlank()) add("→ ${task.boardName}")
                    if (task.reminderEnabled && task.reminderAt.isNotBlank()) {
                        add("⏰ ${DateFormats.formatReminder(task.reminderAt)}")
                    }
                    if (task.createdAt.isNotBlank()) {
                        add(DateFormats.formatForDisplay(task.createdAt))
                    }
                }.joinToString("  ")
                if (meta.isNotBlank()) {
                    Text(
                        text = meta,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

/** 小工具：给 Text 加点击（避免为一个文本引入 Button 的额外边距）。 */
private fun Modifier.clickableText(onClick: () -> Unit): Modifier =
    this.clickable(onClick = onClick)
