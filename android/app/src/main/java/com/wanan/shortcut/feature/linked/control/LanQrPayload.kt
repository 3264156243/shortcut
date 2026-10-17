package com.wanan.shortcut.feature.linked.control

/**
 * 解析桌面端「局域网直连」状态卡上的二维码。
 *
 * ## 二维码里到底是什么（读桌面端源码确认）
 *
 * `src/components/ControlPanel.tsx:57-72`：
 *
 * ```
 * 局域网模式：  http://192.168.x.x:9823/?token=<预授权令牌>
 * 云端模式：    https://shortcut.326415.xyz/control/app/
 * ```
 *
 * 局域网那个是**带预授权令牌的**入口 —— 桌面端注释说得很清楚：
 * "扫码即连，不用输地址与绑定码"。
 *
 * ## 为什么值得单独写解析并测试
 *
 * 用户真实场景是"拿手机扫电脑屏幕"，一旦解析错（比如把 `?token=` 后的
 * 参数当成 host，或没识别出这是 ShortCut 的码），表现为"扫了没反应"，
 * 很难解释。所以这里把各种可能扫到的东西都用测试固化：
 *   - 带 token 的局域网地址（主要路径）
 *   - 不带 token 的纯地址（桌面端在 lanEntry 未就绪时会退化成 urls[0]）
 *   - 云端控制页地址（应明确拒绝，提示改用云端连接）
 *   - 绑定二维码（不应被误认为控制码）
 *   - 乱七八糟的内容
 */
object LanQrPayload {

    /** 解析结果 */
    sealed interface Result {
        /**
         * 可直连的局域网地址。
         *
         * @param host `host:port`
         * @param token 预授权令牌；空串表示二维码里没带（需要再走配对流程）
         */
        data class Lan(val host: String, val token: String) : Result

        /** 扫到的是云端控制页（不是局域网码） */
        data object CloudControlPage : Result

        /** 不认识的二维码 */
        data class Unknown(val reason: String) : Result
    }

    /** 默认端口：桌面端局域网服务默认 9823（contract §8.3） */
    const val DEFAULT_PORT = "9823"

    fun parse(raw: String?): Result {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty()) return Result.Unknown("二维码内容为空")

        // 云端控制页：明确区分，避免用户以为扫错了
        if (text.contains("326415.xyz") && text.contains("/control")) {
            return Result.CloudControlPage
        }

        // 只处理 http(s) 地址
        if (!text.startsWith("http://", ignoreCase = true) &&
            !text.startsWith("https://", ignoreCase = true)
        ) {
            return Result.Unknown(
                if (text.startsWith("shortcut:", ignoreCase = true)) {
                    "这是绑定用的二维码，不是控制连接码"
                } else {
                    "这不是 ShortCut 的控制连接码"
                },
            )
        }

        // 去掉协议头，按第一个 / 切成 host 与 path+query
        val withoutScheme = text.substringAfter("://")
        val hostPart = withoutScheme.substringBefore('/').substringBefore('?')
        if (hostPart.isBlank()) return Result.Unknown("二维码里没有地址")

        val queryPart = withoutScheme.substringAfter('?', "")
        val token = extractToken(queryPart)

        // 补默认端口（只对没有端口的形式补）
        val host = if (hostPart.contains(':') && !hostPart.startsWith("[[")) {
            hostPart
        } else if (hostPart.contains(':')) {
            hostPart
        } else {
            "$hostPart:$DEFAULT_PORT"
        }

        return Result.Lan(host = host, token = token)
    }

    /** 从 query 串里取 token 参数（手写解析，不引入额外依赖） */
    private fun extractToken(query: String): String {
        if (query.isBlank()) return ""
        return query.split('&')
            .firstOrNull { it.startsWith("token=") }
            ?.substringAfter("token=")
            ?.let { urlDecode(it) }
            ?.trim()
            .orEmpty()
    }

    /** 最小 URL 解码（处理 %XX；token 里可能出现被编码的字符） */
    private fun urlDecode(value: String): String {
        if (!value.contains('%')) return value
        return runCatching {
            java.net.URLDecoder.decode(value, "UTF-8")
        }.getOrDefault(value)
    }
}
