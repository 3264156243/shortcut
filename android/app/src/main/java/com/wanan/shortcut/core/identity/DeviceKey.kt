package com.wanan.shortcut.core.identity

import java.security.SecureRandom

/**
 * 本机稳定标识 `deviceKey`（契约 §3.4 的**头号陷阱**）。
 *
 * 服务端据它决定重绑是「原地轮换」还是「新增一台」：
 *   1. deviceKey 完全相同 → 原地轮换（deviceId 不变、boundAt 保留）
 *   2. 都没有 deviceKey 的旧手机行 → 就地接管
 *   3. 都不匹配 → **新增一台**，很快占满上限（默认 5）
 *
 * 实测确认（2026-10-13）：同一 deviceKey 重绑 → deviceId 不变；换 deviceKey → 新增设备。
 *
 * ⚠️ 契约明确：**不要用 `ANDROID_ID`** 之类可能变化的值，必须是本地随机生成 + 长期持久化
 * （等价 Web 端 `shortcut-device-key-v1`，24 位 hex）。
 */
object DeviceKey {

    /** 24 位 hex = 12 字节随机，与 Web 端长度一致 */
    private const val HEX_LEN = 24
    private const val BYTE_LEN = HEX_LEN / 2

    private val random = SecureRandom()

    /**
     * 生成一个新的 deviceKey（24 位小写 hex）。
     *
     * 用 [SecureRandom] 而非 `Random`：避免多台设备上电初期产生相同序列
     * （一旦碰撞，两台手机的 deviceKey 相同会被服务端判为同一台，互相顶掉凭证）。
     */
    fun generate(): String {
        val bytes = ByteArray(BYTE_LEN)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /** 校验形状，用于发现存储损坏（损坏则重新生成，宁可新增设备也不要静默用坏值）。 */
    fun isValid(key: String): Boolean =
        key.length == HEX_LEN && key.all { it in '0'..'9' || it in 'a'..'f' }
}
