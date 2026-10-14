package com.wanan.shortcut.feature.linked.taskwall

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

    /**
     * 桌面端**最后一次上报墙名**的时间（ISO-8601）。
     *
     * ⚠️ 该字段**不在仓库任何分支里**，但**线上服务端实际会返回**
     * （2026-10-14 实测：`{"success":true,"boards":[],"boardsUpdatedAt":""}`）。
     * 说明线上部署的 `api.php` 比仓库新。它是**新增字段**，向后兼容，
     * 老客户端忽略它即可（Gson 默认忽略未知字段），所以不影响契约稳定性。
     *
     * 用途：诊断《任务墙板块待办》T1 那个"手机端又只剩默认任务墙"的问题 ——
     *   - `boards` 为空 **且** `boardsUpdatedAt` 也为空 → 桌面端**从没上报过**墙名；
     *   - `boards` 为空但 `boardsUpdatedAt` 有值 → 上报过，但内容为空/被清掉了。
     * 两种情况的对策不同，有了这个字段就能给出准确提示，而不是让用户猜。
     */
    @SerializedName("boardsUpdatedAt") val boardsUpdatedAt: String = "",
)

/**
 * `ack` 的响应（契约 §5.3）。
 *
 * ⚠️ **手机端不要用它**。见 [TaskwallRepository.ack] 的说明：
 * `ack` 是**桌面端**的职责，手机端调用会把任务从云端队列删除，
 * 导致桌面端永远收不到这条任务。
 */
data class AckResponse(
    @SerializedName("removed") val removed: Int = 0,
)
