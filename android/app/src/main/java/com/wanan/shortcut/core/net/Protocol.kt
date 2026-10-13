package com.wanan.shortcut.core.net

/**
 * 协议版本常量。
 *
 * 契约 §1.2 / §4.1：服务端**不校验、不协商、不拒绝** `protocolVersion`，
 * 版本兼容**完全由客户端自己判断**（契约 §10.2 陷阱 #8）。
 * 所以这里只做"回显 + 本地比对 + 记录日志"，不做拒服务。
 */
object Protocol {
    /** 对应服务端 `SYNC_PROTOCOL_VERSION`（当前为 1，见契约 §4.1） */
    const val VERSION = 1

    /**
     * 与服务端回显的 protocolVersion 比对。
     * @return true 表示一致；不一致只在设置页/日志里提示，不阻断使用。
     */
    fun isCompatible(serverProtocolVersion: Int): Boolean = serverProtocolVersion == VERSION
}
