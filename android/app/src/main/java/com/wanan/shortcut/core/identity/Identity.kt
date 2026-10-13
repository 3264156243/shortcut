package com.wanan.shortcut.core.identity

/**
 * 当前身份快照。
 *
 * 这是全应用**唯一**的身份真相：所有网络请求的 `bindId` / `mobileToken` 都从这里取，
 * 板块层不允许自己去读 DataStore（否则会出现"某一处忘了带 token"这类问题，
 * 而服务端对不带凭证的请求会直接拒绝，契约 §1.3 判定顺序第 3 条）。
 */
data class Identity(
    /** 24 位 base62，标识一个"电脑↔手机"的绑定关系 */
    val bindId: String,
    /** 48 位 hex；服务端只存 sha256，明文只在签发时返回一次（契约 §1.3） */
    val mobileToken: String,
    /** 本机稳定标识，见 [DeviceKey] */
    val deviceKey: String,
    /** 服务端登记的设备 id（24 hex），绑定成功后回填 */
    val deviceId: String,
    /** 本机显示名 */
    val deviceName: String,
) {
    /** 是否已具备可用身份（未绑定时不应发起需要鉴权的请求） */
    val isBound: Boolean
        get() = bindId.isNotBlank() && mobileToken.isNotBlank()
}

/** 未绑定时的空身份，避免到处写 null 判断。 */
val EmptyIdentity = Identity(
    bindId = "",
    mobileToken = "",
    deviceKey = "",
    deviceId = "",
    deviceName = "",
)
