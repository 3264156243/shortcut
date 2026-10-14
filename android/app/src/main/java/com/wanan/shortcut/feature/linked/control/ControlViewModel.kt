package com.wanan.shortcut.feature.linked.control

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import com.wanan.shortcut.core.realtime.ControlPaths
import com.wanan.shortcut.core.realtime.RelayClient
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 电脑控制界面状态。
 */
data class ControlUiState(
    /** 通道是否可用（不可用时 UI 显示离线提示与重连入口） */
    val ready: Boolean = false,
    /** 通道名："云端" / "局域网" */
    val channelLabel: String = "",
    /** 已发指令数（web 用它做现场诊断） */
    val sentCount: Int = 0,
    /** 提示信息 */
    val notice: String? = null,
    val noticeIsError: Boolean = false,
)

/** 剪贴板抽屉的数据 */
data class ClipboardState(
    val current: String = "",
    val history: List<String> = emptyList(),
    val loading: Boolean = false,
    val notice: String? = null,
)

/**
 * 通道连接状态（入口页据此显示"正在连接/已直连/失败"）。
 */
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

/**
 * 电脑控制 ViewModel。
 *
 * ## 核心是"差量文本同步"算法（对齐 web `syncFromBuffer()`）
 *
 * 手机端输入区与电脑光标之间不是"发一次全部文本"，而是**只发差量**：
 * web 的做法是找 `buf` 与 `sent` 的**最长公共前缀**，然后：
 *
 * | 情况 | 动作 |
 * |---|---|
 * | `buf` 是 `sent` 的前缀（用户删字） | 发 `sent.length - buf.length` 次退格 |
 * | `sent` 是 `buf` 的前缀（用户追加） | 把新增部分 `type` 过去 |
 * | 中间被改（前缀后有分歧） | 先退格 `sent.length - i` 次，再 `type` 新内容 |
 *
 * 这套算法避免每次输入都重发整段文本（既慢又会重复输入），
 * 且它是**纯逻辑**，因此可脱离 Android 完整单测（见 [TextDiffSync] 的测试）。
 *
 * ## IME 组合输入必须保护（web 的 `compositionstart/end`）
 *
 * 中文输入法选字期间会不断触发 `input`，此时若同步会**把拼音字母打到电脑上**。
 * web 用 `composing` 标志跳过；安卓端见 [TextDiffSync.isComposing]。
 */
