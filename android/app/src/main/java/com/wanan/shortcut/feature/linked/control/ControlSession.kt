package com.wanan.shortcut.feature.linked.control

import com.google.gson.JsonObject
import com.wanan.shortcut.core.lan.LanClient
import com.wanan.shortcut.core.net.ApiGateway
import com.wanan.shortcut.core.realtime.ControlPaths
import com.wanan.shortcut.core.realtime.RelayClient
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 电脑控制的**会话状态**（通道选择 + 连接状态）—— 容器级单例。
 *
 * ## 为什么必须是单例，而不能放在 ViewModel 里
 *
 * 这是踩过的真实 bug（2026-10-14，用户反馈"显示连接了，实际控制时却显示未连接"）：
 *
 * `containerViewModel()` 底层是 Navigation Compose 的 `viewModel()`，
 * 它把 ViewModel 绑定到**最近的 `ViewModelStoreOwner`** ——
 * 而 Navigation Compose 里**每个目的地（destination）都是独立的 owner**。
 *
 * 于是：入口页 `module/control` 连上通道（通道保存在它的 ViewModel 里）→
 * 点进控制页 `module/control/sub/panel` → **这是一个新目的地** →
 * 拿到的是一个**全新的 ViewModel 实例**，里面的 `channel` 是 null → 显示"未连接"。
 *
 * ### 修法：把"会话"提到共享底座层
 *
 * 通道选择与连接状态**本来就不属于某个页面**，而属于"这一次控制会话"。
 * 把它放进容器单例后，无论页面被创建/销毁多少次，看到的都是同一条通道。
 *
 * 这也与既有设计一致：[RelayClient] 早就是容器单例（因为契约 §7.6 要求
 * 全应用唯一一条 WS）。当时只把"连接"提上去了，却把"通道选择"留在了页面里 ——
 * 修的是这个不对称。
 */
