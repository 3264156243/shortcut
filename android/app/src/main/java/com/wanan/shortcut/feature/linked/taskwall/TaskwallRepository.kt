package com.wanan.shortcut.feature.linked.taskwall

import com.wanan.shortcut.core.net.ApiGateway
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult

/**
 * 任务墙数据源（queue 能力，契约 §5）。
 *
 * ⚠️核心约束：`board` 字段在所有 queue 接口**必须显式为 `"taskwall"`**，
 * 否则服务端返回 `暂不支持的板块`（契约 §5 开头）。
 * 把它固化成常量并只在本类里使用，避免各调用点写错或漏写。
 *
 * ## 手机端只做两件事：`push` 与 `board.list`
 *
 * 这一点是**对照 web 参考实现**得出的（`server/sync/web/taskwall/index.html`）：
 * 该页面**只有 `push`**，从不 `pull`，更没有 `ack`。
 */
class TaskwallRepository(private val apiClient: ApiGateway) {

    /**
     * 下发任务（契约 §5.1）。
     *
     * 关于 `longText` / `reminderEnabled`：契约要求**严格 `=== true`** 才生效，
     * 因此这里传真正的 Kotlin `Boolean`，由 `core/net/putValue` 序列化成
     * JSON 原生 `true/false`（单测已锁住）。
     */
    suspend fun push(
        text: String,
        longText: Boolean = false,
        details: String = "",
        reminderEnabled: Boolean = false,
        reminderAtIso: String = "",
        boardName: String = "",
    ): ApiResult<PushResponse> {
        val params = mutableMapOf<String, Any?>(
            "board" to BOARD,
            "text" to text.take(120),          // 契约 §5.1：截 120 字
        )
        // 只在需要时带上可选字段：契约规定 details 仅当 longText===true 才读取
        if (longText) {
            params["longText"] = true
            params["details"] = details.take(2000)   // 契约 §5.1：截 2000 字
        }
        if (reminderEnabled) {
            params["reminderEnabled"] = true
            params["reminderAt"] = reminderAtIso
        }
        if (boardName.isNotBlank()) {
            params["boardName"] = boardName.take(40)
        }

        return apiClient.post("push", params).map { obj ->
            Json.gson.fromJson(obj, PushResponse::class.java)
        }
    }

    /**
     * 任务墙列表（契约 §5.4）。
     *
     * 这是**桌面端上报的墙名**（`bind.boards.update`），
     * 手机端用它填充"目标任务墙"下拉框 —— 与 web 参考实现一致。
     *
     * ⚠️ 服务端可能返回**空列表**（桌面端还没上报过墙名）。
     * 此时不能静默兜底成"默认任务墙"就完事：web 端会明确提示
     * "桌面端尚未上报任务墙列表，已回退到「默认任务墙」" ——
     * 否则用户以为桌面只有一面墙（《任务墙板块待办》T1 记录的实测问题）。
     */
    suspend fun boards(): ApiResult<BoardListResponse> =
        apiClient.post("board.list", mapOf("board" to BOARD)).map { obj ->
            Json.gson.fromJson(obj, BoardListResponse::class.java)
        }

    /**
     * `pull` —— 仅用于**诊断**，手机端界面不使用它。
     *
     * ## 为什么手机端不该展示/拉取队列
     *
     * 队列里是"**发给桌面端、等它接收**"的任务。
     * 手机端把它当"我的任务清单"展示会误导用户 ——
     * 它其实是"还没被电脑收走的快递"，不是待办列表。
     *
     * web `/taskwall/` 只提供「新增任务」表单，不展示队列。保留本方法仅为排查。
     */
    suspend fun pull(): ApiResult<PullResponse> =
        apiClient.post("pull", mapOf("board" to BOARD)).map { obj ->
            Json.gson.fromJson(obj, PullResponse::class.java)
        }

    /**
     * `ack` —— **手机端绝对不要调用**（仅保留给诊断/测试，界面上无入口）。
     *
     * ## 这是我自己引入过的破坏性 bug（2026-10-14）
     *
     * 我最初把手机端任务墙做成"任务列表 + 勾选完成"，勾选就调 `ack`。
     * 看起来合理，实际是**错的**：
     *
     * - `ack` 语义 = "确认已消费" → 服务端**删除队列条目**（契约 §5.3）；
     * - 按设计消费方是**桌面端**：桌面 `pull`（peek 不删）→ 写入任务墙 → 才 `ack`；
     * - 所以手机端一 `ack`，任务**在桌面收到之前就被删了** → 桌面永远收不到。
     *
     * 判据（web 参考实现 +《任务墙板块待办》§7）：
     * **手机端只有 `push`，`ack` 属桌面端。**
     *
     * 当时的"闭环测试"还把这个错误当通过标准验证了一遍（push → ack → 队列空），
     * 等于用测试给 bug 盖章。已更正。
     */
    suspend fun ack(taskIds: List<String>): ApiResult<AckResponse> {
        if (taskIds.isEmpty()) {
            return ApiResult.BusinessFail("缺少待确认任务")
        }
        return apiClient.post(
            "ack",
            mapOf("board" to BOARD, "taskIds" to taskIds.take(500)),
        ).map { obj -> Json.gson.fromJson(obj, AckResponse::class.java) }
    }

    private companion object {
        /** 契约 §5：必须显式 "taskwall"，否则「暂不支持的板块」 */
        const val BOARD = "taskwall"
    }
}

/** 把 JsonObject 解析结果包成 ApiResult.Ok；解析失败归为可重试的响应异常。 */
private inline fun <T> ApiResult<com.google.gson.JsonObject>.map(
    parse: (com.google.gson.JsonObject) -> T,
): ApiResult<T> = when (this) {
    is ApiResult.Ok -> try {
        ApiResult.Ok(parse(data))
    } catch (e: Exception) {
        ApiResult.TransportFail(ApiResult.TransportFail.Kind.BAD_RESPONSE, cause = e)
    }
    is ApiResult.BusinessFail -> this
    is ApiResult.TransportFail -> this
    ApiResult.Unauthorized -> ApiResult.Unauthorized
}
