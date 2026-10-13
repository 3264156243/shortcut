package com.wanan.shortcut.framework

import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.core.result.getOrNull

/**
 * ★ **模块注册表** —— "加板块只改一个文件"的那个文件。
 *
 * 用法（唯一需要改的地方）：
 * ```kotlin
 * object Modules {
 *     fun all(): List<ShortcutModule> = listOf(
 *         TaskwallModule(),      // ← 加板块就在这里加一行
 *         ControlModule(),
 *     )
 * }
 * ```
 *
 * 本类负责把"本地注册的板块"与"服务端声明的模块"对账，产出可渲染的入口列表。
 * 板块作者不需要写任何对账代码。
 */
class ModuleRegistry(
    private val modules: List<ShortcutModule>,
    private val apiClient: ApiClient,
) {

    /** 按 id 索引，供导航/实时消息分发使用 */
    private val byId: Map<String, ShortcutModule> = modules.associateBy { it.id }

    fun get(id: String): ShortcutModule? = byId[id]

    fun all(): List<ShortcutModule> = modules

    /**
     * 拉取服务端模块清单（契约 §4.1）。
     *
     * **不需要身份**也能调用（服务端会降级为 `bound:false` 而不是报错），
     * 因此首页可以在未绑定时先渲染模块列表，提升首屏体验。
     */
    suspend fun fetchManifest(): ApiResult<ModuleListResponse> =
        when (val r = apiClient.post("module.list", requireIdentity = false)) {
            is ApiResult.Ok -> {
                val parsed = try {
                    Json.gson.fromJson(r.data, ModuleListResponse::class.java)
                } catch (e: Exception) {
                    null
                }
                if (parsed == null) {
                    ApiResult.TransportFail(ApiResult.TransportFail.Kind.BAD_RESPONSE)
                } else {
                    ApiResult.Ok(parsed)
                }
            }
            is ApiResult.BusinessFail -> r
            is ApiResult.TransportFail -> r
            ApiResult.Unauthorized -> ApiResult.Unauthorized
        }

    /**
     * 对账：本地板块 ∩ 服务端模块 → 可显示的入口列表。
     *
     * 规则（契约 §4.1）：
     *   1. 服务端没有声明该 id → 不显示（服务端可下发关闭某板块）
     *   2. `enabled == false` 或无 `entry` → 不显示
     *   3. `minAppVersion` 高于当前客户端 → 显示但标记"需升级"，
     *      而不是直接隐藏（隐藏会让用户困惑"功能去哪了"，契约 §10.2 陷阱 #8）
     *
     * @param manifest 服务端清单；为 null（拉取失败）时**降级**为本地全量，
     *                 保证断网也能看到入口，只是不享受服务端下发的启停控制。
     */
    fun resolve(manifest: ModuleListResponse?, currentAppVersion: String): List<ModuleEntry> {
        if (manifest == null) {
            return modules.map { module ->
                ModuleEntry(
                    module = module,
                    label = module.meta.label,
                    icon = module.meta.icon,
                    desc = module.meta.desc,
                    requiresUpgrade = false,
                )
            }
        }

        val serverById = manifest.modules.associateBy { it.id }

        return modules.mapNotNull { module ->
            val server = serverById[module.id] ?: return@mapNotNull null
            if (!server.isDisplayable) return@mapNotNull null

            // 服务端字段优先，缺失时回落本地 meta（服务端可能不填 label/icon）
            val label = server.label.ifBlank { module.meta.label }
            val icon = server.icon.ifBlank { module.meta.icon }
            val desc = server.desc.ifBlank { module.meta.desc }

            val required = server.minAppVersion.ifBlank { module.meta.minAppVersion.orEmpty() }

            ModuleEntry(
                module = module,
                label = label,
                icon = icon,
                desc = desc,
                requiresUpgrade = !VersionGate.satisfies(currentAppVersion, required),
            )
        }
    }

    /**
     * 广播一条实时消息给所有板块。
     *
     * 一处收包 → 全员分发，避免每个板块各建一条 WS 连接
     * （契约 §7.6：每 bindId 连接上限只有 3，多连会直接 `too many connections`）。
     */
    fun dispatchRealtime(message: com.wanan.shortcut.core.realtime.RelayMessage) {
        modules.forEach { it.onRealtimeMessage(message) }
    }
}

/** 一个可渲染的模块入口。 */
data class ModuleEntry(
    val module: ShortcutModule,
    val label: String,
    val icon: String,
    val desc: String,
    /** true 表示客户端版本低于该模块要求，UI 应提示升级而非进入 */
    val requiresUpgrade: Boolean,
)
