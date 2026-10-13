package com.wanan.shortcut.core.api

import com.google.gson.JsonObject
import com.wanan.shortcut.core.net.ApiGateway
import com.wanan.shortcut.core.result.ApiResult

/**
 * 测试用的空实现（放在 `core/api` 而不是 test 源集，因为它对**任何**消费者都无害，
 * 且能让测试与预览共用一份）。
 *
 * 用途：注册表这类纯逻辑的单元测试不需要真的发请求，但需要满足 `ApiGateway` 依赖。
 */
object NoopApiClient : ApiGateway {
    override suspend fun post(
        action: String,
        params: Map<String, Any?>,
        requireIdentity: Boolean,
    ): ApiResult<JsonObject> = ApiResult.TransportFail(
        ApiResult.TransportFail.Kind.NETWORK,
    )
}

/**
 * 可编程的假实现：按 action 返回预设结果。
 *
 * 有了它，板块的数据层（Repository / ViewModel）也能在 JVM 上测，
 * 不必连真实服务端 —— 这也是把 [ApiGateway] 抽出来的主要收益之一。
 */
class FakeApiClient(
    private val responses: Map<String, ApiResult<JsonObject>> = emptyMap(),
) : ApiGateway {

    /** 记录收到的调用，便于断言"请求形状对不对" */
    val calls = mutableListOf<Call>()

    data class Call(
        val action: String,
        val params: Map<String, Any?>,
        val requireIdentity: Boolean,
    )

    override suspend fun post(
        action: String,
        params: Map<String, Any?>,
        requireIdentity: Boolean,
    ): ApiResult<JsonObject> {
        calls += Call(action, params, requireIdentity)
        return responses[action] ?: ApiResult.TransportFail(
            ApiResult.TransportFail.Kind.NETWORK,
        )
    }
}
