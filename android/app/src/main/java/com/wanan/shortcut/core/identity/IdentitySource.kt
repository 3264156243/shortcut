package com.wanan.shortcut.core.identity

/**
 * 网络层对身份的最小依赖（依赖倒置）。
 *
 * ## 为什么要有这个接口
 *
 * [IdentityProvider] 依赖 `IdentityStore` → Android `Context`，
 * 于是任何用到它的东西都**无法在 JVM 单元测试里构造**。
 * 结果就是：`ApiClient`（真正发请求的那段代码）**从来没被任何测试执行过** ——
 * "编译通过 + 逻辑单测绿"并不等于"这条链路能跑"。
 *
 * 抽出这个接口后，测试可以塞一个内存实现，从而让
 * **真实的 OkHttp 请求 → 服务端 → 响应解析** 这段路径可被真正执行。
 */
interface IdentitySource {

    /** 当前身份快照（同步读取，供网络层拼请求体）。 */
    fun current(): Identity

    /**
     * 服务端判定令牌失效时调用（清本地身份 + 通知导航层）。
     *
     * 幂等：本地已清过则不应重复通知（契约 §1.3 的失效文案）。
     */
    suspend fun onTokenRejected()
}
