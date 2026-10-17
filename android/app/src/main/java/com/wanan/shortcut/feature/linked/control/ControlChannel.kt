package com.wanan.shortcut.feature.linked.control

import com.google.gson.JsonObject
import com.wanan.shortcut.core.lan.LanClient
import com.wanan.shortcut.core.realtime.ControlPaths
import com.wanan.shortcut.core.realtime.RelayClient
import com.wanan.shortcut.core.result.ApiResult

/**
 * 电脑控制的**指令通道抽象**（双通道）。
 *
 * ## 为什么要抽这一层
 *
 * 「电脑控制」有两条完全不同的传输路径，但**指令语义完全相同**
 * （契约 §7.5 明确："指令语义与局域网 HTTP API 完全一致，见 §8.4"）：
 *
 * | 通道 | 传输 | 延迟 | 可用条件 |
 * |---|---|---|---|
 * | 云端 | `{t:'api'}` 经 WS 中继 | 30–80ms | 任何网络 |
 * | 局域网 | `http://<ip>:9823` 下的 `/api/…` | 5–15ms | 同一 Wi-Fi |
 *
 * 把差异收在这一个接口后面，控制面板的代码就**不需要**到处判断
 * "现在是哪个模式" —— 这是 web 参考实现的做法
 * （`control/app/js/phone.js` 里所有指令都走同一个 `api(path, body)`）。
 */
interface ControlChannel {

    /** 当前是否可用（云端要求 WS 已连且桌面在线；局域网要求直连已建立） */
    val available: Boolean

    /** 通道名，供 UI 显示（"云端" / "局域网"） */
    val label: String

    suspend fun call(path: String, body: Map<String, Any?> = emptyMap()): ControlResult
}

/**
 * 统一结果。
 *
 * 之所以不用 `ApiResult`：两条通道的失败形状不同
 * （云端是 `{ok,status,data}`，局域网是 HTTP 状态码），
 * 而控制面板只关心"成功/失败 + 给用户看什么话"。
 */
sealed interface ControlResult {
    data class Ok(val data: JsonObject) : ControlResult

    /**
     * 失败。
     *
     * @param status 统一成与云端一致的语义码：503 离线 / 504 超时 / 401 鉴权
     * @param message 给用户看的话
     */
    data class Fail(val status: Int, val message: String) : ControlResult
}

/** 云端通道：走全局唯一的 WS 中继（契约 §7）。 */
class CloudChannel(
    private val relay: RelayClient,
) : ControlChannel {

    override val available: Boolean
        get() = relay.state.value.connected && relay.state.value.desktopOnline

    override val label: String get() = "云端"

    override suspend fun call(path: String, body: Map<String, Any?>): ControlResult {
        val res = relay.call(path, body)
        return if (res.ok) {
            // data 随回执一起回来（含 clipboard/refresh 需要的 current/history）
            ControlResult.Ok(res.data)
        } else {
            ControlResult.Fail(res.status, describe(res.status, res.error))
        }
    }

    private fun describe(status: Int, error: String?): String = when {
        error == "path not allowed" -> "这个指令不被支持"
        error == "desktop offline" -> "电脑不在线，请确认桌面端 ShortCut 正在运行"
        error == "control channel disabled" ->
            "电脑端还没开启「云端连接」，请在桌面 ShortCut「控制」板块打开"
        status == 503 -> "电脑不在线"
        status == 504 -> "指令超时，请重试"
        status == 429 || error == "busy" -> "电脑正忙，请稍后再试"
        else -> error ?: "指令发送失败"
    }
}

/**
 * 局域网通道：直连 `http://<ip>:9823`（契约 §8.3 / §8.4）。
 *
 * ## ⚠️ 关于 [available]（这是修掉的真实缺陷）
 *
 * 早先版本它**恒为 true** —— 只要通道被创建就宣称可用。
 * 于是桌面端给了个手机根本连不上的地址（虚拟网卡）时，
 * 界面显示"已直连"，但**每条指令都失败**，用户完全看不出问题在哪。
 *
 * 现在 [available] 反映**探测过的真实连通状态**：
 * 只有 [markReachable] 之后才算可用；一旦某次指令拿到网络类失败，
 * 立刻 [markUnreachable] 降级，让 UI 如实显示"连接已断开"。
 */
