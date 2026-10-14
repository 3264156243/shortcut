package com.wanan.shortcut.feature.linked.transfer

import com.wanan.shortcut.core.blob.BlobEngine
import com.wanan.shortcut.core.net.ApiGateway
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult

/**
 * 文件共享数据源（blob 能力，契约 §6.7）。
 *
 * ## 与 web 参考实现的能力对照
 *
 * `server/sync/web/transfer/index.html` 用到这些 action，本类逐一对齐：
 * `transfer.messages` / `transfer.sendText` / `transfer.delete` /
 * `transfer.fileInit` / `transfer.fileComplete`（经 [BlobEngine]）/
 * `transfer.share` / `transfer.shares` / `transfer.shareDelete` / `transfer.claim`，
 * 文件下载走 `file.php`。
 *
 * ## 一个必须照抄 web 的细节：共享文件时 `messageId` 要去掉 `msg_` 前缀
 *
 * web 写的是：
 * ```js
 * const messageId = (msg.id || '').replace(/^msg_/, '');
 * ```
 * 因为服务端那边是 `preg_replace('/[^a-f0-9]/', '', $messageId)` 之后
 * 再补回 `msg_` 前缀查找（`api.php` 的 `case 'transfer.share'`）——
 * 也就是说它只吃 **24 位 hex**。若把完整的 `msg_xxx` 发过去，
 * `preg_replace` 会把 `msg_` 里非 hex 的字符剥掉、得到长度不对的串，**共享会失败**。
 */
class TransferRepository(
    private val apiClient: ApiGateway,
    private val blobEngine: BlobEngine,
) {

    /** 消息列表（契约 §6.7）。web 每 3 秒轮询一次，本类只负责取数。 */
    suspend fun messages(): ApiResult<MessagesResponse> =
        apiClient.post("transfer.messages").map { obj ->
            Json.gson.fromJson(obj, MessagesResponse::class.java)
        }

    /** 发送文本（`text` 截 10000 字，契约 §6.7） */
    suspend fun sendText(text: String): ApiResult<SendTextResponse> =
        apiClient.post("transfer.sendText", mapOf("text" to text.take(10000))).map { obj ->
            Json.gson.fromJson(obj, SendTextResponse::class.java)
        }

    /**
     * 删除一条消息（契约 §6.7）。
     *
     * ⚠️ `deleted:false` 仍是 `success:true`（契约明确写了）。
     * 也就是说"没删到"不算错误，UI 不该弹错误提示。
     */
    suspend fun delete(messageId: String): ApiResult<DeleteResponse> =
        apiClient.post("transfer.delete", mapOf("messageId" to messageId)).map { obj ->
            Json.gson.fromJson(obj, DeleteResponse::class.java)
        }

    /** 我的共享列表（契约 §6.7） */
    suspend fun shares(): ApiResult<SharesResponse> =
        apiClient.post("transfer.shares").map { obj ->
            Json.gson.fromJson(obj, SharesResponse::class.java)
        }

    /**
     * 创建文本共享（契约 §6.7）。
     *
     * @param code 6 位接收密码；留空由服务端自动生成
     * @param hours 共享时长，服务端钳 0.5..24
     */
    suspend fun shareText(
        text: String,
        code: String = "",
        hours: Double = 1.0,
    ): ApiResult<ShareCreateResponse> =
        apiClient.post(
            "transfer.share",
            mapOf(
                "text" to text.take(10000),
                "code" to code,
                "hours" to hours,
            ),
        ).map { obj -> Json.gson.fromJson(obj, ShareCreateResponse::class.java) }

    /**
     * 把**已上传的文件消息**创建为共享（契约 §6.7 `transfer.share` + `messageId`）。
     *
     * @param messageId 消息 id。传完整 `msg_xxx` 或只传 24 位 hex 都可以，
     *        这里统一剥成 24 位 hex（见类注释：服务端只认 hex）。
     */
    suspend fun shareFile(
        messageId: String,
        code: String = "",
        hours: Double = 1.0,
    ): ApiResult<ShareCreateResponse> {
        val hexOnly = messageId.removePrefix("msg_")
        return apiClient.post(
            "transfer.share",
            mapOf(
                "messageId" to hexOnly,
                "code" to code,
                "hours" to hours,
            ),
        ).map { obj -> Json.gson.fromJson(obj, ShareCreateResponse::class.java) }
    }

    /** 删除共享（`id` 形如 `shr_<24hex>`，契约 §6.7） */
    suspend fun shareDelete(id: String): ApiResult<DeleteResponse> =
        apiClient.post("transfer.shareDelete", mapOf("id" to id)).map { obj ->
            Json.gson.fromJson(obj, DeleteResponse::class.java)
        }

    /**
     * 领取共享（**无需身份**，契约 §6.7）。
     *
     * 文件类会返回一次性的 `downloadToken`（900 秒、消费即废）。
     *
     * ⚠️ 本方法**不能**带身份 —— 领取可能是"别人把密码给你"的场景。
     * 因此 `requireIdentity = false`。若带着本机身份反而可能干扰（契约 §1.3 的判定顺序）。
     */
    suspend fun claim(code: String): ApiResult<ClaimResponse> =
        apiClient.post(
            "transfer.claim",
            mapOf("code" to code.trim().uppercase()),
            requireIdentity = false,
        ).map { obj -> Json.gson.fromJson(obj, ClaimResponse::class.java) }

    /** 暴露 BlobEngine 给 ViewModel（上传/下载） */
    val blobs: BlobEngine get() = blobEngine
}

/** JsonObject → 目标类型的便捷映射；解析失败归为可重试的响应异常。 */
internal inline fun <T> ApiResult<com.google.gson.JsonObject>.map(
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
