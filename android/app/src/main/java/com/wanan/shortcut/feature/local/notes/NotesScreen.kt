package com.wanan.shortcut.feature.local.notes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.FloatingActionButton
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
import com.wanan.shortcut.ui.containerViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 笔记板块的界面（本机功能，[com.wanan.shortcut.framework.ModuleDomain.LOCAL]）。
 *
 * 注意本文件与任务墙的差别：**完全没有"未连接电脑"的概念**。
 * 因为它不需要绑定，框架也不会拦它 —— 这正是本次重构要达成的效果。
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
            onSave = {
                viewModel.save { navigator.back() }
            },
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

            // 编辑态由 NoteEditor 渲染，列表这里不会出现；
            // 但 when 必须穷尽，否则以后新增状态时会被编译器漏掉。
            is NotesUiState.Editing -> LoadingState()

            is NotesUiState.Ready ->
                if (state.notes.isEmpty()) {
                    EmptyState("还没有笔记\n点右下角 ＋ 写一条")
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(state.notes, key = { it.id }) { note ->
                            Card(
                                modifier = Modifier.fillMaxWidth().clickableCard { onOpen(note.id) },
                            ) {
                                Column(Modifier.padding(14.dp)) {
                                    Text(
                                        text = note.title.ifBlank { "（无标题）" },
                                        style = MaterialTheme.typography.titleMedium,
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
                                            modifier = Modifier.padding(top = 4.dp),
                                        )
                                    }
                                    Text(
                                        text = formatTime(note.updatedAt),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(top = 6.dp),
                                    )
                                }
                            }
                        }
                    }
                }
        }

        FloatingActionButton(
            onClick = onCreate,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
        ) {
            Text("＋", style = MaterialTheme.typography.headlineSmall)
        }
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

    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
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
            minLines = 6,
            modifier = Modifier.fillMaxWidth().weight(1f),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = onSave) { Text("保存") }
            TextButton(onClick = onBack) { Text("取消") }
            if (!editing.isNew) {
                TextButton(onClick = onDelete) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

private fun Modifier.clickableCard(onClick: () -> Unit): Modifier =
    this.clickable(onClick = onClick)

private fun formatTime(millis: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(millis))

private const val ROUTE_EDIT = "edit"
