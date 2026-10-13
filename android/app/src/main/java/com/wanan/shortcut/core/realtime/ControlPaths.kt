package com.wanan.shortcut.core.realtime

/**
 * 指令白名单（契约 §7.4）——**完整 11 个，一次写全**。
 *
 * 为什么现在就写全：白名单是服务端强制的（不在名单内的 path 会被中继直接回
 * 400 `path not allowed`，不转发给桌面）。把它作为常量固化，P2 实现控制面板时
 * 就无法"发明"一个不存在的接口；同时单元测试可以断言数量为 11，
 * 服务端将来加接口时这条测试会失败并提醒我们同步。
 */
object ControlPaths {

    const val PING = "/api/ping"
    const val TYPE = "/api/type"
    const val KEY = "/api/key"
    const val COMBO = "/api/combo"
    const val MOUSE = "/api/mouse"
    const val CLICK = "/api/click"
    const val WHEEL = "/api/wheel"
    const val CLIPBOARD_REFRESH = "/api/clipboard/refresh"
    const val CLIPBOARD_PASTE = "/api/clipboard/paste"
    const val CLIPBOARD_CLEAR = "/api/clipboard/clear"
    const val LAN_ENTRY = "/api/lan-entry"

    /** 全部白名单路径，数量应与契约 §7.4 一致（11 个）。 */
    val ALL: Set<String> = setOf(
        PING, TYPE, KEY, COMBO, MOUSE, CLICK, WHEEL,
        CLIPBOARD_REFRESH, CLIPBOARD_PASTE, CLIPBOARD_CLEAR, LAN_ENTRY,
    )

    /** 契约 §7.4：桌面端未开「云端连接」时，仅这两个接口仍可用。 */
    val ALLOWED_WHEN_CHANNEL_DISABLED: Set<String> = setOf(PING, LAN_ENTRY)
}