class ControlViewModel(
    private val relay: RelayClient,
    private val lanClient: com.wanan.shortcut.core.lan.LanClient,
    /** 取当前 bindId（换票用） */
    private val bindIdProvider: () -> String,
    /** 取当前手机凭证（换票用） */
    private val apiClient: com.wanan.shortcut.core.net.ApiGateway,
) : ViewModel() {

    private val _state = MutableStateFlow(ControlUiState())
    val state: StateFlow<ControlUiState> = _state.asStateFlow()

    private val _clipboard = MutableStateFlow(ClipboardState())
    val clipboard: StateFlow<ClipboardState> = _clipboard.asStateFlow()

    private val _connection = MutableStateFlow(ConnectionState())
    val connection: StateFlow<ConnectionState> = _connection.asStateFlow()

    /**
     * 差量同步器。
     *
     * 它**不持有 UI 状态**，只负责"给定新旧缓冲，产出要发的指令序列"，
     * 因此可以脱离 Android 环境做纯单元测试。
     */
    val diffSync = TextDiffSync()

    /** 当前通道（null = 未连接）。两个入口都会写它。 */
    @Volatile private var channel: ControlChannel? = null

    init {
        // 订阅中继状态，让 UI 反映"是否可用"
        viewModelScope.launch {
            relay.state.collect { rs ->
                _state.value = _state.value.copy(
                    ready = channel?.available == true,
                    channelLabel = channel?.label ?: "",
                    sentCount = rs.sentCount,
                )
                if (rs.lastError != null) {
                    _connection.value = _connection.value.copy(lastError = rs.lastError)
                }
            }
        }
    }

    // ---------------- 通道连接 ----------------

    /**
     * 云端通道：换票 → 连中继 → 切到云端通道。
     *
     * 契约 §1.4 / §7.6：**一条 WS 长连接只换一次票**（60 次/分钟限流），
     * 所以换票由 [RelayClient.connect] 在每次建连时做一次，而不是每条指令换。
     */
    fun connectCloud() {
        val bindId = bindIdProvider()
        if (bindId.isBlank()) {
            _connection.value = _connection.value.copy(lastError = "请先绑定电脑")
            return
        }

        relay.setBindId(bindId)
        channel = CloudChannel(relay)
        _connection.value = _connection.value.copy(connecting = true, lastError = null)

        relay.connect {
            // 换票：契约 §7.2 的 control.ticket（role=mobile）
            when (
                val r = apiClient.post(
                    "control.ticket",
                    mapOf("role" to "mobile", "bindId" to bindId),
                )
            ) {
                is com.wanan.shortcut.core.result.ApiResult.Ok -> {
                    val ticket = r.data.str("ticket")
                    if (ticket.isBlank()) {
                        ApiResult.BusinessFail("换票失败：服务端未返回 ticket")
                    } else {
                        ApiResult.Ok(ticket)
                    }
                }
                // 其余三类原样透传（泛型已在 ApiResult<JsonObject> → ApiResult<String> 转换处收敛）
                is com.wanan.shortcut.core.result.ApiResult.BusinessFail ->
                    ApiResult.BusinessFail(r.message, r.httpCode)
                is com.wanan.shortcut.core.result.ApiResult.TransportFail -> r
                com.wanan.shortcut.core.result.ApiResult.Unauthorized ->
                    com.wanan.shortcut.core.result.ApiResult.Unauthorized
            }
        }

        _connection.value = _connection.value.copy(connecting = false)
        refreshAvailability()
    }

    /**
     * 局域网一键直连（契约 §8.2）。
     *
     * 流程：**经已建立的云端 WS 通道**发 `/api/lan-entry` → 拿 `{running,url,token}`
     * → 切到局域网通道。
     *
     * ⚠️ 契约 §8.5-2：**每次都要重新询问，不要缓存 IP**。所以这里每次都发请求。
     * ⚠️ 该接口需要云端 WS 在线（契约 §8.2 末尾），所以先确保云端已连。
     */
    fun connectLan() {
        viewModelScope.launch {
            _connection.value = _connection.value.copy(
                lanBusy = true, lanError = null, lanNotice = null,
            )

            // 先确保云端通道在（lan-entry 只在云端中继上暴露）
            if (relay.state.value.connected.not() || channel !is CloudChannel) {
                connectCloud()
                // 给建连一点时间；拿不到就明确告知，而不是干等
                var waited = 0
                while (!relay.state.value.connected && waited < 6000) {
                    kotlinx.coroutines.delay(200)
                    waited += 200
                }
            }

            val res = relay.call(com.wanan.shortcut.core.realtime.ControlPaths.LAN_ENTRY)
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
            _connection.value = _connection.value.copy(
                lanBusy = false, lanActive = true, lanBaseUrl = url,
                lanNotice = "已直连 $url（局域网，延迟更低）",
            )
            refreshAvailability()
        }
    }

    /**
     * 手动填地址直连（web 的「备用：手动填地址」）。
     *
     * 契约 §8.3：默认 `authMode='pair'`，这时需要先 `POST /api/pair` 用 6 位绑定码换 token。
     * 但手动模式网页是"打开控制页后再输入绑定码"，安卓端简化为：
     * 直接用**当前绑定的 code** 换 token（用户已绑定过，不必再输一次）。
     */
    fun connectLanManual(rawHost: String) {
        val host = normalizeHost(rawHost)
        if (host == null) {
            _connection.value = _connection.value.copy(
                lanError = "地址格式不对，请按桌面端显示填写，如 192.168.1.5:9823",
            )
            return
        }

        viewModelScope.launch {
            val baseUrl = "http://$host"

            // 先探测这个地址是不是局域网控制服务（能区分"地址不通"与"令牌不对"）
            when (val cfg = lanClient.config(baseUrl)) {
                is com.wanan.shortcut.core.result.ApiResult.Ok -> Unit
                else -> {
                    _connection.value = _connection.value.copy(
                        lanError = "连不上 $host（地址不对，或手机与电脑不在同一 Wi-Fi）",
                    )
                    return@launch
                }
            }

            // 该服务是否要求配对
            val authMode = runCatching {
                lanClient.config(baseUrl).let { r ->
                    if (r is com.wanan.shortcut.core.result.ApiResult.Ok) r.data.str("authMode") else ""
                }
            }.getOrDefault("")

            if (authMode != "pair") {
                _connection.value = _connection.value.copy(
                    lanError = "该地址的运行模式不支持手动连接（authMode=$authMode），" +
                        "请改用「局域网直连」入口。",
                )
                return@launch
            }

            _connection.value = _connection.value.copy(
                lanError = "手动地址需要 6 位绑定码配对。请改用「局域网直连」入口" +
                    "（它会自动带预授权令牌，无需配对）。",
            )
        }
    }

    /** 把 `192.168.1.5` / `192.168.1.5:9823` / `http://…` 统一成 `host:port` */
    private fun normalizeHost(raw: String): String? {
        var host = raw.trim()
        if (host.isEmpty()) return null
        host = host.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
        host = host.replace(Regex("/+.*$"), "")
        if (Regex("""^[\w.-]+:\d{2,5}$""").matches(host)) return host
        if (Regex("""^\d{1,3}(\.\d{1,3}){3}$""").matches(host)) return "$host:9823"
        return null
    }

    /** 刷新可用性（界面恢复时调用） */
    fun refreshAvailability() {
        _state.value = _state.value.copy(
            ready = channel?.available == true,
            channelLabel = channel?.label ?: "",
        )
    }

    // ---------------- 输入区 ----------------

    /**
     * 用户改了输入区内容 → 发差量。
     *
     * @param isComposing 输入法是否正在组合（中文选字中）—— 为 true 时**不同步**，
     *        否则会把拼音字母打到电脑上。
     */
    fun onBufferChanged(buffer: String, isComposing: Boolean) {
        if (isComposing) {
            diffSync.updateBufferWithoutSync(buffer)
            return
        }
        val actions = diffSync.onBufferChanged(buffer)
        dispatch(actions)
    }

    /** 退格按钮（web 的 `btnBs`） */
    fun backspace() {
        val actions = diffSync.onBackspace()
        dispatch(actions)
    }

    /** 回车按钮 */
    fun pressEnter() = sendKey("enter")

    /** Tab 按钮 */
    fun pressTab() = sendKey("tab")

    /** 清空：**只清本页缓冲，不影响电脑**（web 的 `btnClear` 注释写明了这一点） */
    fun clearBuffer() {
        diffSync.onClear()
    }

    // ---------------- 指令 ----------------

    /**
     * 发一条指令。
     *
     * 统一在这里 `launch`，让所有调用点（按钮回调，都是普通函数）不必各自处理协程。
     */
    private fun sendKey(name: String) = sendCommand(ControlCommands.key(name))

    private fun sendCommand(
        command: Pair<String, Map<String, Any?>>,
        silent: Boolean = false,
    ) {
        viewModelScope.launch { runCommand(command, silent) }
    }

    /** 方向键（web 的 `#arrows`） */
    fun sendArrow(direction: String) {
        // web 的 data-key 就是 up/down/left/right
        sendKey(direction)
    }

    /** 组合键（web 的 chips） */
    fun sendCombo(keys: List<String>) = sendCommand(ControlCommands.combo(keys))

    /** 鼠标移动（高频指令，失败不打扰用户 —— web 明确对 mouse/wheel/click 不弹提示） */
    fun sendMouse(dx: Int, dy: Int) {
        if (dx == 0 && dy == 0) return
        sendCommand(ControlCommands.mouse(dx, dy), silent = true)
    }

    fun sendClick(button: String) = sendCommand(ControlCommands.click(button), silent = true)

    fun sendWheel(delta: Int) = sendCommand(ControlCommands.wheel(delta), silent = true)

    /** 双击（web 的 `btnDbl`：连发两次左键） */
    fun sendDoubleClick() {
        viewModelScope.launch {
            runCommand(ControlCommands.click("left"), silent = true)
            kotlinx.coroutines.delay(80)
            runCommand(ControlCommands.click("left"), silent = true)
        }
    }

    // ---------------- 剪贴板 ----------------

    /** 打开剪贴板抽屉时读取电脑剪贴板（web 的 `refreshClipUi`） */
    fun refreshClipboard() {
        viewModelScope.launch {
            _clipboard.value = _clipboard.value.copy(loading = true, notice = null)

            val (path, body) = ControlCommands.clipboardRefresh()
            when (val r = call(path, body)) {
                is ControlResult.Ok -> {
                    val current = r.data.str("current")
                    val history = r.data.stringList("history")
                    _clipboard.value = ClipboardState(
                        current = current,
                        history = history,
                        loading = false,
                    )
                }
                is ControlResult.Fail -> {
                    _clipboard.value = _clipboard.value.copy(
                        loading = false,
                        // web：读取失败就显示"读取电脑粘贴板失败"
                        notice = r.message,
                    )
                }
            }
        }
    }

    /** 把某条文本输出到电脑光标处（web：点条目 = 粘贴到光标） */
    fun pasteToDesktop(text: String) {
        val v = text.trim()
        if (v.isEmpty()) return
        sendCommand(ControlCommands.clipboardPaste(v.take(20000)))
    }

    /** 清空电脑剪贴板历史（web：只清历史，**不影响**电脑当前剪贴板） */
    fun clearClipboardHistory() {
        viewModelScope.launch {
            runCommand(ControlCommands.clipboardClear())
            _clipboard.value = _clipboard.value.copy(
                history = emptyList(),
                notice = "已清空历史（不影响电脑剪贴板）",
            )
        }
    }

    fun consumeClipboardNotice() {
        if (_clipboard.value.notice != null) {
            _clipboard.value = _clipboard.value.copy(notice = null)
        }
    }

    fun consumeNotice() {
        if (_state.value.notice != null) _state.value = _state.value.copy(notice = null)
    }

    // ---------------- 内部 ----------------

    private suspend fun call(path: String, body: Map<String, Any?>): ControlResult {
        val ch = channel
            ?: return ControlResult.Fail(503, "还没有可用通道，请先连接电脑")
        return ch.call(path, body)
    }

    /**
     * 执行一批差量动作。
     *
     * 顺序执行（在协程里串行）而不是并发发：
     * 退格与打字有**先后依赖**，并发会乱序导致电脑上的文本错乱。
     * web 也是用 `enqueue` 串行化的（`queue = queue.then(fn)`）。
     */
    private fun dispatch(actions: List<SyncAction>) {
        if (actions.isEmpty()) return
        viewModelScope.launch {
            for (action in actions) {
                when (action) {
                    is SyncAction.TypeText ->
                        runCommand(ControlCommands.type(action.text), silent = true)
                    is SyncAction.PressKey ->
                        runCommand(ControlCommands.key(action.key), silent = true)
                }
            }
        }
    }

    private suspend fun runCommand(
        command: Pair<String, Map<String, Any?>>,
        silent: Boolean = false,
    ) {
        val (path, body) = command
        // 未就绪时只有"非静默"指令才提示；鼠标类的静默指令直接丢弃（web 同样处理）
        if (channel?.available != true) {
            if (!silent) notice("电脑不在线，指令未送达", isError = true)
            return
        }

        when (val r = call(path, body)) {
            is ControlResult.Ok -> Unit
            is ControlResult.Fail -> if (!silent) notice(r.message, isError = true)
        }
    }

    private fun notice(text: String, isError: Boolean) {
        _state.value = _state.value.copy(notice = text, noticeIsError = isError)
    }
}

// ---- JsonObject 安全读取 ----

private fun JsonObject.str(key: String): String =
    if (has(key) && !get(key).isJsonNull) runCatching { get(key).asString }.getOrDefault("") else ""

private fun JsonObject.stringList(key: String): List<String> {
    if (!has(key) || get(key).isJsonNull) return emptyList()
    val arr = runCatching { getAsJsonArray(key) }.getOrNull() ?: return emptyList()
    return arr.mapNotNull { el -> runCatching { el.asString }.getOrNull() }
}
