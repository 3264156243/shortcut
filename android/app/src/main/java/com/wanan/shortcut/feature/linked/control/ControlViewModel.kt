package com.wanan.shortcut.feature.linked.control

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 电脑控制界面状态。
 */
data class ControlUiState(
    /** 通道是否可用 */
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
 * 电脑控制 ViewModel —— **页面级**（每次进入目的地都会新建）。
 *
 * ## 职责划分（这是修掉"连上了却显示未连接"的关键）
 *
 * | 状态 | 归属 | 原因 |
 * |---|---|---|
 * | 通道选择、连接状态 | [`ControlSession`]（容器单例） | **跨页面共享**：入口页连上的通道，控制页必须能看到 |
 * | 指令发送 | ViewModel（调 session） | 页面级即可 |
 * | 输入缓冲（差量同步） | ViewModel | 属于"当前这次输入"，页面重建后重置是合理的 |
 * | 剪贴板列表 | ViewModel | 展示态，重建后重新拉取即可 |
 *
 * ## 为什么不再自己连通道（这是修掉的 bug）
 *
 * 早先版本把 `connectCloud()/connectLan()` 和 `channel` 都放在 ViewModel 里，
 * 而 `containerViewModel()` 绑定的是**最近的目的地** ——
 * Navigation Compose 里入口页与控制页是**两个目的地**，各自持有独立实例。
 * 于是入口页连好了，控制页拿到的是全新的空实例 → "未连接"。
 *
 * 现在连接动作转发给 [ControlSession]，页面无论如何重建，看到的都是同一条通道。
 */
class ControlViewModel(
    private val session: ControlSession,
) : ViewModel() {

    private val _state = MutableStateFlow(ControlUiState())
    val state: StateFlow<ControlUiState> = _state.asStateFlow()

    private val _clipboard = MutableStateFlow(ClipboardState())
    val clipboard: StateFlow<ClipboardState> = _clipboard.asStateFlow()

    /** 连接状态转发（UI 直接观察 session 的，避免两份真相） */
    val connection: StateFlow<ConnectionState> = session.connection

    /** 差量同步器（纯逻辑，可单测） */
    val diffSync = TextDiffSync()

    /**
     * 已同步文本的**响应式**镜像。
     *
     * ## 为什么要单独存一份
     *
     * `diffSync.sentSnapshot()` 是普通方法，**不是 Compose 状态** ——
     * 读它不会触发重组，界面上的"已同步 N"可能永远显示旧值。
     * 用户看到数字不动，会以为"没同步"，而实际上可能已经同步了。
     *
     * 存成 StateFlow 后，每次同步动作都会驱动界面刷新，
     * 用户能**直接看到**同步是否在推进（这也是排查"到底有没有发出去"的第一手信息）。
     */
    private val _sentText = MutableStateFlow("")
    val sentText: StateFlow<String> = _sentText.asStateFlow()

    init {
        // ★ 订阅**会话级**的可用性：入口页在别处连上通道时，本页会自动跟随变绿。
        // 早先版本在 init 里"读一次快照"，页面重建时读到的是旧值
        // —— 这正是"入口显示已连接、控制页显示未连接"的另一半原因。
        viewModelScope.launch {
            session.ready.collect { ready ->
                _state.value = _state.value.copy(ready = ready)
            }
        }
        viewModelScope.launch {
            session.sentCount.collect { n ->
                _state.value = _state.value.copy(sentCount = n)
            }
        }
        refreshAvailability()
    }

    /**
     * 刷新可用性（从会话取当前快照）。
     *
     * 页面每次进入都调一次：因为通道可能在**别的页面**（入口页）被建立。
     */
    fun refreshAvailability() {
        _state.value = _state.value.copy(
            ready = session.isReady,
            channelLabel = session.channelLabel,
        )
    }

    // ---------------- 连接（转发给会话） ----------------

    fun connectCloud() {
        session.connectCloud()
        refreshAvailability()
    }

    /**
     * 局域网直连（**不依赖云端**）—— 填电脑地址 + 配对码。
     *
     * 这是当前的主力路径：绕开"必须经云端问地址"的前置条件。
     */
    fun connectLanDirect(host: String, pairCode: String = "") {
        session.connectLanDirect(host, pairCode)
    }

    /** 扫码得到地址 + 预授权令牌，直接连（不用配对码） */
    fun connectLanWithToken(host: String, token: String) {
        session.connectLanWithToken(host, token)
    }

    /** 扫码内容无法识别时给出提示（走连接状态里的 lanError，入口页会显示成红色卡片） */
    fun showScanError(message: String) {
        session.showLanError(message)
    }

    fun connectLan() {
        session.connectLan()
        refreshAvailability()
    }

    fun clearConnectionError() {
        session.clearError()
    }

    /**
     * 主动断开（用户点了"断开连接"）。
     *
     * 同时停掉前台服务，通知栏的常驻提示一并消失。
     */
    fun disconnect(context: android.content.Context) {
        session.disconnect(context)
        refreshAvailability()
        _sentText.value = ""
    }

    /**
     * 连接可用时启动前台服务，保持长连接。
     *
     * 由 UI 在"已连接"时调用一次。刻意**不**放在 Connect 流程里：
     * 那样会依赖调用方记得传 Context，容易漏；放在界面观察处更可靠。
     */
    fun ensureForegroundService(context: android.content.Context) {
        if (!session.isReady) return
        ControlForegroundService.start(
            context,
            title = "电脑控制已连接",
            text = "通道：${session.channelLabel}　·　可在通知栏或控制页断开",
        )
    }

    // ---------------- 输入区 ----------------

    /**
     * 用户改了输入区内容 → 发差量。
     *
     * @param isComposing 输入法是否正在组合（中文选字中）—— true 时**不同步**，
     *        否则会把拼音字母打到电脑上。
     */
    fun onBufferChanged(buffer: String, isComposing: Boolean) {
        if (isComposing) {
            diffSync.updateBufferWithoutSync(buffer)
            return
        }
        dispatch(diffSync.onBufferChanged(buffer))
        // 每次算完差量后同步镜像，让界面上的"已同步 N"能真实反映进度
        _sentText.value = diffSync.sentSnapshot()
    }

    /** 退格按钮 */
    fun backspace() {
        dispatch(diffSync.onBackspace())
        _sentText.value = diffSync.sentSnapshot()
    }

    fun pressEnter() = sendKey("enter")

    fun pressTab() = sendKey("tab")

    /** 清空：**只清本页缓冲，不影响电脑** */
    fun clearBuffer() {
        diffSync.onClear()
        _sentText.value = diffSync.sentSnapshot()
    }

    // ---------------- 指令 ----------------

    private fun sendKey(name: String) = sendCommand(ControlCommands.key(name))

    /**
     * 发**单个键**（`/api/key`）—— 键盘按键走这条。
     *
     * ⚠️ 与 [sendCombo] 的区别是语义性的，不是风格问题：
     *   - `/api/key` → 桌面端 `inject("KEY <vk>")`，按下并释放一个键；
     *   - `/api/combo` → "按键序列"，单个字母走它会被当成序列处理。
     *
     * 踩过的 bug：虚拟键盘一律走 combo，用户反馈
     * "**键盘打字母却是一些快捷键一样的**"。
     */
    fun sendSingleKey(name: String) = sendKey(name)

    private fun sendCommand(
        command: Pair<String, Map<String, Any?>>,
        silent: Boolean = false,
    ) {
        viewModelScope.launch { runCommand(command, silent) }
    }

    fun sendArrow(direction: String) = sendKey(direction)

    fun sendCombo(keys: List<String>) = sendCommand(ControlCommands.combo(keys))

    /** 鼠标移动（高频指令，失败不打扰用户 —— web 明确对 mouse/wheel/click 不弹提示） */
    fun sendMouse(dx: Int, dy: Int) {
        if (dx == 0 && dy == 0) return
        sendCommand(ControlCommands.mouse(dx, dy), silent = true)
    }

    fun sendClick(button: String) = sendCommand(ControlCommands.click(button), silent = true)

    fun sendWheel(delta: Int) = sendCommand(ControlCommands.wheel(delta), silent = true)

    /** 双击（web 的 `btnDbl`：连发两次左键，间隔 80ms） */
    fun sendDoubleClick() {
        viewModelScope.launch {
            runCommand(ControlCommands.click("left"), silent = true)
            kotlinx.coroutines.delay(80)
            runCommand(ControlCommands.click("left"), silent = true)
        }
    }

    // ---------------- 剪贴板 ----------------

    /** 打开剪贴板分区时读取电脑剪贴板（web 的 `refreshClipUi`） */
    fun refreshClipboard() {
        viewModelScope.launch {
            _clipboard.value = _clipboard.value.copy(loading = true, notice = null)

            val (path, body) = ControlCommands.clipboardRefresh()
            when (val r = session.call(path, body)) {
                is ControlResult.Ok -> {
                    _clipboard.value = ClipboardState(
                        current = r.data.str("current"),
                        history = r.data.stringList("history"),
                        loading = false,
                    )
                }
                is ControlResult.Fail -> {
                    _clipboard.value = _clipboard.value.copy(loading = false, notice = r.message)
                }
            }
        }
    }

    /** 把某条文本输出到电脑光标处 */
    fun pasteToDesktop(text: String) {
        val v = text.trim()
        if (v.isEmpty()) return
        sendCommand(ControlCommands.clipboardPaste(v.take(20000)))
    }

    /** 清空电脑剪贴板历史（**不影响**电脑当前剪贴板） */
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

    /**
     * 执行一批差量动作。
     *
     * 顺序执行（协程内串行）而不是并发发：退格与打字有**先后依赖**，
     * 并发会乱序导致电脑上的文本错乱。web 也是用 `enqueue` 串行化的。
     */
    private fun dispatch(actions: List<SyncAction>) {
        if (actions.isEmpty()) return
        viewModelScope.launch {
            for (action in actions) {
                when (action) {
                    is SyncAction.TypeText -> {
                        // ⚠️ 必须分片：桌面端 `/api/type` 单次上限 2000 **UTF-8 字节**
                        // （超了直接 400）。一次性粘贴很多字、或一次输入很长时会超限。
                        // 逐片**串行**发送，保证电脑上出现顺序与输入顺序一致。
                        for (chunk in ControlCommands.typeChunks(action.text)) {
                            runCommand(chunk, silent = false)
                        }
                    }

                    is SyncAction.PressKey ->
                        runCommand(ControlCommands.key(action.key), silent = false)
                }
            }
        }
    }

    private suspend fun runCommand(
        command: Pair<String, Map<String, Any?>>,
        silent: Boolean = false,
    ) {
        val (path, body) = command

        // 诊断：把"要发的指令"先记下来，后面再补结果。
        // 这样即使程序在发送途中出问题，日志里也能看到"它想发什么"。
        val detail = summarize(body)
        val startedAt = System.currentTimeMillis()

        if (!session.isReady) {
            trace(
                CommandTrace(
                    path = path,
                    detail = detail,
                    result = "未发出：通道不可用" + describeChannel(),
                    ok = false,
                    elapsedMs = 0,
                ),
            )
            if (!silent) notice("电脑不在线，指令未送达", isError = true)
            return
        }

        when (val r = session.call(path, body)) {
            is ControlResult.Ok -> {
                // 顺便记录服务端报告的 injector 状态 —— 这是"注入器到底有没有就绪"的直接证据
                val injectorNote = injectorStateOf(r.data)
                trace(
                    CommandTrace(
                        path = path,
                        detail = detail,
                        result = "成功" + injectorNote,
                        ok = true,
                        elapsedMs = System.currentTimeMillis() - startedAt,
                    ),
                )
            }

            is ControlResult.Fail -> {
                // ★ 指令失败后重算会话可用性：
                // 局域网通道在遇到网络类失败时会自我降级（available=false），
                // 这里把变化同步到 UI，让界面**立刻**从"已连接"变成"未连接"
                // —— 而不是继续显示已连接、用户却每点一下都没反应。
                refreshAvailability()
                trace(
                    CommandTrace(
                        path = path,
                        detail = detail,
                        result = "失败[${r.status}]：${r.message}",
                        ok = false,
                        elapsedMs = System.currentTimeMillis() - startedAt,
                    ),
                )
                if (!silent) notice(r.message, isError = true)
            }
        }
    }

    /**
     * 从响应里读出 injector 状态，转成一句人话。
     *
     * 为什么要单独提出来：桌面端的注入器是一个**常驻 PowerShell 子进程**，
     * 它必须输出 `READY` 才算就绪。若它没起来，`inject()` 会返回 false，
     * 表现就是"指令发出去了、电脑没反应"。把这个状态显式写进诊断，
     * 用户一看就知道该去重启桌面端。
     */
    private fun injectorStateOf(data: com.google.gson.JsonObject): String {
        if (!data.has("injector") || data.get("injector").isJsonNull) return ""
        val ready = runCatching { data.get("injector").asBoolean }.getOrDefault(false)
        return if (ready) "　注入器就绪" else "　⚠ 注入器未就绪"
    }

    /** 当前通道的简短描述，供诊断日志用 */
    private fun describeChannel(): String {
        val label = session.channelLabel.ifBlank { "无通道" }
        return "（$label）"
    }

    /** 从请求体里提炼一行摘要（打字显示文本片段，其它显示键名/坐标） */
    private fun summarize(body: Map<String, Any?>): String {
        val text = body["text"] as? String
        if (text != null) {
            val shown = if (text.length > 20) text.take(20) + "…" else text
            return "\"$shown\"（${text.length} 字 / ${text.toByteArray(Charsets.UTF_8).size} 字节）"
        }
        body["key"]?.let { return "key=$it" }
        body["keys"]?.let { return "keys=$it" }
        body["dx"]?.let { return "dx=$it dy=${body["dy"]}" }
        body["button"]?.let { return "button=$it" }
        body["delta"]?.let { return "delta=$it" }
        return if (body.isEmpty()) "（无参数）" else body.toString()
    }

    private fun notice(text: String, isError: Boolean) {
        _state.value = _state.value.copy(notice = text, noticeIsError = isError)
    }

    // ---------------- 诊断日志 ----------------
    //
    // 为什么需要它：用户连着两次反馈"打字没同步、任何提示没有"。
    // 靠读代码猜已经到极限了 —— 必须让 App 自己说出"这条指令发生了什么"：
    // 是不是发出去了、服务端回了什么、失败还是成功。
    //
    // 设计上刻意做成**常驻可见**而不是藏起来的调试开关：
    // 这类"连上了但用不了"的问题，用户现场看不到信息，就只能靠反复描述现象。
    // 代价是有几行文字占位，但换来的可排查性更重要。

    private val _recentCommands = MutableStateFlow<List<CommandTrace>>(emptyList())
    val recentCommands: StateFlow<List<CommandTrace>> = _recentCommands.asStateFlow()

    /** 记一条指令轨迹（只保留最近 [MAX_TRACES] 条，避免无限增长） */
    private fun trace(entry: CommandTrace) {
        _recentCommands.value = (listOf(entry) + _recentCommands.value).take(MAX_TRACES)
    }

    /** 清空诊断日志 */
    fun clearTraces() {
        _recentCommands.value = emptyList()
    }
}

/**
 * 一条指令的执行轨迹（给用户看，也给排查用）。
 *
 * @param path 指令路径，如 `/api/type`
 * @param detail 关键内容摘要（打字的话就是文本前若干字）
 * @param result 结果描述
 * @param ok 是否成功
 * @param elapsedMs 耗时（毫秒）—— 能看出是"没发出去"还是"发了但慢"
 */
data class CommandTrace(
    val path: String,
    val detail: String,
    val result: String,
    val ok: Boolean,
    val elapsedMs: Long,
)

/** 诊断日志最多保留条数 */
private const val MAX_TRACES = 12

// ---- JsonObject 安全读取 ----

private fun JsonObject.str(key: String): String =
    if (has(key) && !get(key).isJsonNull) runCatching { get(key).asString }.getOrDefault("") else ""

private fun JsonObject.stringList(key: String): List<String> {
    if (!has(key) || get(key).isJsonNull) return emptyList()
    val arr = runCatching { getAsJsonArray(key) }.getOrNull() ?: return emptyList()
    return arr.mapNotNull { el -> runCatching { el.asString }.getOrNull() }
}
