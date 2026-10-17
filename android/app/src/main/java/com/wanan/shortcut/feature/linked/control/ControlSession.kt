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
    /**
     * 局域网直连（**不依赖云端**）—— 用户填地址 + 配对码。
     *
     * ## 为什么需要这条路径（这是当前的主力路径）
     *
     * 契约 §8.2 推荐的"一键直连"要**经云端 WS 问 `/api/lan-entry`**，
     * 那要求云端通道可用。若云端暂不做/不通，局域网就连入口都拿不到。
     *
     * 但电脑端的局域网服务本身有**无需鉴权**的接口：
     *   - `GET /api/status` → 返回 `{authMode, pairCode, urls, injector}`
     *   - `POST /api/pair`  → 用 `pairCode` 换 `token`（契约 §8.4）
     *
     * 所以可以走一条完全独立于云端的路：
     * ```
     * 探测地址 → 读 status 拿到 authMode 与候选地址 → pair 换 token → 连接成功
     * ```
     *
     * @param rawHost 用户填的地址（`192.168.1.5` 或 `192.168.1.5:9823`）
     * @param pairCode 电脑端「局域网直连」状态页显示的 6 位配对码；留空则只探测不配对
     */
    fun connectLanDirect(rawHost: String, pairCode: String = "") {
        val host = normalizeHost(rawHost)
        if (host == null) {
            _connection.value = _connection.value.copy(
                lanError = "地址格式不对，请按电脑端显示的填写，如 192.168.1.5:9823",
            )
            return
        }

        scope.launch {
            _connection.value = _connection.value.copy(
                lanBusy = true, lanError = null, lanNotice = "正在连接 $host …",
            )

            // ① 探测：优先用 /api/status（一次拿到 authMode + 候选地址 + 配对码）
            val statusRes = lanClient.status("http://$host")
            val statusData = when (statusRes) {
                is ApiResult.Ok -> statusRes.data
                else -> null
            }

            if (statusData == null) {
                // 退一步用更轻的 /api/config 再确认一次，以便区分"地址不通"与"不是这个服务"
                val cfg = lanClient.config("http://$host")
                _connection.value = _connection.value.copy(
                    lanBusy = false,
                    lanNotice = null,
                    lanError = if (cfg is ApiResult.Ok) {
                        "这个地址有服务在跑，但读不到状态（可能不是 ShortCut 的控制服务）"
                    } else {
                        "连不上 $host。请确认：\n" +
                            "· 电脑端 ShortCut「控制」板块已点开「局域网直连」\n" +
                            "· 手机与电脑连的是同一个 Wi-Fi\n" +
                            "· 地址填的是电脑端状态页显示的那个（如 192.168.1.5:9823）\n" +
                            "· 电脑防火墙没有拦住 9823 端口"
                    },
                )
                return@launch
            }

            val authMode = statusData.str("authMode")

            // ② 若服务端要求配对，用配对码换 token
            if (authMode == "pair") {
                // ★ 配对码可以**自动读取**：/api/status 无需鉴权就返回 pairCode。
                // 所以用户不必手输——只填地址即可连上，少一个出错环节。
                // （若用户明确填了码，以用户填的为准，便于排查"码变了"的情况）
                val serverCode = statusData.str("pairCode")
                val effectiveCode = pairCode.trim().uppercase().ifBlank { serverCode }

                if (effectiveCode.isBlank()) {
                    _connection.value = _connection.value.copy(
                        lanBusy = false,
                        lanNotice = null,
                        lanError = "这台电脑需要配对码，但没能从它那里读到。" +
                            "请在电脑端「局域网直连」状态页查看 6 位配对码后填入。",
                    )
                    return@launch
                }

                when (val paired = lanClient.pair("http://$host", effectiveCode)) {
                    is ApiResult.Ok -> {
                        channel = LanChannel(lanClient, "http://$host", paired.data)
                        refreshReady()
                        _connection.value = _connection.value.copy(
                            lanBusy = false, lanActive = true, lanBaseUrl = "http://$host",
                            lanNotice = "已直连 $host（局域网，不经过云端）",
                        )
                    }
                    is ApiResult.BusinessFail -> {
                        _connection.value = _connection.value.copy(
                            lanBusy = false, lanNotice = null,
                            lanError = "配对码不对（电脑端回：${paired.message}）。" +
                                (if (serverCode.isNotBlank()) {
                                    "电脑端当前显示的配对码是 $serverCode，" +
                                        "若你填的与它不同，请以电脑端显示的为准。"
                                } else {
                                    "请在电脑端「局域网直连」状态页核对 6 位配对码。"
                                }),
                        )
                    }
                    is ApiResult.TransportFail -> {
                        _connection.value = _connection.value.copy(
                            lanBusy = false, lanNotice = null,
                            lanError = "配对请求没发出去，请检查网络后重试。",
                        )
                    }
                    ApiResult.Unauthorized -> {
                        _connection.value = _connection.value.copy(
                            lanBusy = false, lanNotice = null,
                            lanError = "配对码不对，请在电脑端状态页核对。",
                        )
                    }
                }
                return@launch
            }

            // ③ authMode 不是 pair（例如 none）：直接连，不需要令牌
            channel = LanChannel(lanClient, "http://$host", token = "")
            refreshReady()
            _connection.value = _connection.value.copy(
                lanBusy = false, lanActive = true, lanBaseUrl = "http://$host",
                lanNotice = "已直连 $host（该电脑无需配对码）",
            )
        }
    }

    /**
     * 一键直连（**经云端**问地址）—— 契约 §8.2 的推荐路径。
     *
     * ⚠️ 依赖云端 WS。若云端不可用，请改用 [connectLanDirect]（用户填地址 + 配对码）。
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

            if (!relay.state.value.connected) {
                _connection.value = _connection.value.copy(
                    lanBusy = false,
                    lanError = "云端通道没连上，拿不到局域网入口。" +
                        "局域网直连需要先经云端问电脑端要地址（契约 §8.2）。" +
                        "请先确保「云端连接」可用。",
                )
                return@launch
            }

            val res = relay.call(ControlPaths.LAN_ENTRY)
            if (!res.ok) {
                _connection.value = _connection.value.copy(
                    lanBusy = false,
                    lanError = when (res.status) {
                        503 -> "拿不到局域网入口：电脑端未开启「云端连接」，或电脑不在线"
                        504 -> "电脑端没有响应（超时），请确认桌面 ShortCut 正在运行"
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

            if (!running || token.isBlank()) {
                // 与 web 的提示逐字对齐
                _connection.value = _connection.value.copy(
                    lanBusy = false,
                    lanError = "电脑端还没开启「局域网直连」：请在桌面 ShortCut「控制」板块" +
                        "点一下「局域网直连」，再回到这里点一次。",
                )
                return@launch
            }

            // ★ 逐个候选地址探测，只连真正可达的那个
            //
            // 为什么必须探测：桌面端用 UdpSocket 探测"默认出口网卡"生成地址，
            // 装了 VMware/VirtualBox/Docker 的机器很容易选中虚拟网卡，
            // 给出的 IP 手机连不上（而 web 端是浏览器直接跳转，失败就白屏）。
            val candidates = buildList {
                if (url.isNotBlank()) add(url)
                addAll(data.stringList("urls"))
            }

            _connection.value = _connection.value.copy(
                lanNotice = "正在探测电脑的局域网地址…",
            )

            val hit = lanClient.probeFirstReachable(candidates)
            if (hit == null) {
                val tried = candidates.filter { it.isNotBlank() }.joinToString("、")
                _connection.value = _connection.value.copy(
                    lanBusy = false,
                    lanNotice = null,
                    lanError = buildString {
                        append("连不上电脑的局域网地址")
                        if (tried.isNotBlank()) append("（试过：$tried）")
                        append("。常见原因：\n")
                        append("· 手机与电脑不在同一 Wi-Fi（或电脑走网线但不同网段）\n")
                        append("· 路由器开了「AP 隔离」，同网段设备也互不可见\n")
                        append("· 电脑防火墙拦住了 9823 端口\n")
                        append("· 电脑装了 VMware/VirtualBox/Docker，桌面端取到的地址是虚拟网卡的\n")
                        append("可以先用「云端连接」——任何网络都能用。")
                    },
                )
                return@launch
            }

            channel = LanChannel(lanClient, hit.baseUrl, token)
            refreshReady()
            _connection.value = _connection.value.copy(
                lanBusy = false, lanActive = true, lanBaseUrl = hit.baseUrl,
                lanNotice = if (hit.isControlService) {
                    "已直连 ${hit.baseUrl}（局域网，延迟更低）"
                } else {
                    "已连上 ${hit.baseUrl}，但它可能不是 ShortCut 的控制服务"
                },
            )
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

    /**
     * 执行一条指令（页面统一走这里，不直接碰通道）。
     *
     * ## 为什么在这里计数
     *
     * 早先 `sentCount` 只在**云端通道**里由 `relay.state` 递增，
     * 局域网通道完全不更新它 —— 于是局域网模式下界面永远显示"已发 0 条指令"，
     * 用户无法判断"到底有没有发出去"。这是一个真实的诊断盲区
     * （用户反馈"打字没同步、任何提示没有"，而这个数字本该是最直接的线索）。
     *
     * 现在改成在**通道抽象层**统一计数：不论走云端还是局域网都算。
     */
    suspend fun call(path: String, body: Map<String, Any?>): ControlResult {
        val ch = channel ?: return ControlResult.Fail(503, "还没有可用通道，请先连接电脑")
        val result = ch.call(path, body)
        if (result is ControlResult.Ok) {
            _sentCount.value = _sentCount.value + 1
        }
        return result
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

/**
 * 读一个字符串数组（桌面端 `urls` 是候选地址列表）。
 *
 * 容错：字段可能是数组、也可能是单个字符串（老版本服务端）；
 * 也跳过非字符串元素，避免一个脏数据让整个候选列表为空。
 */
private fun JsonObject.stringList(key: String): List<String> {
    if (!has(key) || get(key).isJsonNull) return emptyList()
    val el = get(key)

    if (el.isJsonArray) {
        return el.asJsonArray.mapNotNull { item ->
            runCatching { if (item.isJsonNull) null else item.asString }.getOrNull()
        }
    }
    if (el.isJsonPrimitive) {
        return runCatching { listOf(el.asString) }.getOrDefault(emptyList())
    }
    return emptyList()
}
