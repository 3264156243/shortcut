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
    /**
     * 该模块要求的**客户端版本**下限。
     *
     * ⚠️ **不要用它给安卓端做门禁**（这是踩过的坑，2026-10-13）：
     * 这个字段里的值是**桌面端**的版本号（当前线上是 `2.4.5`，来自 `modules.json`），
     * 而安卓端是自己的版本体系（`0.1.0`）。两者**不同源**，直接比较必然失败，
     * 结果是任务墙/快传/控制全部被永久锁死并显示"需升级"。
     *
     * 保留该字段仅用于诊断展示。安卓端门禁请用 [minAndroidVersion]。
     */
    @SerializedName("minAppVersion") val minAppVersion: String = "",
    /**
     * 该模块要求的**安卓端**版本下限（**服务端当前未下发此字段**）。
     *
     * 命名里带 `Android` 是为了从字段名上就区分版本命名空间，
     * 避免再犯"拿桌面版本号卡安卓客户端"的错误。
     * 为空表示不门禁 —— 即当前的实际行为。
     */
    @SerializedName("minAndroidVersion") val minAndroidVersion: String = "",
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
 * 版本比较：判断安卓客户端是否满足某个版本下限。
 *
 * ⚠️ **只在安卓端自己的版本体系内比较**（例如 `0.1.0` vs `0.2.0`）。
 * 绝不能拿它去比 [ServerModule.minAppVersion]（那是桌面端版本号，见该字段注释）。
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
