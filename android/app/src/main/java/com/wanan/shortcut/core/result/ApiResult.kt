package com.wanan.shortcut.core.result

/**
 * 统一的调用结果。
 *
 * 存在的唯一理由：契约 §1.2 里 `api.php` 与 `file.php` 的失败语义**相反**——
 *   - api.php：业务失败也是 **HTTP 200**，必须读 `success` 字段；
 *   - file.php：反过来用**真实 HTTP 状态码**，同时返回 `success:false`。
 *
 * 如果让每个板块自己判断 `success` 或状态码，就一定有人写错（契约 §10.2 陷阱 #3 就是这么来的）。
 * 所以由 core 层把两者归一化成下面三个分支，调用方**只需要 match 这个类型**，永远不碰原始状态码。
 */
sealed interface ApiResult<out T> {

    /** 业务成功（api.php 的 success:true / file.php 的 2xx）。 */
    data class Ok<out T>(val data: T) : ApiResult<T>

    /**
     * 传输层失败：连不上、超时、DNS 失败、非 JSON 响应等。
     * 这类失败**可重试**。
     */
    data class TransportFail(
        val kind: Kind,
        val httpCode: Int? = null,
        val cause: Throwable? = null,
    ) : ApiResult<Nothing> {
        enum class Kind { NETWORK, TIMEOUT, BAD_RESPONSE, UNKNOWN }
    }

    /**
     * 业务层失败：请求到达了服务端，服务端明确说"不行"。
     *
     * [message] 是服务端原文（字符串契约，契约 §1.3），
     * 由 `core/error/ErrorMapper` 翻译成动作，不要在各处硬编码比较。
     */
    data class BusinessFail(
        val message: String,
        val httpCode: Int? = null,
    ) : ApiResult<Nothing>

    /** 身份失效的统一出口（契约 §1.3 的 `移动端绑定已失效，请重新绑定`） */
    data object Unauthorized : ApiResult<Nothing>
}

/** 语法糖：成功时取数据，否则给 null。 */
fun <T> ApiResult<T>.getOrNull(): T? = (this as? ApiResult.Ok)?.data

/** 语法糖：是否有值。 */
val ApiResult<*>.isOk: Boolean get() = this is ApiResult.Ok

/**
 * 把结果折叠成一个值。板块层做 UI 状态映射时用这个，避免到处写 when。
 */
inline fun <T, R> ApiResult<T>.fold(
    onOk: (T) -> R,
    onFail: (message: String, retryable: Boolean) -> R,
): R = when (this) {
    is ApiResult.Ok -> onOk(data)
    is ApiResult.BusinessFail -> onFail(message, false)
    is ApiResult.TransportFail -> onFail(kind.name, true)
    ApiResult.Unauthorized -> onFail("UNAUTHORIZED", false)
}
