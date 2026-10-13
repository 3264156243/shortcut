package com.wanan.shortcut.framework

import com.wanan.shortcut.core.net.ApiGateway
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult

/**
 * ★ **模块注册表** —— "加板块只改一个文件"的那个文件（`Modules.kt`）所产出的东西。
 *
 * 职责：把三个来源合成首页要显示的列表 ——
 *   1. **本地注册的板块**（[modules]，含本机与联动两类）
 *   2. **服务端清单**（`module.list`，**只作用于联动板块**）
 *   3. **用户布局覆盖**（[HomeLayout]，本轮为默认值）
 *
 * P0 版的错误在于第 1 步只认服务端声明的 id（`serverById[id] ?: return null`），
 * 导致纯本机板块永远出不来。现在两类域走不同路径。
 */
class ModuleRegistry(
    private val modules: List<ShortcutModule>,
    private val apiClient: ApiGateway,
) {

    private val byId: Map<String, ShortcutModule> = modules.associateBy { it.spec.id }

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
     * 合成首页入口列表（设计文档 §3.2）。
     *
     * 规则：
     *   - **LOCAL 板块**：无条件显示，不接受服务端启停、不受版本门禁影响。
     *     服务端清单里即使没有它（正常情况），也不影响。
     *   - **LINKED 板块**：需要服务端声明；`enabled=false` 或无 `entry` 时不显示；
     *     `minAndroidVersion` 高于当前安卓版本时显示但标记"需升级"
     *     （不隐藏 —— 隐藏会让用户以为功能消失，契约 §10.2 陷阱 #8）。
     *     ⚠️ 只看 `minAndroidVersion`，**绝不**看服务端的 `minAppVersion`
     *     （那是桌面端版本号，跨命名空间比较必然失败 → 会把板块永久锁死）。
     *   - **用户布局**：隐藏的滤掉，其余按 [HomeLayout.orderOf] 排序、按
     *     [HomeLayout.groupOf] 分组。
     *
     * @param manifest 服务端清单；为 null（拉取失败）时**联动板块也照常显示**，
     *                 只是不享受服务端下发的启停控制 —— 断网不该让 App 变成空壳。
     */
    fun resolve(
        manifest: ModuleListResponse?,
        currentAppVersion: String,
        layout: HomeLayout = HomeLayout.DEFAULT,
        bound: Boolean = false,
    ): List<ModuleEntry> {
        val serverById = manifest?.modules?.associateBy { it.id }.orEmpty()

        val entries = modules.mapNotNull { module ->
            val spec = module.spec

            when (spec.domain) {
                ModuleDomain.LOCAL -> {
                    // 本机板块：本地说了算。服务端清单与它无关。
                    ModuleEntry(
                        module = module,
                        label = spec.label,
                        icon = spec.icon,
                        desc = spec.desc,
                        domain = ModuleDomain.LOCAL,
                        group = layout.groupOf(spec),
                        requiresUpgrade = false,
                        // 本机功能永远可用，不因未绑定而受限
                        available = true,
                        order = layout.orderOf(spec),
                    )
                }

                ModuleDomain.LINKED -> {
                    val server = serverById[spec.id]

                    // 服务端没声明：仅在"清单拉取失败"时按本地兜底显示；
                    // 若清单拿到了却没有这个模块，说明服务端已下架 → 不显示。
                    val displayable = if (manifest == null) {
                        true
                    } else {
                        server != null && server.isDisplayable
                    }
                    if (!displayable) return@mapNotNull null

                    // ⚠️ 版本门禁：只用**安卓端自己的版本体系**比较。
                    //
                    // 曾犯的错误（2026-10-13）：这里拿服务端下发的 minAppVersion
                    // （桌面端版本，线上是 "2.4.5"）去比安卓端的 "0.1.0"，
                    // 结果 0.1.0 < 2.4.5 恒成立 → 任务墙/快传/控制**全部被永久锁死**，
                    // 界面上显示"需升级"。两个版本号根本不是同一个命名空间。
                    //
                    // 现在只认 minAndroidVersion（服务端未下发 → 不门禁），
                    // 因此不会再出现"用桌面版本卡安卓客户端"。
                    val required = server?.minAndroidVersion?.takeIf { it.isNotBlank() }
                        ?: spec.minAndroidVersion.orEmpty()
                    val needsUpgrade = required.isNotBlank() &&
                        !VersionGate.satisfies(currentAppVersion, required)

                    ModuleEntry(
                        module = module,
                        // 服务端字段优先，缺失时回落本地声明
                        label = server?.label?.takeIf { it.isNotBlank() } ?: spec.label,
                        icon = server?.icon?.takeIf { it.isNotBlank() } ?: spec.icon,
                        desc = server?.desc?.takeIf { it.isNotBlank() } ?: spec.desc,
                        domain = ModuleDomain.LINKED,
                        group = layout.groupOf(spec),
                        requiresUpgrade = needsUpgrade,
                        // 联动板块需要绑定才可用（用户要求：显示但置灰，不隐藏）
                        available = bound,
                        order = layout.orderOf(spec),
                    )
                }
            }
        }

        return entries
            .filterNot { layout.isHidden(it.module.spec) }
            .sortedWith(compareBy({ it.order }, { it.label }))
    }

    /**
     * 按分组归拢，供首页分区渲染（设计文档 §3.1）。
     *
     * 组之间的顺序保证"本机功能"在"连接电脑"之前 —— 这是产品的固定观感，
     * 不该随字母序变化；用户自定义的分组排在后面。
     */
    fun group(entries: List<ModuleEntry>): List<ModuleSection> {
        val buckets = LinkedHashMap<String, MutableList<ModuleEntry>>()
        entries.forEach { entry ->
            buckets.getOrPut(entry.group) { mutableListOf() }.add(entry)
        }

        val preferred = listOf(ModuleSpec.GROUP_LOCAL, ModuleSpec.GROUP_LINKED)
        val orderedGroups = buildList {
            preferred.forEach { name -> if (buckets.containsKey(name)) add(name) }
            // 用户自定义分组（HomeLayout.groupOverrides 带来的）排在后面
            buckets.keys.filterNot { it in preferred }.sorted().forEach { add(it) }
        }

        return orderedGroups.map { name ->
            ModuleSection(name, buckets.getValue(name))
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
    val domain: ModuleDomain,
    /** 所属分组（已应用用户自定义） */
    val group: String,
    /** true 表示客户端版本低于该模块要求，UI 应提示升级而非进入 */
    val requiresUpgrade: Boolean,
    /**
     * 当前是否可进入。
     *
     * 联动板块未绑定时为 false → UI 置灰并在点击时提示去绑定；
     * 本机板块恒为 true。**由框架判定，板块不参与。**
     */
    val available: Boolean,
    val order: Int,
)

/** 首页的一个分区。 */
data class ModuleSection(
    val title: String,
    val entries: List<ModuleEntry>,
)