class LanChannel(
    private val lanClient: LanClient,
    private val baseUrl: String,
    private val token: String,
) : ControlChannel {

    @Volatile private var reachable: Boolean = true

    override val available: Boolean get() = reachable

    override val label: String get() = "局域网"

    /** 指令成功即确认可达（用于从降级状态恢复） */
    fun markReachable() {
        reachable = true
    }

    /** 网络类失败即降级（令牌失效除外 —— 那是鉴权问题，网络是通的） */
    fun markUnreachable() {
        reachable = false
    }

    override suspend fun call(path: String, body: Map<String, Any?>): ControlResult =
        when (val r = lanClient.post(baseUrl, token, path, body)) {
            is ApiResult.Ok -> {
                markReachable()

                // ★ 关键：控制指令的响应带 `ok` 字段，**HTTP 200 不代表注入成功**。
                //
                // 桌面端（`src-tauri/src/control.rs` 的 api_type / api_key / api_combo）：
                // ```rust
                // let ok = st.injector.inject(&format!("TYPE {b64}"));
                // ok_json(json!({ "ok": ok, "injector": st.injector.is_ready() }))
                // ```
                // 注入器没就绪 / 注入失败时依然是 **HTTP 200 + ok:false**。
                //
                // 早先版本只看 HTTP 状态（注释还写着"局域网接口没有 success 字段"），
                // 于是 `ok:false` 被当成成功 → 界面显示已发送、**电脑毫无反应且没有任何提示**
                // —— 这正是用户反馈"打字还是没有同步"却看不出原因的直接来源。
                //
                // 注意：`/api/ping`、`/api/status`、`/api/config` 这些**不带** ok 字段，
                // 所以只有在响应里**确实有** ok 时才据此判定。
                val data = r.data
                val hasOk = data.has("ok") && !data.get("ok").isJsonNull
                if (hasOk && !data.get("ok").asBoolean) {
                    val injectorReady = !data.has("injector") ||
                        data.get("injector").isJsonNull ||
                        data.get("injector").asBoolean
                    ControlResult.Fail(
                        500,
                        if (!injectorReady) {
                            "电脑端没有准备好接收输入（注入器未就绪）。" +
                                "请确认桌面 ShortCut 正在运行，且「局域网直连」已开启。"
                        } else {
                            "电脑端拒绝了这条输入（可能是当前窗口不接受按键，或权限不足）。"
                        },
                    )
                } else {
                    ControlResult.Ok(data)
                }
            }

            is ApiResult.BusinessFail -> {
                // 业务失败说明网络是通的（服务端回了话），保持可用
                markReachable()
                ControlResult.Fail(r.httpCode ?: 400, r.message)
            }

            is ApiResult.TransportFail -> {
                // ★ 网络类失败 → 降级，UI 会立刻变成"未连接"
                markUnreachable()
                ControlResult.Fail(
                    when (r.kind) {
                        ApiResult.TransportFail.Kind.TIMEOUT -> 504
                        else -> 503
                    },
                    when (r.kind) {
                        // 契约 §8.5-3：服务端无法判断"手机与电脑是否同一局域网"，客户端自行容错
                        ApiResult.TransportFail.Kind.TIMEOUT -> "局域网连接超时，可能不在同一 Wi-Fi"
                        ApiResult.TransportFail.Kind.NETWORK ->
                            "连不上电脑（局域网直连可能已停止，或手机与电脑不在同一 Wi-Fi）"
                        else -> "局域网请求失败"
                    },
                )
            }

            // 契约 §8.5-4：桌面端停止「局域网直连」后所有请求 401 → 应回落到云端或提示
            ApiResult.Unauthorized -> {
                markReachable()   // 网络是通的，只是令牌过期
                ControlResult.Fail(
                    401,
                    "局域网令牌已失效（电脑端可能已停止「局域网直连」），请重新连接",
                )
            }
        }
}

/**
 * 指令封装 —— 逐条对齐契约 §7.5 / §8.4 的入参形状。
 *
 * 把这些**集中在一处**而不是让 UI 直接拼 map：
 * 入参名写错（例如 `delta` 写成 `d`）服务端不会报错、只会行为异常，
 * 集中定义后才能用单测覆盖形状。
 */
