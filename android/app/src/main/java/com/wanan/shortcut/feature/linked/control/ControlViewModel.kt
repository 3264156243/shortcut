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

    fun connectLan() {
        session.connectLan()
        refreshAvailability()
    }

    fun connectLanManual(host: String) {
        session.connectLanManual(host)
    }

    fun clearConnectionError() {
        session.clearError()
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
    }

    /** 退格按钮 */
    fun backspace() = dispatch(diffSync.onBackspace())

    fun pressEnter() = sendKey("enter")

    fun pressTab() = sendKey("tab")

    /** 清空：**只清本页缓冲，不影响电脑** */
    fun clearBuffer() = diffSync.onClear()

    // ---------------- 指令 ----------------

    private fun sendKey(name: String) = sendCommand(ControlCommands.key(name))

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
        if (!session.isReady) {
            // 静默指令（鼠标类）直接丢弃；其余给出提示
            if (!silent) notice("电脑不在线，指令未送达", isError = true)
            return
        }

        when (val r = session.call(path, body)) {
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
