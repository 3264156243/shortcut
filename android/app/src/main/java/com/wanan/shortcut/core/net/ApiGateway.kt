package com.wanan.shortcut.core.net

import com.google.gson.JsonObject
import com.wanan.shortcut.core.result.ApiResult

/**
 * api.php 的调用契约（依赖倒置）。
 *
 * 为什么要抽这一层接口：[com.wanan.shortcut.core.net.ApiClient] 依赖
 * `IdentityProvider` → `IdentityStore` → Android `Context`，
 * 于是任何用到它的东西（如 `ModuleRegistry`）都**无法在 JVM 单元测试里构造**。
 *
 * 抽出接口后：
 *   - 框架层依赖这个接口，不依赖具体 HTTP 实现 → 注册表逻辑可以纯 JVM 测试
 *   - 将来换网络库（Ktor 等）只改实现，框架与板块不受影响
 */
interface ApiGateway {
    /**
     * 发起一次 api.php 调用。
     *
     * @param action 契约里的 action（如 `mobile.bind`、`push`）
     * @param params 业务字段；**不要**自己塞 bindId/mobileToken，实现会自动加
     * @param requireIdentity 是否要求已绑定（绑定类接口传 false）
     */
    suspend fun post(
        action: String,
        params: Map<String, Any?> = emptyMap(),
        requireIdentity: Boolean = true,
    ): ApiResult<JsonObject>
}