object ControlCommands {

    /**
     * 桌面端 `/api/type` 的文本上限（`src-tauri/src/control.rs`：`if text.len() > 2000`）。
     *
     * 注意那是 **UTF-8 字节数**，不是字符数 —— 中文一个字 3 字节，
     * 所以 2000 字节约等于 **666 个汉字**。超了服务端直接 400。
     */
    private const val MAX_TYPE_BYTES = 2000

    /**
     * 打字。
     *
     * **必须分片**：差量同步在"粘贴一大段"或"一次输入很多"时会算出很长的文本，
     * 直接发会被服务端 400 拒掉（而且早先版本是静默的，表现为"打字没反应"）。
     *
     * 按 **UTF-8 字节** 切片而不是按字符数，才能与桌面端的判据对齐；
     * 且不能在多字节字符中间切断（否则中文会变成乱码）。
     */
    fun type(text: String): Pair<String, Map<String, Any?>> =
        ControlPaths.TYPE to mapOf<String, Any?>("text" to text.takeUtf8Bytes(MAX_TYPE_BYTES))

    /**
     * 把 [text] 按 UTF-8 字节切成若干片，每片 ≤ [MAX_TYPE_BYTES]，且不切断字符。
     *
     * 一次输入很长文本时，调用方应逐片发送（见 `ControlViewModel.dispatch`）。
     */
    fun typeChunks(text: String): List<Pair<String, Map<String, Any?>>> =
        text.chunkByUtf8Bytes(MAX_TYPE_BYTES).map { chunk ->
            ControlPaths.TYPE to mapOf<String, Any?>("text" to chunk)
        }

    /** 单键（`enter` / `f5` 等 vk 名，或数字） */
    fun key(name: String) = ControlPaths.KEY to mapOf<String, Any?>("key" to name)

    /** 组合键：`{keys:[...]}` 形式 */
    fun combo(keys: List<String>) = ControlPaths.COMBO to mapOf<String, Any?>("keys" to keys)

    /** 相对移动鼠标 */
    fun mouse(dx: Int, dy: Int) = ControlPaths.MOUSE to mapOf<String, Any?>("dx" to dx, "dy" to dy)

    /** 点击（left / right / middle） */
    fun click(button: String) = ControlPaths.CLICK to mapOf<String, Any?>("button" to button)

    /** 滚轮（正数向上） */
    fun wheel(delta: Int) = ControlPaths.WHEEL to mapOf<String, Any?>("delta" to delta)

    /** 读电脑剪贴板（含历史） */
    fun clipboardRefresh() = ControlPaths.CLIPBOARD_REFRESH to emptyMap<String, Any?>()

    /** 把文本写入电脑剪贴板并粘贴（≤20000 字节） */
    fun clipboardPaste(text: String) =
        ControlPaths.CLIPBOARD_PASTE to mapOf<String, Any?>("text" to text)

    /** 清空电脑剪贴板历史 */
    fun clipboardClear() = ControlPaths.CLIPBOARD_CLEAR to emptyMap<String, Any?>()
}

/**
 * 按 **UTF-8 字节数** 截断，且不切断多字节字符。
 *
 * 为什么不能用 `String.take(n)`：那是按 **Char（UTF-16 码元）** 截断，
 * 与桌面端判据（UTF-8 字节）不一致 —— 中文一个字算 1 个 Char 但 3 个字节，
 * 于是 `take(2000)` 可能得到 6000 字节 → 服务端仍然 400 拒绝。
 */
internal fun String.takeUtf8Bytes(maxBytes: Int): String =
    chunkByUtf8Bytes(maxBytes).firstOrNull().orEmpty()

/**
 * 按 UTF-8 字节数把字符串切成多片，每片 ≤ [maxBytes]，**不切断字符**。
 *
 * ## ⚠️ 必须按**码点**（code point）遍历，不能按 char
 *
 * Java/Kotlin 的 `String` 是 UTF-16：一个 BMP 内的字符占 1 个 char，
 * 而 emoji 等补充平面字符占 **2 个 char（代理对）**。
 *
 * 若逐 `char` 累加，就会把一对代理拆到两片里 →
 * 拼回来是两个孤立的代理字符 → 编码成 UTF-8 时变成 `?` 或乱码。
 *
 * 这个问题是**测试抓出来的**：`emoji 不应被切成两半` 一开始就是红的。
 * 现在的实现遍历码点，一个 emoji 整体落在同一片里。
 */
