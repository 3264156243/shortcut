package com.wanan.shortcut.core.error

/**
 * 客户端应采取的恢复动作。
 *
 * 契约把**错误文案当字符串契约**（§1.3 明确"客户端要按文案分支"），
 * 所以映射集中在 [ErrorMapper] 一处，板块层只消费这个枚举，
 * 不允许在任何业务代码里出现 `if (msg == "移动端绑定已失效，请重新绑定")`。
 */
enum class ErrorAction {
    /** 清除本地身份 + 跳绑定页（全局一次，由 IdentityProvider 保证幂等） */
    REBIND,

    /** 操作过于频繁：提示 + 退避重试，不清理任何状态 */
    RATE_LIMITED,

    /** 停留在当前页，提示用户换一个输入（如绑定码无效） */
    INVALID_INPUT,

    /** 需要展示服务端原文（含"去电脑端移除设备"这类可操作指引） */
    SHOW_SERVER_MESSAGE,

    /** 一般性提示 */
    SHOW_MESSAGE,
}

/**
 * 服务端文案 → 客户端动作。
 *
 * ⚠️ 这里的字符串**必须与服务端完全一致**（含标点），因为服务端把它们当契约。
 * 若哪天文案变了，改这里一处即可（这正是收口的目的）。
 */
class ErrorMapper {

    /**
     * 是否为"身份失效"类错误。
     *
     * 来自契约 §1.3 的失败文案表：
     *   - `移动端绑定已失效，请重新绑定` ← 出示了 mobileToken 但无效
     *   - `绑定身份无效`                 ← bindId 为空/不存在
     *   - `缺少 bindId`
     *
     * 注意**不包含** `凭证已失效，请重新绑定或升级客户端`（那是桌面端 deskToken 的文案）
     * 与 `请升级 ShortCut 到最新版（缺少桌面端凭证）`（无凭证兜底），
     * 安卓端属于 mobile 角色，不会遇到这两条。
     */
    fun isTokenRejected(message: String): Boolean =
        message.contains(TOKEN_MOBILE_EXPIRED) ||
            message.contains(BIND_IDENTITY_INVALID) ||
            message.contains(MISSING_BIND_ID)

    fun map(message: String): ErrorAction = when {
        isTokenRejected(message) -> ErrorAction.REBIND

        // 限流文案的共同特征是"过于频繁"（契约 §1.4 各 action 的超限文案）
        message.contains(RATE_LIMIT_HINT) -> ErrorAction.RATE_LIMITED

        // 绑定码相关的输入错误：留在绑定页让用户重输，不要清身份（此时本来也没身份）。
        // 契约 §2.2/§2.6 里这两条都会出现：`绑定码为空`、`绑定码无效`。
        message.contains(BIND_CODE_INVALID) || message.contains(BIND_CODE_EMPTY) ->
            ErrorAction.INVALID_INPUT

        // 手机数达上限：必须原样展示，因为文案里含"去电脑端移除设备"的操作指引
        message.contains(DEVICE_LIMIT_HINT) -> ErrorAction.SHOW_SERVER_MESSAGE

        else -> ErrorAction.SHOW_MESSAGE
    }

    companion object {
        // ---- 契约 §1.3 身份文案 ----
        const val TOKEN_MOBILE_EXPIRED = "移动端绑定已失效，请重新绑定"
        const val BIND_IDENTITY_INVALID = "绑定身份无效"
        const val MISSING_BIND_ID = "缺少 bindId"

        // ---- 契约 §2.6 mobile.bind 失败文案 ----
        const val BIND_CODE_INVALID = "绑定码无效"
        const val BIND_CODE_EMPTY = "绑定码为空"
        const val DEVICE_LIMIT_HINT = "已达上限"

        // ---- 契约 §1.4 限流文案共同特征 ----
        const val RATE_LIMIT_HINT = "过于频繁"
    }
}
