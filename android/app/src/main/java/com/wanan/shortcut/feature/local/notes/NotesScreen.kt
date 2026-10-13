package com.wanan.shortcut.feature.local.notes

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.framework.LocalModuleSubRoute
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.ui.components.EmptyState
import com.wanan.shortcut.ui.components.LoadingState
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.Spacing
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 笔记板块的界面（本机功能，[com.wanan.shortcut.framework.ModuleDomain.LOCAL]）。
 *
 * 与任务墙的差别：**完全没有"未连接电脑"的概念** —— 本机板块不需要绑定，
 * 框架也不会拦它。
 */
@Composable
fun NotesScreen(navigator: ModuleNavigator) {
    val viewModel = containerViewModel { it.notesViewModel() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val subRoute = LocalModuleSubRoute.current

    when (subRoute) {
        null -> NotesList(
            state = state,
            onOpen = { id -> viewModel.open(id); navigator.to(ROUTE_EDIT) },
            onCreate = { viewModel.startNew(); navigator.to(ROUTE_EDIT) },
        )

        ROUTE_EDIT -> NoteEditor(
            state = state,
            onTitleChange = viewModel::editTitle,
            onBodyChange = viewModel::editBody,
            onSave = { viewModel.save { navigator.back() } },
            onDelete = { viewModel.delete { navigator.back() } },
            onBack = { navigator.back() },
        )
    }
}

@Composable
private fun NotesList(
    state: NotesUiState,
    onOpen: (String) -> Unit,
    onCreate: () -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        when (state) {
            NotesUiState.Loading -> LoadingState()

            // 编辑态由 NoteEditor 渲染；when 必须穷尽
            is NotesUiState.Editing -> LoadingState()

            is NotesUiState.Ready ->
                if (state.notes.isEmpty()) {
                    EmptyState(
                        text = "随手记点东西，只存在这台手机上，不联网。",
                        title = "还没有笔记",
                        icon = "📝",
                        actionText = "写第一条",
                        onAction = onCreate,
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = Spacing.lg,
                            end = Spacing.lg,
                            top = Spacing.sm,
                            // 底部留出 FAB 的高度，避免最后一条被遮住
                            bottom = 96.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(Spacing.md),
                    ) {
                        items(state.notes, key = { it.id }) { note ->
                            ScCard(onClick = { onOpen(note.id) }, contentPadding = Spacing.md) {
                                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                                    Text(
                                        text = note.title.ifBlank { "（无标题）" },
                                        style = MaterialTheme.typography.titleMedium,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    if (note.body.isNotBlank()) {
                                        Text(
                                            text = note.body,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                    Text(
                                        text = formatTime(note.updatedAt),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
        }

        ExtendedFloatingActionButton(
            onClick = onCreate,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(Spacing.xl),
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            text = { Text("新建") },
            icon = { Text("＋") },
        )
    }
}

@Composable
private fun NoteEditor(
    state: NotesUiState,
    onTitleChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onSave: () -> Unit,
    onDelete: () -> Unit,
    onBack: () -> Unit,
) {
    val editing = (state as? NotesUiState.Editing) ?: return

    // 编辑页的返回语义：回笔记列表（不退到首页）。
    // NavHost 已保证系统返回会出栈，这里不额外注册 BackHandler ——
    // 顶部栏返回箭头走的是同一个 popBackStack()，两者行为一致。
    Column(
        Modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        OutlinedTextField(
            value = editing.title,
            onValueChange = onTitleChange,
            label = { Text("标题") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = editing.body,
            onValueChange = onBodyChange,
            label = { Text("内容") },
            modifier = Modifier.fillMaxWidth().weight(1f),
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(onClick = onSave) { Text("保存") }
            TextButton(onClick = onBack) { Text("取消") }
            if (!editing.isNew) {
                TextButton(onClick = onDelete) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

private fun formatTime(millis: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(millis))

private const val ROUTE_EDIT = "edit"