internal fun String.chunkByUtf8Bytes(maxBytes: Int): List<String> {
    if (this.isEmpty()) return emptyList()

    val chunks = mutableListOf<String>()
    val current = StringBuilder()
    var bytes = 0

    // 按码点遍历：charCount 为 1（BMP）或 2（代理对）
    var index = 0
    while (index < length) {
        val codePoint = codePointAt(index)
        val charCount = Character.charCount(codePoint)
        val piece = substring(index, index + charCount)
        val len = piece.toByteArray(Charsets.UTF_8).size

        // 单片本身就超限（例如 maxBytes 极小）：仍整块放进去，避免死循环
        if (bytes + len > maxBytes && current.isNotEmpty()) {
            chunks.add(current.toString())
            current.setLength(0)
            bytes = 0
        }
        current.append(piece)
        bytes += len
        index += charCount
    }

    if (current.isNotEmpty()) chunks.add(current.toString())
    return chunks
}

/**
 * 虚拟键盘的键位表（对齐 web `control/app/js/phone.js` 的键盘定义）。
 *
 * 形状与 web 一致：主键区 + 修饰键区（Ctrl/Shift/Alt/Win）。
 */
object VirtualKeyboard {

    /** 修饰键（web 的 `.vk-mods`） */
    val MODIFIERS = listOf("ctrl", "shift", "alt", "win")

    /** 主键区逐行（web 的 `#vkBody`）。每行是一个 List of 显示文本。 */
    val ROWS: List<List<String>> = listOf(
        listOf("esc", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "del"),
        listOf("`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "backspace"),
        listOf("tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"),
        listOf("caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "enter"),
        listOf("shift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "shift"),
        listOf("ctrl", "win", "alt", "space", "alt", "win", "ctrl"),
    )

    /** 显示文本 → 发给服务端的 key 名。多数同名，少数需要映射。 */
    fun toKeyName(label: String): String = when (label) {
        "esc" -> "escape"
        "backspace" -> "backspace"
        "del" -> "delete"
        "caps" -> "capslock"
        "enter" -> "enter"
        "space" -> "space"
        // 单字符键直接发字符本身
        else -> label
    }

    /**
     * 字母键要用**大写**发给服务端。
     *
     * ## ★ 这是修掉的一个真实 bug（用户反馈："点字母，电脑收到的却是些快捷键"）
     *
     * 桌面端 `resolve_vk`（`src-tauri/src/control.rs`）对单字符的处理是：
     *
     * ```rust
     * if bytes.len() == 1 && bytes[0].is_ascii_alphabetic() {
     *     return Some(bytes[0] as u32);   // 'a' → 0x61
     * }
     * ```
     *
     * 而 `inject.ps1` 的 `SendVk` 直接把这个值当 **Windows 虚拟键码（VK）** 发给
     * `SendInput`。可 Windows 的字母键 VK 是**大写 ASCII**：
     *
     * | 键 | 正确 VK | 用小写会变成 |
     * |---|---|---|
     * | A | `0x41` | `0x61` = **VK_NUMPAD1（小键盘 1）** |
     * | B | `0x42` | `0x62` = 小键盘 2 |
     * | … | … | 依次错位到小键盘数字 |
     * | Z | `0x5A` | `0x7A` = **VK_F11** |
     *
     * 也就是说小写字母会落到**小键盘数字和 F 键**上 ——
     * 用户看到的就是"点字母出来的是些快捷键"。
     *
     * 修法：字母一律发**大写**。数字与符号的 VK 恰好与 ASCII 一致（`'1'`=0x31 正确），
     * 所以只有字母需要转换。
     */
    fun toServerKey(label: String): String {
        val name = toKeyName(label)
        return if (name.length == 1 && name[0] in 'a'..'z') name.uppercase() else name
    }
}