class ControlSession(
    private val scope: CoroutineScope,
    private val relay: RelayClient,
    private val lanClient: LanClient,
    private val apiClient: ApiGateway,
    private val bindIdProvider: () -> String,
) {

    private val _connection = MutableStateFlow(ConnectionState())
    val connection: StateFlow<ConnectionState> = _connection.asStateFlow()

    /** 已发指令数：并到会话里，页面重建后不会归零（否则用户会以为指令没发出去） */
    private val _sentCount = MutableStateFlow(0)
    val sentCount: StateFlow<Int> = _sentCount.asStateFlow()

    /**
     * 通道是否可用 —— **响应式状态**。
     *
     * ⚠️ 之所以做成 StateFlow 而不是让页面各自去读 `ready` 属性：
     * 页面（ViewModel）会在导航时被销毁重建，重建那一刻读到的快照可能是旧的。
     * 让所有页面**订阅同一个流**，通道在任何地方建立/断开，
     * 每个页面都会自动跟着变 —— 这正是"入口页显示已连接、控制页却显示未连接"
     * 那个 bug 的治本做法（之前两处各自读快照，必然可能不一致）。
     */
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    /** 当前通道（null = 未连接）。页面只读它，切换由本类负责。 */
    @Volatile var channel: ControlChannel? = null
        private set

    init {
        // 把中继状态映射成会话可见的"是否可用"
        scope.launch {
            relay.state.collect { rs ->
                _sentCount.value = rs.sentCount
                if (rs.lastError != null) {
                    _connection.value = _connection.value.copy(lastError = rs.lastError)
                }
                refreshReady()
            }
        }
    }

    /**
     * 重算可用性并广播。
     *
     * 通道变化（connectCloud/connectLan）与中继状态变化（auth-ok / 桌面离线）
     * 都要调它 —— 可用性是"通道类型 ∧ 中继状态"的合成结果，任一变化都要重算。
     */
    private fun refreshReady() {
        _ready.value = channel?.available == true
    }

    /** 当前是否可用（同步快照，供非响应式场景） */
    val isReady: Boolean get() = _ready.value

    /** 通道名（"云端"/"局域网"），未连接返回空串 */
    val channelLabel: String get() = channel?.label ?: ""

    fun clearError() {
        _connection.value = _connection.value.copy(lanError = null, lastError = null)
    }

    // ---------------- 云端 ----------------

    /**
     * 连云端：换票 → 建 WS → 切到云端通道。
     *
     * 契约 §1.4 / §7.6：**一条 WS 长连接只换一次票**（`control.ticket` 限流 60/分钟），
     * 所以换票交给 [RelayClient.connect] 在每次建连时做一次。
     */
    fun connectCloud() {
        val bindId = bindIdProvider()
        if (bindId.isBlank()) {
            _connection.value = _connection.value.copy(lastError = "请先绑定电脑")
            return
        }

        // 已经是云端通道且中继已连上 → 不重复建连（重复调用只更新 UI 状态）
        relay.setBindId(bindId)
        if (channel is CloudChannel && relay.state.value.connected) {
            _connection.value = _connection.value.copy(connecting = false, lastError = null)
            refreshReady()
            return
        }

        channel = CloudChannel(relay)
        refreshReady()
        _connection.value = _connection.value.copy(connecting = true, lastError = null)

        relay.connect {
            when (
                val r = apiClient.post(
                    "control.ticket",
                    mapOf("role" to "mobile", "bindId" to bindId),
                )
            ) {
                is ApiResult.Ok -> {
                    val ticket = r.data.str("ticket")
                    if (ticket.isBlank()) {
                        ApiResult.BusinessFail("换票失败：服务端未返回 ticket")
                    } else {
                        ApiResult.Ok(ticket)
                    }
                }
                is ApiResult.BusinessFail -> ApiResult.BusinessFail(r.message, r.httpCode)
                is ApiResult.TransportFail -> r
                ApiResult.Unauthorized -> ApiResult.Unauthorized
            }
        }

        _connection.value = _connection.value.copy(connecting = false)
    }

    // ---------------- 局域网 ----------------

    /**
     * 局域网一键直连（契约 §8.2）：经云端 WS 问 `/api/lan-entry` → 切到局域网通道。
     *
     * ⚠️ 契约 §8.5-2：**每次都要重新询问，不缓存 IP**。
     * ⚠️ 该接口需要云端 WS 在线（§8.2 末尾），所以先确保云端已连。
     */
    fun connectLan() {
        scope.launch {
            _connection.value = _connection.value.copy(
                lanBusy = true, lanError = null, lanNotice = null,
            )

            // 确保云端在（lan-entry 只在云端中继上暴露）
            if (!relay.state.value.connected || channel !is CloudChannel) {
                connectCloud()
                var waited = 0
                while (!relay.state.value.connected && waited < 6000) {
                    kotlinx.coroutines.delay(200)
                    waited += 200
                }
            }

            val res = relay.call(ControlPaths.LAN_ENTRY)
            if (!res.ok) {
                _connection.value = _connection.value.copy(
                    lanBusy = false,
                    lanError = when (res.status) {
                        503 -> "拿不到局域网入口：电脑端未开启「云端连接」，或电脑不在线"
                        else -> "拿不到局域网入口（${res.error ?: "未知原因"}）"
                    },
                )
                return@launch
            }

            val data = res.data
            val running = data.has("running") && !data.get("running").isJsonNull &&
                data.get("running").asBoolean
            val url = data.str("url")
            val token = data.str("token")

            if (!running || url.isBlank() || token.isBlank()) {
                // 与 web 的提示逐字对齐
                _connection.value = _connection.value.copy(
                    lanBusy = false,
                    lanError = "电脑端还没开启「局域网直连」：请在桌面 ShortCut「控制」板块" +
                        "点一下「局域网直连」，再回到这里点一次。",
                )
                return@launch
            }

            channel = LanChannel(lanClient, url, token)
            refreshReady()
            _connection.value = _connection.value.copy(
                lanBusy = false, lanActive = true, lanBaseUrl = url,
                lanNotice = "已直连 $url（局域网，延迟更低）",
            )
        }
    }

    /**
     * 手动填地址（web 的「备用：手动填地址」）。
     *
     * 契约 §8.3：默认 `authMode='pair'`，需先用 6 位绑定码换 token。
     * 安卓端已绑定过，所以流程是：探测地址可达 → 提示用「局域网直连」拿预授权令牌。
     */
    fun connectLanManual(rawHost: String) {
        val host = normalizeHost(rawHost)
        if (host == null) {
            _connection.value = _connection.value.copy(
                lanError = "地址格式不对，请按桌面端显示填写，如 192.168.1.5:9823",
            )
            return
        }

        scope.launch {
            val baseUrl = "http://$host"
            val cfg = lanClient.config(baseUrl)
            if (cfg !is ApiResult.Ok) {
                _connection.value = _connection.value.copy(
                    lanError = "连不上 $host（地址不对，或手机与电脑不在同一 Wi-Fi）",
                )
                return@launch
            }

            val authMode = cfg.data.str("authMode")
            if (authMode == "pair") {
                _connection.value = _connection.value.copy(
                    lanError = "该地址需要 6 位绑定码配对。建议改用「局域网直连」入口" +
                        "（它会自动带上预授权令牌，无需配对）。",
                )
            } else {
                _connection.value = _connection.value.copy(
                    lanError = "该地址的运行模式不支持手动连接（authMode=$authMode）。",
                )
            }
        }
    }

    /** 把 `192.168.1.5` / `http://…` 统一成 `host:port` */
    internal fun normalizeHost(raw: String): String? {
        var host = raw.trim()
        if (host.isEmpty()) return null
        host = host.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
        host = host.replace(Regex("/+.*$"), "")
        if (Regex("""^[\w.-]+:\d{2,5}$""").matches(host)) return host
        if (Regex("""^\d{1,3}(\.\d{1,3}){3}$""").matches(host)) return "$host:9823"
        return null
    }

    /** 执行一条指令（页面统一走这里，不直接碰通道） */
    suspend fun call(path: String, body: Map<String, Any?>): ControlResult {
        val ch = channel ?: return ControlResult.Fail(503, "还没有可用通道，请先连接电脑")
        return ch.call(path, body)
    }
}

/** 通道连接状态（入口页据此显示"正在连接/已直连/失败"）。 */
data class ConnectionState(
    /** 云端：正在换票/建连 */
    val connecting: Boolean = false,
    /** 局域网：是否已直连成功 */
    val lanActive: Boolean = false,
    /** 局域网基地址（仅用于显示） */
    val lanBaseUrl: String = "",
    /** 局域网：正在向桌面端询问入口 */
    val lanBusy: Boolean = false,
    /** 局域网相关提示（非错误） */
    val lanNotice: String? = null,
    /** 局域网相关错误 */
    val lanError: String? = null,
    /** 云端最近一次错误 */
    val lastError: String? = null,
)

// ---- JsonObject 安全读取 ----

private fun JsonObject.str(key: String): String =
    if (has(key) && !get(key).isJsonNull) runCatching { get(key).asString }.getOrDefault("") else ""
