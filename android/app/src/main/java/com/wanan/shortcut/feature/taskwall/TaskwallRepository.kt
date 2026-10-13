package com.wanan.shortcut.feature.taskwall

import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult

/**
 * 任务墙数据源（queue 能力，契约 §5）。
 *
 * ⚠️核心约束：`board` 字段在所有 queue 接口**必须显式为 `"taskwall"`**，
 * 否则服务端返回 `暂不支持的板块`（契约 §5 开头）。
 * 把它固化成常量并只在本类里使用，避免各调用点写错或漏写。
 */
class TaskwallRepository(private val apiClient: ApiClient) {

    /**
     * 下发任务（契约 §5.1）。
     *
     * 关于 `longText` / `reminderEnabled`：契约要求**严格 `=== true`** 才生效，
     * 因此这里传真正的 Kotlin `Boolean`，由 `core/net/putValue` 序列化成
     * JSON 原生 `true/false`（单测 `布尔字段必须序列化为真正的 JSON 布尔值` 已锁住）。
     *
     * 实测确认（2026-10-13）：`longText=true` 时 `details` 才被读取；
     * `reminderEnabled=true` 但 `reminderAt` 不可解析 → `提醒时间格式无效`。
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
        // 只在需要时带上可选字段：契约规定 details 仅当 longText===true 才读取，
        // 不带多余字段能让请求与网页端参考实现保持一致的形状。
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

    /** 拉取任务（**不消费**，可重复拉；契约 §5.2） */
    suspend fun pull(): ApiResult<PullResponse> =
        apiClient.post("pull", mapOf("board" to BOARD)).map { obj ->
            Json.gson.fromJson(obj, PullResponse::class.java)
        }

    /**
     * 确认消费（契约 §5.3）。
     *
     * 服务端只接受 `rmt_[a-f0-9]{24}` 形状的 id，且最多 500 个；
     * 空数组会返回 `缺少待确认任务`（实测确认）。
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

    /** 任务墙列表（契约 §5.4） */
    suspend fun boards(): ApiResult<BoardListResponse> =
        apiClient.post("board.list", mapOf("board" to BOARD)).map { obj ->
            Json.gson.fromJson(obj, BoardListResponse::class.java)
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
