package com.wanan.shortcut.feature.linked.transfer

import com.google.gson.annotations.SerializedName

/**
 * 文件共享的数据模型（契约 §6.7）。
 *
 * 字段名逐字对齐服务端，不做 camelCase 转换。
 */

/**
 * 消息列表里的一条（契约 §6.7 `transfer.messages`）。
 *
 * 用**单一数据类 + `type` 判别**而不是密封类层次，因为服务端就是扁平结构
 * （文本消息没有 `fileId`，文件消息没有 `text`），强行拆类反而要在解析处做映射。
 * 便利访问器 [isFile] / [displayTitle] 负责把差异收敛在一处。
 */
data class TransferMessage(
    @SerializedName("id") val id: String = "",
    /** `"text"` 或 `"file"` */
    @SerializedName("type") val type: String = "text",
    @SerializedName("text") val text: String = "",
    @SerializedName("fileId") val fileId: String = "",
    @SerializedName("name") val name: String = "",
    @SerializedName("size") val size: Long = 0L,
    @SerializedName("mime") val mime: String = "",
    /** `"mobile"` 或 `"desktop"` —— 决定气泡左右（web 用 `sender === 'mobile'` 判断 `mine`） */
    @SerializedName("sender") val sender: String = "",
    @SerializedName("favorite") val favorite: Boolean = false,
    @SerializedName("createdAt") val createdAt: String = "",
) {
    val isFile: Boolean get() = type == "file"

    /** 是否本机发的（web 的 `mine`） */
    val isMine: Boolean get() = sender == "mobile"

    /** 列表里显示的主标题 */
    val displayTitle: String
        get() = if (isFile) name.ifBlank { "文件" } else text
}

/** `transfer.messages` 响应 */
data class MessagesResponse(
    @SerializedName("messages") val messages: List<TransferMessage> = emptyList(),
    @SerializedName("side") val side: String = "",
)

/** `transfer.sendText` 响应 */
data class SendTextResponse(
    @SerializedName("message") val message: TransferMessage? = null,
)

/** `transfer.fileComplete` 响应 */
data class FileCompleteResponse(
    @SerializedName("message") val message: TransferMessage? = null,
    @SerializedName("sha256") val sha256: String = "",
)

/**
 * 一条共享（契约 §6.7 `transfer.shares`）。
 *
 * `type` 与消息一样是 `text`/`file`；`code` 是 6 位接收密码。
 */
data class ShareItem(
    @SerializedName("id") val id: String = "",
    @SerializedName("code") val code: String = "",
    @SerializedName("expiresAt") val expiresAt: String = "",
    @SerializedName("type") val type: String = "text",
    @SerializedName("name") val name: String = "",
    @SerializedName("size") val size: Long = 0L,
    @SerializedName("text") val text: String = "",
    @SerializedName("createdAt") val createdAt: String = "",
) {
    val isFile: Boolean get() = type == "file"

    val displayTitle: String
        get() = if (isFile) name.ifBlank { "文件" } else text
}

/** `transfer.shares` 响应 */
data class SharesResponse(
    @SerializedName("shares") val shares: List<ShareItem> = emptyList(),
)

/** `transfer.share` 响应 */
data class ShareCreateResponse(
    @SerializedName("code") val code: String = "",
    @SerializedName("expiresAt") val expiresAt: String = "",
)

/**
 * `transfer.claim` 响应（契约 §6.7）。
 *
 * ⚠️ 该接口**无需身份**（可以给别人的手机领取）。
 * 文件类共享会额外签发一次性的 [downloadToken]；文本类则为空串。
 */
data class ClaimResponse(
    @SerializedName("message") val message: TransferMessage? = null,
    @SerializedName("expiresAt") val expiresAt: String = "",
    @SerializedName("downloadToken") val downloadToken: String = "",
)

/** `transfer.delete` 响应 */
data class DeleteResponse(
    @SerializedName("deleted") val deleted: Boolean = false,
)

/** `transfer.fileInit` 响应里的文件对象（契约 §6.2） */
data class InitFile(
    @SerializedName("id") val id: String = "",
    @SerializedName("name") val name: String = "",
    @SerializedName("size") val size: Long = 0L,
    @SerializedName("mime") val mime: String = "",
    @SerializedName("chunkSize") val chunkSize: Int = 0,
    @SerializedName("chunkCount") val chunkCount: Int = 0,
    @SerializedName("uploaded") val uploaded: List<Int> = emptyList(),
    @SerializedName("sender") val sender: String = "",
    @SerializedName("createdAt") val createdAt: String = "",
)
