package com.wanan.shortcut.feature.linked.taskwall

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wanan.shortcut.core.error.ErrorAction
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.core.result.fold
import com.wanan.shortcut.core.util.DateFormats
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 任务墙列表状态。
 *
 * 用密封类表达，避免"既 loading 又 error"这类矛盾状态。
 */
sealed interface TaskwallUiState {
    data object Loading : TaskwallUiState
    data class Ready(val tasks: List<TaskItem>) : TaskwallUiState

    /**
     * 加载失败。
     *
     * [retryable] 区分传输失败（可重试）与业务失败（重试无用），
     * 由 `ui/components/ErrorState` 决定是否显示重试按钮。
     */
    data class Failed(val message: String, val retryable: Boolean) : TaskwallUiState
}

/** 下发任务的结果反馈（用于 toast 文案）。 */
sealed interface PushOutcome {
    /** 桌面在线，已实时送达 */
    data object Delivered : PushOutcome

    /** 已入队，桌面离线，下次拉取时到（契约 §5.1：**不是失败**） */
    data object Queued : PushOutcome

    data class Failed(val message: String) : PushOutcome
}

/**
 * 任务墙 ViewModel。
 *
 * 这个板块是**框架的第一个真实用户**——写它同时也在验证
 * `ShortcutModule` 契约是否够用（见 `docs/android/安卓端开工需求计划.md` §3 P1）。
 *
 * 已确认框架省掉的事情：身份注入（[com.wanan.shortcut.core.net.ApiClient] 自动带
 * bindId/mobileToken）、令牌失效跳绑定页（[com.wanan.shortcut.core.identity.IdentityProvider]）、
 * 错误文案映射（[ErrorMapper]）、网络与业务失败的区分（[ApiResult]）。
 * 本类里**没有**任何一处出现 bindId / mobileToken / "移动端绑定已失效" 字样。
 */
class TaskwallViewModel(
    private val repository: TaskwallRepository,
    private val errorMapper: ErrorMapper,
) : ViewModel() {

    private val _state = MutableStateFlow<TaskwallUiState>(TaskwallUiState.Loading)
    val state: StateFlow<TaskwallUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    /**
     * 拉取任务列表（契约 §5.2）。
     *
     * ⚠️ `pull` **不消费**任务，可重复拉；只有 [ack] 才移除。
     */
    fun refresh() {
        viewModelScope.launch {
            _state.value = TaskwallUiState.Loading
            _state.value = when (val r = repository.pull()) {
                is ApiResult.Ok -> TaskwallUiState.Ready(r.data.tasks)
                is ApiResult.BusinessFail ->
                    TaskwallUiState.Failed(describe(r.message), retryable = false)
                is ApiResult.TransportFail ->
                    TaskwallUiState.Failed("网络不可用，请检查网络后重试", retryable = true)
                ApiResult.Unauthorized ->
                    // 身份失效已由框架统一处理（跳绑定页）；这里只是不让 UI 卡在 Loading
                    TaskwallUiState.Failed("请先连接电脑", retryable = false)
            }
        }
    }

    /**
     * 下发任务（契约 §5.1）。
     *
     * @param reminderAtEpochMillis 用户选择的提醒时刻；为 null 表示不提醒
     */
    fun push(
        text: String,
        longText: Boolean,
        details: String,
        reminderAtEpochMillis: Long?,
        boardName: String,
        onResult: (PushOutcome) -> Unit,
    ) {
        viewModelScope.launch {
            val reminderEnabled = reminderAtEpochMillis != null
            val r = repository.push(
                text = text,
                longText = longText,
                details = details,
                reminderEnabled = reminderEnabled,
                // 转成 UTC ISO（与网页端 toISOString() 一致），
                // 不能发本地时间，否则桌面端提醒时刻会偏 8 小时
                reminderAtIso = reminderAtEpochMillis?.let { DateFormats.toIsoUtc(it) } ?: "",
                boardName = boardName,
            )

            val outcome = when (r) {
                is ApiResult.Ok -> {
                    // 契约 §5.1：deliveredRealtime=false 不是失败，只是桌面离线、任务已入队
                    if (r.data.deliveredRealtime) PushOutcome.Delivered else PushOutcome.Queued
                }
                is ApiResult.BusinessFail -> PushOutcome.Failed(describe(r.message))
                is ApiResult.TransportFail -> PushOutcome.Failed("网络不可用，请稍后重试")
                ApiResult.Unauthorized -> PushOutcome.Failed("请先连接电脑")
            }
            onResult(outcome)
            if (outcome !is PushOutcome.Failed) refresh()
        }
    }

    /** 确认消费（契约 §5.3）。 */
    fun ack(taskId: String) {
        viewModelScope.launch {
            when (repository.ack(listOf(taskId))) {
                is ApiResult.Ok -> refresh()
                else -> Unit   // 失败时保持列表不变，用户可重试
            }
        }
    }

    /**
     * 把服务端文案翻成用户能读懂的提示（**复用框架的 [ErrorMapper]**）。
     *
     * 重试无意义，所以调用 [describe] 的地方一律 `retryable = false`。
     */
    private fun describe(message: String): String = when (errorMapper.map(message)) {
        ErrorAction.RATE_LIMITED -> "操作太快了，请稍后再试"
        ErrorAction.REBIND -> "连接已失效，请重新绑定"
        ErrorAction.INVALID_INPUT -> message.ifBlank { "输入有误" }
        // 其余原样展示：服务端文案通常已含可操作信息
        else -> message.ifBlank { "操作失败，请稍后再试" }
    }
}
