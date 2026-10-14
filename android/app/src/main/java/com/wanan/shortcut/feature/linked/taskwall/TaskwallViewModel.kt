package com.wanan.shortcut.feature.linked.taskwall

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wanan.shortcut.core.error.ErrorAction
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 任务墙（手机端）状态。
 *
 * ## 为什么没有"任务列表"
 *
 * 对照 web 参考实现（`server/sync/web/taskwall/index.html`）：
 * 该页是**「新增任务」表单**，不展示队列、不提供勾选完成。
 *
 * 我最初做成了"任务列表 + 勾选完成"，那有两处错误：
 *   1. 队列是"**等桌面接收**"的快递，不是用户的待办清单，展示会误导；
 *   2. 勾选会调 `ack`，而 `ack` 会把任务从队列删掉 → 桌面永远收不到（破坏性 bug）。
 */
sealed interface TaskwallUiState {

    data object Loading : TaskwallUiState

    /** 表单可用 */
    data class Ready(
        /**
         * 桌面端上报的任务墙名（来自 `board.list`）。
         *
         * 空列表表示桌面端**还没上报过墙名** —— 此时 UI 必须明确提示，
         * 不能静默当成"只有默认任务墙"（《任务墙板块待办》T1）。
         */
        val boards: List<String> = emptyList(),

        /** 读墙列表时的提示（空列表或失败时的说明），null 表示一切正常 */
        val boardsHint: String? = null,

        /** 正在读取墙列表 */
        val boardsLoading: Boolean = false,

        /** 队列中"等待电脑接收"的条数（只读诊断信息，非任务清单） */
        val queuedCount: Int? = null,
    ) : TaskwallUiState
}

/** 下发任务的结果反馈（用于提示文案）。 */
sealed interface PushOutcome {
    /** 桌面在线，已实时送达 */
    data object Delivered : PushOutcome

    /** 已入队，桌面离线，下次拉取时到（契约 §5.1：**不是失败**） */
    data object Queued : PushOutcome

    data class Failed(val message: String) : PushOutcome
}

/**
 * 任务墙 ViewModel（手机端）。
 *
 * 职责只有两件：**下发任务** 与 **读取任务墙列表**。
 * 与 web 参考实现的能力集完全一致。
 */
class TaskwallViewModel(
    private val repository: TaskwallRepository,
    private val errorMapper: ErrorMapper,
) : ViewModel() {

    private val _state = MutableStateFlow<TaskwallUiState>(TaskwallUiState.Loading)
    val state: StateFlow<TaskwallUiState> = _state.asStateFlow()

    init {
        refreshBoards()
    }

    /**
     * 读取桌面端上报的任务墙列表（契约 §5.4）。
     *
     * 对齐 web 的 `loadBoards()`，包括它的**可诊断性**处理：
     * "请求成功但列表为空" 与 "请求失败" 是两种不同情况，
     * 必须给出不同提示，否则用户只能靠猜（web 注释里明确写了这一点）。
     */
    fun refreshBoards() {
        viewModelScope.launch {
            val current = _state.value as? TaskwallUiState.Ready
            _state.value = (current ?: TaskwallUiState.Ready()).copy(boardsLoading = true)

            val next = when (val r = repository.boards()) {
                is ApiResult.Ok -> {
                    val clean = r.data.boards.filter { it.isNotBlank() }
                    if (clean.isEmpty()) {
                        // 区分两种"空"，因为对策不同（利用了线上返回的 boardsUpdatedAt）：
                        //   - 从没上报过 → 让用户去电脑上打开任务墙
                        //   - 上报过但为空 → 提示墙被删空/上报内容有问题
                        val hint = if (r.data.boardsUpdatedAt.isBlank()) {
                            "电脑端**还没有上报过**任务墙，暂时只能选「$DEFAULT_BOARD」。" +
                                "请在电脑上打开任务墙板块后，回来点「刷新」。"
                        } else {
                            "电脑端上报的任务墙是空的，暂时只能选「$DEFAULT_BOARD」。" +
                                "请检查电脑端是否有任务墙，然后回来点「刷新」。"
                        }
                        TaskwallUiState.Ready(
                            boards = listOf(DEFAULT_BOARD),
                            boardsHint = hint,
                        )
                    } else {
                        TaskwallUiState.Ready(boards = clean, boardsHint = null)
                    }
                }

                is ApiResult.BusinessFail -> TaskwallUiState.Ready(
                    boards = listOf(DEFAULT_BOARD),
                    boardsHint = describe(r.message) + "（已回退到「$DEFAULT_BOARD」，可点「刷新」重试）",
                )

                is ApiResult.TransportFail -> TaskwallUiState.Ready(
                    boards = listOf(DEFAULT_BOARD),
                    boardsHint = "网络不可用，已回退到「$DEFAULT_BOARD」，可点「刷新」重试。",
                )

                ApiResult.Unauthorized -> TaskwallUiState.Ready(
                    boards = listOf(DEFAULT_BOARD),
                    boardsHint = "连接已失效，请重新绑定。",
                )
            }

            // 保留上一次已知的排队数（避免刷新墙列表时把诊断信息闪没）
            _state.value = next.copy(queuedCount = current?.queuedCount)
            refreshQueuedCount()
        }
    }

    /**
     * 只读地看一眼"还有几条在等电脑接收"。
     *
     * ⚠️ 这里调的是 `pull`（**peek 不消费**），**不是** `ack`。
     * 用它只是为了让用户知道"我发的任务还在路上"，不构成任务清单，
     * 也绝不给勾选入口（勾选 = 删除 = 桌面收不到）。
     *
     * 失败时静默（这只是辅助信息，不该因为它报错打扰用户）。
     */
    private fun refreshQueuedCount() {
        viewModelScope.launch {
            when (val r = repository.pull()) {
                is ApiResult.Ok -> {
                    val s = _state.value as? TaskwallUiState.Ready ?: return@launch
                    _state.value = s.copy(queuedCount = r.data.count)
                }
                else -> Unit
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
                // 转成 UTC ISO（与网页端 toISOString() 一致）。
                // 不能发本地时间，否则桌面端提醒时刻会偏 8 小时。
                reminderAtIso = reminderAtEpochMillis
                    ?.let { com.wanan.shortcut.core.util.DateFormats.toIsoUtc(it) }
                    ?: "",
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

            // 提交成功后刷新排队数，让用户看到"还在等电脑接收"
            if (outcome !is PushOutcome.Failed) refreshQueuedCount()

            onResult(outcome)
        }
    }

    /**
     * 把服务端文案翻成用户能读懂的提示（**复用框架的 [ErrorMapper]**）。
     */
    private fun describe(message: String): String = when (errorMapper.map(message)) {
        ErrorAction.RATE_LIMITED -> "操作太快了，请稍后再试"
        ErrorAction.REBIND -> "连接已失效，请重新绑定"
        ErrorAction.INVALID_INPUT -> message.ifBlank { "输入有误" }
        // 其余原样展示：服务端文案通常已含可操作信息
        else -> message.ifBlank { "操作失败，请稍后再试" }
    }

    private companion object {
        /** 与 web 参考实现一致的兜底墙名 */
        const val DEFAULT_BOARD = "默认任务墙"
    }
}
