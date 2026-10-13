package com.wanan.shortcut.framework

/**
 * 板块归属域 —— 框架的核心分类（见 `docs/android/安卓端框架设计.md` §2.1）。
 *
 * 为什么需要它：绑定码是**「联动能力」的钥匙，不是整个 App 的钥匙**。
 * P0 那版框架把两者混为一谈（服务端没声明的板块不显示、未绑定一律拦截），
 * 结果纯本机功能根本加不进来。这个枚举把"要不要绑定"变成板块自己的声明。
 */
enum class ModuleDomain {
    /**
     * 本机板块：不依赖电脑、不需要绑定、断网可用。
     *
     * 框架行为：
     *   - **不参与**服务端 `module.list` 对账（服务端根本不认识它）
     *   - 元数据完全以本地声明为准，不受 `enabled` / `minAppVersion` 影响
     *   - 未绑定也可正常进入
     *
     * 例：笔记、扫码、计算器、记账。
     */
    LOCAL,

    /**
     * 联动板块：依赖绑定身份，与桌面端互通。
     *
     * 框架行为：
     *   - **参与** `module.list` 对账：服务端可远程下架/改元数据/卡版本
     *   - 元数据"服务端优先、本地兜底"
     *   - 未绑定时**显示但置灰**，点击提示去绑定（用户明确要求，不要隐藏）
     *
     * 例：任务墙、文件快传、电脑控制。
     */
    LINKED,
}

/**
 * 板块使用的共享能力（见设计文档 §2.2 / §5）。
 *
 * 声明它的意义：框架据此把板块接到**共享底座**上，避免每个板块各写一套连接。
 * 契约 §7.6 硬约束「每 bindId 最多 3 条连接」，所以实时通道必须全局唯一——
 * 这正是"能力要共享、不能各写"的技术原因。
 */
enum class Capability {
    /** 不使用任何网络能力（本机板块通常用它） */
    NONE,

    /** 队列型：push / pull / ack / board.list */
    QUEUE,

    /** 分片型：fileInit → chunk → fileComplete → download */
    BLOB,

    /** 实时型：一条全局 WebSocket（ticket / auth / api-res） */
    REALTIME,

    /** 一次性调用：module.invoke */
    RPC,
}

/**
 * 板块声明 —— 板块"是什么"的全部描述。
 *
 * 与 [ShortcutModule] 分开的原因：声明是**数据**（可被注册表排序、过滤、持久化覆盖），
 * 而 [ShortcutModule] 是**行为**（提供 Composable）。分开后，
 * 首页布局这类纯数据处理不需要实例化板块。
 */
data class ModuleSpec(
    /** 唯一 id。LINKED 板块需与服务端 `modules.json` 的 id 对齐。 */
    val id: String,

    /** 显示名（LINKED 板块会被服务端 `label` 覆盖） */
    val label: String,

    /** 图标：用 emoji，与服务端下发格式一致，省一套图标资源 */
    val icon: String,

    /** 一句话描述（LINKED 板块会被服务端 `desc` 覆盖） */
    val desc: String,

    /** 归属域，见 [ModuleDomain] */
    val domain: ModuleDomain,

    /** 使用的能力，见 [Capability] */
    val capability: Capability = Capability.NONE,

    /**
     * 首页默认排序权重，小的在前。
     *
     * 刻意留成"默认值"而非"最终值"：用户的个性化排序会通过
     * [HomeLayout.orderOverrides] 覆盖它（见设计文档 §3.3）。
     * 这样将来做拖动排序时，**首页渲染代码不用改**。
     */
    val order: Int = 100,

    /**
     * 本板块要求的**安卓端**最低版本；为空表示不门禁。
     *
     * ⚠️ 命名刻意带 `Android`：**不要**填服务端的 `minAppVersion`
     * （那是桌面端版本号，如 "2.4.5"），否则会把安卓客户端永久锁死 —— 详见
     * [com.wanan.shortcut.framework.ServerModule.minAppVersion] 的说明。
     * 绝大多数情况下保持为空即可。
     */
    val minAndroidVersion: String? = null,

    /** 首页默认分组名；为空时按 [domain] 取默认分组 */
    val group: String? = null,
) {
    /** 该板块默认落在哪个分组（用户未自定义时使用）。 */
    val defaultGroup: String
        get() = group ?: when (domain) {
            ModuleDomain.LOCAL -> GROUP_LOCAL
            ModuleDomain.LINKED -> GROUP_LINKED
        }

    companion object {
        const val GROUP_LOCAL = "本机功能"
        const val GROUP_LINKED = "连接电脑"
    }
}
