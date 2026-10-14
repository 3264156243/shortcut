package com.wanan.shortcut.core.realtime

import com.wanan.shortcut.core.net.Endpoints
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * 实时通道客户端（契约 §7）—— **全应用唯一的一条 WebSocket**。
 *
 * ## 为什么必须是单例（这是硬约束，不是设计偏好）
 *
 * 契约 §7.6：**同一 `bindId` 最多 3 条连接**（1 桌面 + 2 手机），
 * 超过会直接被中继踢掉（`auth-fail: too many connections`）。
 * 所以"电脑控制"与将来任何实时板块**必须共用同一条连接**，
 * 这也正是框架设计 §5 把 realtime 列为"共享能力底座"的原因。
 *
 * ## 逐字对齐协议（契约 §7.3 / §7.6）
 *
 * | 项 | 值 | 出处 |
 * |---|---|---|
 * | 首帧 | `{auth:{role,bindId,ticket}}`，**连接后第一帧必须是它** | §7.1 |
 * | 协议层心跳 | 中继每 **30 秒**发 WS `ping`，客户端必须回 `pong` | §7.6 |
 * | 应用层心跳 | 建议 **25 秒**发 `{t:'ping'}` | §7.6 |
 * | 半死检测 | **60 秒**无任何消息 → 主动重连 | §7.6 |
 * | 重连间隔 | **3 秒** | §7.6 |
 * | 指令超时 | **8 秒** → 回 `status:504` | §7.6 |
 * | 单帧上限 | 64 KiB（超出中继直接丢弃） | §7.6 |
 *
 * ## `api-res` 是房间广播（契约 §7.3，最容易踩）
 *
 * 桌面端的回执会发给该 `bindId` 房间内**所有**手机，
 * 所以必须**用自己的 `id` 过滤**，且按 **String 归一化**比较
 * （中继回包时未做类型强转，`2` 与 `"2"` 都可能出现）。
 */
