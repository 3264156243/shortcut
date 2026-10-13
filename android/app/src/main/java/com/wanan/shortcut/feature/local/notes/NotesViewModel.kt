package com.wanan.shortcut.feature.local.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/** 笔记页状态。 */
sealed interface NotesUiState {
    data object Loading : NotesUiState
    data class Ready(val notes: List<Note>) : NotesUiState
    data class Editing(
        val id: String,
        val title: String,
        val body: String,
        /** 新建（尚未入库）时为 true，用于决定是否显示"删除" */
        val isNew: Boolean,
    ) : NotesUiState
}

/**
 * 笔记 ViewModel —— **第一个纯本机板块**。
 *
 * 与 [com.wanan.shortcut.feature.taskwall.TaskwallViewModel] 对比可以看出框架的价值：
 * 本类**没有任何** ApiResult / ErrorMapper / 身份 / 网络相关的代码，
 * 因为本机板块压根不碰这些。这就是 [com.wanan.shortcut.framework.ModuleDomain.LOCAL]
 * 与 LINKED 的实际差别。
 */
class NotesViewModel(private val repository: NotesRepository) : ViewModel() {

    private val _state = MutableStateFlow<NotesUiState>(NotesUiState.Loading)
    val state: StateFlow<NotesUiState> = _state.asStateFlow()

    init {
        reload()
    }

    private fun reload() {
        viewModelScope.launch {
            _state.value = NotesUiState.Ready(repository.load())
        }
    }

    /** 打开已有笔记 */
    fun open(id: String) {
        viewModelScope.launch {
            val note = repository.get(id) ?: return@launch
            _state.value = NotesUiState.Editing(
                id = note.id, title = note.title, body = note.body, isNew = false,
            )
        }
    }

    /** 新建（id 先本地生成，保存时才落库） */
    fun startNew() {
        _state.value = NotesUiState.Editing(
            id = UUID.randomUUID().toString().replace("-", "").take(24),
            title = "",
            body = "",
            isNew = true,
        )
    }

    fun editTitle(value: String) {
        val s = _state.value as? NotesUiState.Editing ?: return
        _state.value = s.copy(title = value)
    }

    fun editBody(value: String) {
        val s = _state.value as? NotesUiState.Editing ?: return
        _state.value = s.copy(body = value)
    }

    /** 保存；空笔记不落库（避免列表里出现一堆空条目）。 */
    fun save(onDone: () -> Unit) {
        val s = _state.value as? NotesUiState.Editing ?: return
        viewModelScope.launch {
            if (s.title.isBlank() && s.body.isBlank()) {
                onDone()
                reload()
                return@launch
            }
            repository.upsert(
                Note(
                    id = s.id,
                    title = s.title.trim(),
                    body = s.body.trim(),
                    updatedAt = System.currentTimeMillis(),
                ),
            )
            onDone()
            reload()
        }
    }

    fun delete(onDone: () -> Unit) {
        val s = _state.value as? NotesUiState.Editing ?: return
        viewModelScope.launch {
            repository.delete(s.id)
            onDone()
            reload()
        }
    }
}
