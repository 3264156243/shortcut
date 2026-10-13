package com.wanan.shortcut.feature.taskwall

import com.google.gson.annotations.SerializedName

/**
 * 任务墙数据模型（契约 §5）。
 *
 * 字段名逐字对齐服务端，不做 camelCase 转换——契约里的字段名就是接口的一部分。
 */

/**
 * `pull` 返回的一条任务（契约 §5.2）。
 *
 * 注意 `reminderAt` 的特殊性（契约 §1.2）：
 * 它是**客户端原样透传**的字段，服务端不做任何格式化。
 * 网页端发的是 `2026-10-09T02:50:23.000Z`（ISO-8601 UTC），
 * 而其它时间字段（如 [createdAt]）是 `+08:00` 带偏移的 PHP `date('c')`。
 * 两者格式**不同**，解析时必须分别处理，不能共用一个格式器。
 */
data class TaskItem(
    @SerializedName("id") val id: String = "",
    @SerializedName("text") val text: String = "",
    @SerializedName("longText") val longText: Boolean = false,
    @SerializedName("details") val details: String = "",
    @SerializedName("reminderEnabled") val reminderEnabled: Boolean = false,
    @SerializedName("reminderAt") val reminderAt: String = "",
    @SerializedName("boardName") val boardName: String = "",
    /** ISO-8601 带 +08:00 偏移（PHP `date('c')`），**不是** unix 时间戳 */
    @SerializedName("createdAt") val createdAt: String = "",
)

/** `pull` 的响应 */
data class PullResponse(
    @SerializedName("tasks") val tasks: List<TaskItem> = emptyList(),
    @SerializedName("count") val count: Int = 0,
)

/** `push` 的响应（契约 §5.1） */
data class PushResponse(
    @SerializedName("taskId") val taskId: String = "",
    /**
     * 中继是否把唤醒送达了桌面端（桌面在线）。
     *
     * ⚠️ 契约 §5.1：**false 不代表失败**——任务已入队，桌面下次拉取会拿到。
     * UI 文案必须区分"已送达"与"已排队"，不能让用户以为发失败了。
     */
    @SerializedName("deliveredRealtime") val deliveredRealtime: Boolean = false,
    @SerializedName("desktopOnline") val desktopOnline: Boolean = false,
)

/** `board.list` 的响应（契约 §5.4） */
data class BoardListResponse(
    @SerializedName("boards") val boards: List<String> = emptyList(),
)

/** `ack` 的响应（契约 §5.3） */
data class AckResponse(
    @SerializedName("removed") val removed: Int = 0,
)
