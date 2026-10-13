package com.wanan.shortcut.core.realtime

/**
 * 中继消息模型（契约 §7.3）。字段名与协议**逐字对齐**，不重命名。
 *
 * 用一个密封类表达"客户端收到的消息有哪些"，好处是 P2 实现实时通道时
 * `when` 是穷尽的——协议新增消息类型时编译器会直接报错提醒，而不是静默忽略。
 */
sealed interface RelayMessage {

    /** `{t:'auth-ok', role, bindId, desktopOnline}` */
    data class AuthOk(
        val role: String,
        val bindId: String,
        /**
         * ⚠️ **只有手机收得到**（契约 §7.3）；桌面端该字段被省略。
         * 缺省 false，避免"服务端没给就被当成在线"。
         */
        val desktopOnline: Boolean,
    ) : RelayMessage

    /** `{t:'auth-fail', error}` —— 随后中继立即断开 */
    data class AuthFail(val error: String) : RelayMessage

    /** `{t:'pong', now}` */
    data class Pong(val now: Long) : RelayMessage

    /** `{t:'desktop-status', online}` —— **仅发手机**：桌面上下线通知 */
    data class DesktopStatus(val online: Boolean) : RelayMessage

    /** `{t:'sync-wake', board, count}` —— **仅发桌面** */
    data class SyncWake(val board: String, val count: Int) : RelayMessage

    /** `{t:'api', id, path, body}` —— 中继转发给桌面的指令 */
    data class Api(val id: String, val path: String) : RelayMessage

    /**
     * `{t:'api-res', id, ok, status, data}` —— 桌面端的指令回执。
     *
     * ⚠️ 契约 §7.3：`api-res` 是**房间广播**（发给该 bindId 房间内所有手机），
     * 安卓端**必须用自己的 `id` 过滤**，且 `id` 要按 **String** 归一化比较
     * （中继回包时未做类型强转，可能是数字 2 也可能是字符串 "2"）。
     * 归一化在 [RelayMessage] 的构造处完成，防止调用方漏做。
     */
    data class ApiRes(
        val id: String,
        val ok: Boolean,
        val status: Int,
        val error: String?,
    ) : RelayMessage

    /** 协议外的未知消息：保留原文，便于排查协议演进。 */
    data class Unknown(val type: String) : RelayMessage
}
