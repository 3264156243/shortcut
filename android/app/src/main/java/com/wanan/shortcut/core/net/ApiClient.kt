package com.wanan.shortcut.core.net

import com.google.gson.JsonObject
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.IdentityProvider
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.SocketTimeoutException

/**
 * `api.php` 客户端 —— 契约 §1.2 的"业务失败也是 HTTP 200"这一侧。
 *
 * 本类的三件职责（都不该由板块承担）：
 *   1. **自动注入身份**：`bindId` + `mobileToken`，板块只管业务字段；
 *   2. **修正成败判断**：只看 `success` 字段，绝不用 HTTP 状态码（契约 §10.2 陷阱 #3）；
 *   3. **识别身份失效**：命中 `移动端绑定已失效，请重新绑定` 时通知 [IdentityProvider]。
 */
class ApiClient(
    private val identityProvider: IdentityProvider,
    private val errorMapper: ErrorMapper,
) {

    /**
     * 发起一次 api.php 调用。
     *
     * @param action 契约里的 action（如 `mobile.bind`、`push`）
     * @param params 业务字段；**不要**自己塞 bindId/mobileToken，本方法自动加
     * @param requireIdentity 是否要求已绑定（绑定类接口传 false）
     */
    suspend fun post(
        action: String,
        params: Map<String, Any?> = emptyMap(),
        requireIdentity: Boolean = true,
    ): ApiResult<JsonObject> = withContext(Dispatchers.IO) {
        val identity = identityProvider.current()

        if (requireIdentity && !identity.isBound) {
            // 未绑定就发鉴权请求没有意义，且服务端会走"遗留兜底"（契约 §1.3 第 4 条），
            // 新客户端不应依赖该路径。这里直接给出明确的未授权信号。
            return@withContext ApiResult.Unauthorized
        }

        val body = JsonObject().apply {
            addProperty("action", action)
            params.forEach { (k, v) -> putValue(this, k, v) }
            if (requireIdentity) {
                addProperty("bindId", identity.bindId)
                addProperty("mobileToken", identity.mobileToken)
            }
        }

        val request = Request.Builder()
            .url(Endpoints.API)
            .post(body.toString().toRequestBody(Json.JSON_UTF8))  // 显式 UTF-8
            .build()

        try {
            HttpEngine.api.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                val obj = Json.parseObject(raw)

                if (obj == null) {
                    // 服务端故障时可能返回 HTML 错误页 → 归为可重试的传输失败
                    return@withContext ApiResult.TransportFail(
                        kind = ApiResult.TransportFail.Kind.BAD_RESPONSE,
                        httpCode = response.code,
                    )
                }

                if (Json.isSuccess(obj)) {
                    return@withContext ApiResult.Ok(obj)
                }

                // 业务失败：HTTP 可能是 200，不能据此判断
                val message = Json.messageOf(obj)
                if (errorMapper.isTokenRejected(message)) {
                    identityProvider.onTokenRejected()
                    return@withContext ApiResult.Unauthorized
                }
                return@withContext ApiResult.BusinessFail(message, response.code)
            }
        } catch (e: SocketTimeoutException) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.TIMEOUT, cause = e)
        } catch (e: IOException) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        } catch (e: Exception) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.UNKNOWN, cause = e)
        }
    }
}
