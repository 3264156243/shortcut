package com.wanan.shortcut.feature.bind.scan

/**
 * 二维码内容解析。
 *
 * ## 对齐 web 的两条路径（`server/sync/web/bind/index.html`）
 *
 * web 的 `connectWithScannedValue()` 接受**两种**二维码内容，本类与之逐条对齐：
 *
 * | 扫码内容 | 处理 | web 依据 |
 * |---|---|---|
 * | `https://…/mobile/?bind=<bindId>` | 用 **bindId** 直接绑定 | `u.searchParams.get('bind')` |
 * | `https://…/bind/?code=XXXXXX` | 用 **code** 绑定 | `u.searchParams.get('code')` |
 * | 裸 6 位码（如 `F92XSE`） | 当 **code** 用 | `/^[A-Z0-9]{6}$/i` 分支 |
 *
 * web 的顺序是：**先尝试 bindId，失败或没有则用 code**。
 *
 * ## 为什么解析要单独成类
 *
 * 摄像头/图片识别部分依赖 Android 运行时，难以纯 JVM 测试；
 * 而"扫到什么内容 → 用哪个字段绑定"这段**纯逻辑**恰恰是最容易写错的
 * （例如把 bindId 当成 code 发出去 → 服务端回 `绑定码无效`）。
 * 抽出来之后可以用单测把各种二维码内容形态全部锁死。
 */
object ScanPayloadParser {

    /** 6 位绑定码的形状（契约 §2.1：`[0-9A-Z]`）。 */
    private val CODE_REGEX = Regex("^[0-9A-Za-z]{6}$")

    /** 解析结果：两种凭证二选一（至少一个非空）。 */
    data class Parsed(
        /** 来自二维码 URL 的 `?bind=` —— 24 位 base62 的绑定 id */
        val bindId: String? = null,
        /** 来自 `?code=` 或裸 6 位码 */
        val code: String? = null,
    ) {
        val isEmpty: Boolean get() = bindId.isNullOrBlank() && code.isNullOrBlank()
    }

    /**
     * 解析扫码/识图得到的原始字符串。
     *
     * @return 解析结果；无法识别出任何凭证时返回 [Parsed] 的 empty 实例（调用方据此提示"无效二维码"）
     */
    fun parse(raw: String?): Parsed {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return Parsed()

        // 1) 先按 URL 解析（二维码最常见的是桌面端生成的绑定链接）
        val fromUrl = parseAsUrl(value)
        if (!fromUrl.isEmpty) return fromUrl

        // 2) 不是 URL：看是否恰好是 6 位码
        //    （web 也是这个顺序：URL 解析不出东西才当裸码）
        if (CODE_REGEX.matches(value)) {
            return Parsed(code = value.uppercase())
        }

        // 3) 兜底：形如 "F92XSE" 但夹了空白/其他字符时，尝试从中提取 6 位码。
        //    严格的形状校验仍由服务端裁决（这里放宽只是为了容错扫描噪声）。
        val compact = value.filter { it.isLetterOrDigit() }
        if (CODE_REGEX.matches(compact)) return Parsed(code = compact.uppercase())

        return Parsed()
    }

    /**
     * 从 URL 中取 `bind` / `code` 查询参数。
     *
     * 不依赖 `java.net.URL`/`URI`：二维码里可能是自定义 scheme（如 `shortcut://…`），
     * 用 `URL` 解析会抛异常。这里用"找 `?` 后手工拆参"的方式，
     * 与 web 的 `new URL(v, location.origin)` + `searchParams` 行为等价，但更宽容。
     */
    private fun parseAsUrl(value: String): Parsed {
        val queryStart = value.indexOf('?')
        // 没有查询串就不可能是绑定链接（例如纯文本二维码）
        if (queryStart < 0) return Parsed()

        val query = value.substring(queryStart + 1)
        var bindId: String? = null
        var code: String? = null

        query.split('&').forEach { pair ->
            val eq = pair.indexOf('=')
            if (eq <= 0) return@forEach
            val key = pair.substring(0, eq).trim().lowercase()
            val rawValue = pair.substring(eq + 1).trim()
            // ⚠️ 先解码再 trim：`%20` 这类编码后的空白必须解码后才会显现，
            // 若先 trim 再解码，尾部会残留一个空格 → bindId 变成无效值。
            val decoded = urlDecode(rawValue).trim()

            when (key) {
                "bind" -> if (decoded.isNotBlank()) bindId = decoded
                "code" -> if (CODE_REGEX.matches(decoded)) code = decoded.uppercase()
            }
        }

        return Parsed(bindId = bindId, code = code)
    }

    /**
     * 最小化的百分号解码。
     *
     * 不用 `java.net.URLDecoder`：它对 `+` 会解成空格，
     * 而 base62 的 bindId 里 `+` 不出现、但万一出现也不该被当空格。
     * 这里只处理 `%XX`，行为更可预期。
     */
    private fun urlDecode(s: String): String {
        if ('%' !in s) return s
        val out = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            // 需要 i 之后还有两位十六进制数字
            if (c == '%' && i + 2 < s.length) {
                val v = s.substring(i + 1, i + 3).toIntOrNull(16)
                if (v != null) {
                    out.append(v.toChar())
                    i += 3
                    continue
                }
            }
            out.append(c)
            i++
        }
        return out.toString()
    }
}
