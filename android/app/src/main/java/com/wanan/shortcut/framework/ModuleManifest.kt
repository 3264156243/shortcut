package com.wanan.shortcut.framework

import com.google.gson.annotations.SerializedName

/**
 * 服务端 `module.list` 的响应模型（契约 §4.1）。
 *
 * 客户端**由它渲染首页入口与模块启停**，不硬编码模块清单
 * （契约 §4.1 明确："服务端加模块时客户端零改动"）。
 * 名称逐字对齐线上字段，不做 camelCase 转换。
 */
data class ModuleListResponse(
    @SerializedName("version") val version: Int = 0,
    @SerializedName("protocolVersion") val protocolVersion: Int = 0,
    @SerializedName("clientProtocol") val clientProtocol: Int = 0,
    @SerializedName("modules") val modules: List<ServerModule> = emptyList(),
    @SerializedName("bound") val bound: Boolean = false,
    @SerializedName("side") val side: String = "",
)

/**
 * 一个服务端声明的模块。
 *
 * 注意字段类型不假设：线上 `policy` 既可能是 `[]`（空数组）也可能是对象
 * （contract §4.1 样本里 taskwall 的 policy 就是 `[]`）。
 * 因此 [policy] 声明为 `Any?` 交给使用方按需取——
 * 若强行声明成对象，Gson 解析 `[]` 时会抛异常，导致整个首页渲染失败。
 */
data class ServerModule(
    @SerializedName("id") val id: String = "",
    @SerializedName("label") val label: String = "",
    @SerializedName("icon") val icon: String = "",
    @SerializedName("desc") val desc: String = "",
    @SerializedName("entry") val entry: String = "",
    @SerializedName("capabilities") val capabilities: List<String> = emptyList(),
    /** 该模块要求的客户端版本下限（服务端**不强制**，是否门禁由客户端决定，契约 §4.1） */
    @SerializedName("minAppVersion") val minAppVersion: String = "",
    /** 缺省 true（契约 §4.1：来自 defaultEnabled） */
    @SerializedName("enabled") val enabled: Boolean = true,
    /** 可能是数组也可能是对象，见类注释 */
    @SerializedName("policy") val policy: Any? = null,
) {
    /**
     * 该模块是否应当显示入口。
     *
     * 契约 §4.1：客户端应跳过 `enabled === false` **或**无 `entry` 的模块。
     */
    val isDisplayable: Boolean
        get() = enabled && entry.isNotBlank()
}

/**
 * 版本比较：判断客户端是否满足模块的 [ServerModule.minAppVersion]。
 *
 * 契约 §4.1 明确服务端不做任何强制，门禁完全由客户端决定；
 * 但客户端也**不应该**因为版本低就拒绝服务——只提示、不崩溃。
 * 版本号形如 "2.4.5"，按数字段比较。
 */
object VersionGate {

    /**
     * @return true 表示 [current] >= [required]；任一方无法解析时返回 true（宁放行不误伤）。
     */
    fun satisfies(current: String, required: String): Boolean {
        if (required.isBlank()) return true
        val c = parse(current) ?: return true
        val r = parse(required) ?: return true
        val size = maxOf(c.size, r.size)
        for (i in 0 until size) {
            val a = c.getOrElse(i) { 0 }
            val b = r.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return true
    }

    /**
     * 解析版本号；**无法解析时返回 null**（调用方据此放行）。
     *
     * ⚠️ 这里必须真的判"不可解析"，而不是把非数字段当 0：
     * 早期实现用 `takeWhile(isDigit).ifBlank { "0" }`，会把 "abc" 静默解析成 `[0]`，
     * 于是 `satisfies("abc", "2.4.5")` 得到 false（0 < 2）——
     * 即"版本号读不出来"被误判成"版本太低"，会把用户挡在功能外。
     * 单测 `空要求或无法解析时应放行而不是误伤` 就是为这个 bug 写的。
     */
    private fun parse(v: String): List<Int>? {
        val parts = v.trim().split('.')
        // 非空、且每段都以数字开头，才认为是合法版本号
        if (parts.any { it.isEmpty() || !it[0].isDigit() }) return null
        return try {
            parts.map { part ->
                val digits = part.takeWhile(Char::isDigit)
                if (digits.isEmpty()) return null
                digits.toInt()
            }
        } catch (e: NumberFormatException) {
            // 溢出等极端情况，同样按"不可解析"处理
            null
        }
    }
}
