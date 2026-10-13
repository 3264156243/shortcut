package com.wanan.shortcut.core.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 时间格式（契约 §1.2 的时间字段规则）。
 *
 * 契约里时间字段有**两种互不相同的格式**，必须分开处理：
 *
 * | 字段 | 格式 | 例 |
 * |---|---|---|
 * | 服务端生成的时间（如 `createdAt`、`boundAt`） | ISO-8601 **带 `+08:00` 偏移**（PHP `date('c')`） | `2026-10-13T10:02:04+08:00` |
 * | `reminderAt`（客户端原样透传） | 网页端发 **UTC `Z`**，服务端不解析不改写 | `2026-10-13T11:02:04.000Z` |
 *
 * 用 `SimpleDateFormat(XXX)` 而不是 `java.time`：本项目 `minSdk 24`，
 * 而 `java.time` 需要 API 26 或开启 core library desugaring。
 * 为了不为此引入脱糖配置，这里用等价的 `SimpleDateFormat` 实现。
 */
object DateFormats {

    /** 解析服务端生成的时间（`+08:00` 形式，PHP `date('c')`）。 */
    private const val SERVER_PATTERN_OFFSET = "yyyy-MM-dd'T'HH:mm:ssXXX"

    /** 兜底：少数字段可能不带时区偏移。 */
    private const val SERVER_PATTERN_PLAIN = "yyyy-MM-dd'T'HH:mm:ss"

    /** 生成 `reminderAt`：与网页端 `new Date(x).toISOString()` 形状一致。 */
    private const val ISO_UTC_PATTERN = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

    /**
     * 构造一个**非宽松**的格式器。
     *
     * ⚠️ 必须 `isLenient = false`：`SimpleDateFormat` 默认宽松，
     * `2026-13-45T99:99:99` 这种非法值会被"进位"成一个看似正常的日期，
     * 于是解析失败被悄悄吞掉、界面上显示出一个离谱的时间。
     * 单测 `解析失败应返回 null 而不是抛异常` 就是为这个 bug 写的。
     */
    private fun formatter(pattern: String, tz: TimeZone? = null) =
        SimpleDateFormat(pattern, Locale.US).apply {
            isLenient = false
            if (tz != null) timeZone = tz
        }

    /**
     * 把本地时间（毫秒）转成 `reminderAt` 用的 UTC 字符串。
     *
     * ⚠️ 必须是 UTC：网页端参考实现发的是 `toISOString()` 的 UTC 形式。
     * 若发本地时间且不带偏移，服务端虽"原样透传"，但桌面端解析出的提醒时刻会偏 8 小时。
     */
    fun toIsoUtc(epochMillis: Long): String =
        formatter(ISO_UTC_PATTERN, TimeZone.getTimeZone("UTC")).format(Date(epochMillis))

    /**
     * 把服务端时间解析成毫秒；解析失败返回 null（**不抛异常**，
     * 因为一条任务的显示时间不该让整个列表崩掉）。
     *
     * 依次尝试"带偏移"与"不带偏移"两种形状——服务端不同字段的形态并不统一。
     */
    fun parseServerTime(raw: String): Long? {
        if (raw.isBlank()) return null
        return try {
            formatter(SERVER_PATTERN_OFFSET).parse(raw)?.time
        } catch (e: Exception) {
            try {
                formatter(SERVER_PATTERN_PLAIN).parse(raw)?.time
            } catch (e2: Exception) {
                null
            }
        }
    }

    /** 展示用的相对/短时间文本。 */
    fun formatForDisplay(raw: String): String {
        val millis = parseServerTime(raw) ?: return raw
        return SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(millis))
    }

    /**
     * 把 `reminderAt`（可能是任意格式、属于用户自己输入）转成人类可读文本。
     * 优先按 UTC `Z` 解析；失败则原样返回（服务端确实允许任意可解析格式）。
     */
    fun formatReminder(raw: String): String {
        if (raw.isBlank()) return ""
        val utc = try {
            formatter(ISO_UTC_PATTERN, TimeZone.getTimeZone("UTC")).parse(raw)?.time
        } catch (e: Exception) {
            null
        }
        val millis = utc ?: parseServerTime(raw) ?: return raw
        return SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(millis))
    }
}
