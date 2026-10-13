package com.wanan.shortcut.core.identity

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * 全局身份持有者——**唯一的身份真相**。
 *
 * 为什么必须收口到一处：
 *   1. 每个请求都要带 `bindId` + `mobileToken`（契约 §1.3），散落实现必然有遗漏；
 *   2. 令牌失效时要"清除本地身份 + 跳绑定页"，且**只能触发一次**（否则多个板块同时
 *      收到失效响应，会连续弹多次绑定页）；
 *   3. 契约 §1.3 明确"出示了凭证但没匹配上 → 直接拒绝，绝不降级"，
 *      所以身份状态必须是强一致的，不能各模块各自缓存。
 *
 * 线程安全：用 [Mutex] 串行化读写，因为绑定/解绑可能在多个协程里并发触发。
 */
class IdentityProvider(
    private val store: IdentityStore,
    private val tokenBox: TokenBox,
) : IdentitySource {

    private val _state = MutableStateFlow(EmptyIdentity)
    /** 供 UI 观察：未绑定 → 显示绑定页；已绑定 → 显示首页。 */
    val state: StateFlow<Identity> = _state.asStateFlow()

    private val mutex = Mutex()

    /** 需要在身份失效时被通知一次的回调（由导航层注册，用于跳绑定页）。 */
    private var onUnauthorized: (() -> Unit)? = null

    fun setUnauthorizedHandler(handler: () -> Unit) {
        onUnauthorized = handler
    }

    /**
     * 从持久化恢复身份。App 启动时调用一次。
     *
     * deviceKey 顺带在此确保存在（惰性初始化），这样后续 [current] 一定拿得到。
     */
    suspend fun restore(): Identity = mutex.withLock {
        val persisted = store.read()
        val deviceKey = persisted.deviceKey.ifBlank { store.deviceKey() }
        val token = tokenBox.readToken()

        val identity = Identity(
            bindId = persisted.bindId,
            mobileToken = token,
            deviceKey = deviceKey,
            deviceId = persisted.deviceId,
            deviceName = persisted.deviceName,
        )
        _state.value = identity
        identity
    }

    /** 绑定成功后写入（`mobile.bind` 的返回，契约 §2.6）。 */
    suspend fun saveBinding(
        bindId: String,
        mobileToken: String,
        deviceId: String,
        deviceName: String,
    ): Identity = mutex.withLock {
        val deviceKey = _state.value.deviceKey.ifBlank { store.deviceKey() }
        tokenBox.writeToken(mobileToken)
        store.saveBinding(bindId = bindId, deviceId = deviceId, deviceName = deviceName)

        val identity = Identity(
            bindId = bindId,
            mobileToken = mobileToken,
            deviceKey = deviceKey,
            deviceId = deviceId,
            deviceName = deviceName,
        )
        _state.value = identity
        identity
    }

    suspend fun updateDeviceName(name: String) = mutex.withLock {
        store.updateDeviceName(name)
        _state.value = _state.value.copy(deviceName = name)
    }

    /** 主动解除绑定（设置页）。保留 deviceKey，理由见 [IdentityStore.clearBinding]。 */
    suspend fun clear() = mutex.withLock {
        tokenBox.clear()
        store.clearBinding()
        val deviceKey = _state.value.deviceKey.ifBlank { store.deviceKey() }
        _state.value = EmptyIdentity.copy(deviceKey = deviceKey)
    }

    /**
     * 服务端告知身份失效时调用（`移动端绑定已失效，请重新绑定`，契约 §1.3）。
     *
     * 幂等：本地已经清过就直接返回，保证 [onUnauthorized] 只触发一次。
     */
    override suspend fun onTokenRejected() {
        val wasBound = _state.value.isBound
        clear()
        if (wasBound) onUnauthorized?.invoke()
    }

    /** 当前快照（非挂起，供网络层同步拼接请求体用）。 */
    override fun current(): Identity = _state.value
}