class RelayClient(
    private val scope: CoroutineScope,
    private val client: OkHttpClient = com.wanan.shortcut.core.net.HttpEngine.relay,
) {

    /** 连接状态（UI 据此显示"已连接桌面 / 桌面离线 / 连接中"） */
    data class State(
        val connected: Boolean = false,
        /** 中继鉴权是否通过（通过后桌面可能仍离线） */
        val authed: Boolean = false,
        /** 桌面端是否在线（`auth-ok.desktopOnline` 或 `desktop-status`） */
        val desktopOnline: Boolean = false,
        /** 已发出的指令数（web 用它做现场诊断：`已连接桌面·已发N`） */
        val sentCount: Int = 0,
        /** 最近一次错误（供 UI 提示） */
        val lastError: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    /** 收到的中继消息（供板块订阅；框架也会广播给注册表） */
    private val _messages = MutableSharedFlow<RelayMessage>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val messages: SharedFlow<RelayMessage> = _messages.asSharedFlow()

    private var webSocket: WebSocket? = null
    private var connectJob: Job? = null
    private var heartbeatJob: Job? = null

    /** 等待回执的指令：id → 回调 */
    private val pending = ConcurrentHashMap<String, (RelayMessage.ApiRes) -> Unit>()
    private val seq = AtomicInteger(0)

    @Volatile private var lastAliveAt: Long = 0L

    /**
     * 开始连接。
     *
     * @param ticketProvider 每次（重）连都要换新票 —— 契约 §3.3：ticket 只有 **600 秒**有效期，
     *        且契约 §1.4 明确"不要每条指令都换票"（60 次/分钟限流），
     *        所以策略是"**每次建连换一次**"。
     */
    fun connect(ticketProvider: suspend () -> ApiResult<String>) {
        if (connectJob?.isActive == true) return
        connectJob = scope.launch { connectLoop(ticketProvider) }
    }

    /** 主动断开（例如解绑、退出前） */
    fun disconnect() {
        heartbeatJob?.cancel()
        connectJob?.cancel()
        connectJob = null
        pending.values.forEach { it(timeoutResponse()) }
        pending.clear()
        webSocket?.close(1000, "client close")
        webSocket = null
        _state.value = State()
    }

    private suspend fun connectLoop(ticketProvider: suspend () -> ApiResult<String>) {
        while (true) {
            val ticket = when (val r = ticketProvider()) {
                is ApiResult.Ok -> r.data
                is ApiResult.BusinessFail -> {
                    _state.value = _state.value.copy(
                        connected = false, authed = false, lastError = r.message,
                    )
                    delay(RECONNECT_MS)
                    continue
                }
                is ApiResult.TransportFail -> {
                    _state.value = _state.value.copy(
                        connected = false, authed = false, lastError = "网络不可用",
                    )
                    delay(RECONNECT_MS)
                    continue
                }
                ApiResult.Unauthorized -> {
                    _state.value = _state.value.copy(
                        connected = false, authed = false, lastError = "连接已失效",
                    )
                    return   // 身份失效：不再重试，等用户重新绑定
                }
            }

            openAndAwait(ticket)
            // 走到这里说明连接已断开 → 3 秒后重连
            delay(RECONNECT_MS)
        }
    }

    private suspend fun openAndAwait(ticket: String) {
        val request = Request.Builder().url(Endpoints.RELAY_WS).build()

        kotlinx.coroutines.suspendCancellableCoroutine<Unit> { cont ->
            val listener = object : WebSocketListener() {

                override fun onOpen(ws: WebSocket, response: Response) {
                    lastAliveAt = System.currentTimeMillis()
                    _state.value = _state.value.copy(connected = true, lastError = null)
                    // 首帧必须是 auth（契约 §7.1）
                    ws.send(Json.gson.toJson(mapOf("auth" to mapOf(
                        "role" to "mobile",
                        "bindId" to currentBindId,
                        "ticket" to ticket,
                    ))))
                    startHeartbeat(ws)
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    lastAliveAt = System.currentTimeMillis()
                    handleIncoming(ws, text)
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    heartbeatJob?.cancel()
                    _state.value = _state.value.copy(
                        connected = false, desktopOnline = false,
                        lastError = t.message ?: "实时通道连接失败",
                    )
                    failAllPending("连接已断开")
                    if (cont.isActive) cont.resumeWith(Result.success(Unit))
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    heartbeatJob?.cancel()
                    _state.value = _state.value.copy(connected = false, desktopOnline = false)
                    failAllPending("连接已关闭")
                    if (cont.isActive) cont.resumeWith(Result.success(Unit))
                }
            }

            webSocket = client.newWebSocket(request, listener)
        }
    }

    /**
     * 应用层心跳 + 半死检测（契约 §7.6）。
     *
     * - 每 25 秒发 `{t:'ping'}`（中继回 `{t:'pong'}`）；
     * - 超过 60 秒**没收到任何消息** → 认为连接半死，主动关掉触发重连。
     *
     * ⚠️ 协议层的 WS `ping` 由 OkHttp/系统 TCP 栈自动回 `pong`
     * （服务端发的是 WebSocket 控制帧，不是文本帧），这里不需要手写。
     */
    private fun startHeartbeat(ws: WebSocket) {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (true) {
                delay(PING_INTERVAL_MS)
                val now = System.currentTimeMillis()
                if (now - lastAliveAt > ALIVE_TIMEOUT_MS) {
                    // 半死连接：不主动关会一直卡着，表现为"点了没反应"
                    ws.close(4000, "half-dead")
                    return@launch
                }
                ws.send("""{"t":"ping"}""")
            }
        }
    }

    private fun handleIncoming(ws: WebSocket, text: String) {
        val obj = runCatching { Json.gson.fromJson(text, com.google.gson.JsonObject::class.java) }
            .getOrNull() ?: return
        val t = if (obj.has("t") && !obj.get("t").isJsonNull) obj.get("t").asString else ""

        when (t) {
            "auth-ok" -> {
                val online = if (obj.has("desktopOnline") && !obj.get("desktopOnline").isJsonNull) {
                    obj.get("desktopOnline").asBoolean
                } else {
                    false   // 桌面端该字段被省略（契约 §7.3）
                }
                _state.value = _state.value.copy(authed = true, desktopOnline = online, lastError = null)
                emit(RelayMessage.AuthOk("mobile", currentBindId, online))
            }

            "auth-fail" -> {
                val error = if (obj.has("error") && !obj.get("error").isJsonNull) {
                    obj.get("error").asString
                } else {
                    "unknown"
                }
                _state.value = _state.value.copy(
                    authed = false, desktopOnline = false, lastError = error,
                )
                emit(RelayMessage.AuthFail(error))
                ws.close(1000, "auth-fail")
            }

            "desktop-status" -> {
                val online = obj.has("online") && !obj.get("online").isJsonNull &&
                    obj.get("online").asBoolean
                _state.value = _state.value.copy(desktopOnline = online)
                emit(RelayMessage.DesktopStatus(online))
            }

            "pong" -> {
                val now = if (obj.has("now") && !obj.get("now").isJsonNull) obj.get("now").asLong else 0L
                emit(RelayMessage.Pong(now))
            }

            "sync-wake" -> {
                emit(
                    RelayMessage.SyncWake(
                        board = obj.str("board"),
                        count = obj.int("count"),
                    ),
                )
            }

            "api-res" -> {
                // ⚠️ 房间广播：必须按 String 归一化的 id 过滤（契约 §7.3）
                val id = obj.str("id")
                val ok = obj.has("ok") && !obj.get("ok").isJsonNull && obj.get("ok").asBoolean
                val status = obj.int("status")
                val dataObj = if (obj.has("data") && obj.get("data").isJsonObject) {
                    obj.getAsJsonObject("data")
                } else {
                    com.google.gson.JsonObject()
                }
                val error = dataObj.str("error").ifBlank { null }
                val res = RelayMessage.ApiRes(
                    id = id, ok = ok, status = status, error = error, data = dataObj,
                )
                pending.remove(id)?.invoke(res)
                emit(res)
            }

            else -> emit(RelayMessage.Unknown(t))
        }
    }

    /**
     * 发一条指令并等回执（契约 §7.4 / §7.6）。
     *
     * @return 桌面端的回执；超时返回 `status=504`，桌面离线返回 `status=503`
     */
    suspend fun call(path: String, body: Map<String, Any?> = emptyMap()): RelayMessage.ApiRes {
        if (!_state.value.connected || !_state.value.desktopOnline) {
            return offlineResponse()
        }

        val id = seq.incrementAndGet().toString()
        val fanout = Json.gson.toJson(
            mapOf(
                "t" to "api",
                "id" to id,
                "path" to path,
                "body" to body,
            ),
        )

        // ⚠️ 单帧 ≤64 KiB（契约 §7.6），超出中继直接丢弃、不会有任何回执
        if (fanout.toByteArray(Charsets.UTF_8).size > MAX_FRAME_BYTES) {
            return RelayMessage.ApiRes(id, ok = false, status = 413, error = "payload too large")
        }

        val ws = webSocket ?: return offlineResponse()

        return kotlinx.coroutines.suspendCancellableCoroutine { cont ->
            pending[id] = { res -> if (cont.isActive) cont.resumeWith(Result.success(res)) }

            if (!ws.send(fanout)) {
                pending.remove(id)
                if (cont.isActive) cont.resumeWith(Result.success(offlineResponse(id)))
                return@suspendCancellableCoroutine
            }
            _state.value = _state.value.copy(sentCount = _state.value.sentCount + 1)

            // 指令超时（契约 §7.6：8 秒）
            scope.launch {
                delay(CALL_TIMEOUT_MS)
                pending.remove(id)?.let { cb ->
                    cb(RelayMessage.ApiRes(id, ok = false, status = 504, error = "timeout"))
                }
            }
        }
    }

    private fun failAllPending(reason: String) {
        pending.keys.toList().forEach { id ->
            pending.remove(id)?.invoke(
                RelayMessage.ApiRes(id, ok = false, status = 503, error = reason),
            )
        }
    }

    private fun emit(message: RelayMessage) {
        _messages.tryEmit(message)
    }

    private fun offlineResponse(id: String = "") =
        RelayMessage.ApiRes(id, ok = false, status = 503, error = "desktop offline")

    private fun timeoutResponse() =
        RelayMessage.ApiRes("", ok = false, status = 504, error = "timeout")

    /** 当前 bindId —— 由 [setBindId] 在绑定时写入，供 auth 首帧使用 */
    @Volatile private var currentBindId: String = ""

    fun setBindId(bindId: String) {
        currentBindId = bindId
    }

    companion object {
        /** 契约 §7.6：应用层心跳建议 25 秒 */
        const val PING_INTERVAL_MS = 25_000L

        /** 契约 §7.6：60 秒无任何消息 → 半死，主动重连 */
        const val ALIVE_TIMEOUT_MS = 60_000L

        /** 契约 §7.6：重连间隔 3 秒 */
        const val RECONNECT_MS = 3_000L

        /** 契约 §7.6：指令超时 8 秒 */
        const val CALL_TIMEOUT_MS = 8_000L

        /** 契约 §7.6：单帧消息上限 64 KiB */
        const val MAX_FRAME_BYTES = 64 * 1024
    }
}

// ---- JsonObject 安全读取 ----

private fun com.google.gson.JsonObject.str(key: String): String =
    if (has(key) && !get(key).isJsonNull) runCatching { get(key).asString }.getOrDefault("") else ""

private fun com.google.gson.JsonObject.int(key: String): Int =
    if (has(key) && !get(key).isJsonNull) runCatching { get(key).asInt }.getOrDefault(0) else 0
