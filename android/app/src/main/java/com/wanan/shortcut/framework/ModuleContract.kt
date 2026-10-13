package com.wanan.shortcut.framework

import androidx.compose.runtime.Composable
import com.wanan.shortcut.core.realtime.RelayMessage

/**
 * 板块元数据。
 *
 * 服务端 `module.list` 是**权威**（契约 §4.1：客户端应跳过 `enabled === false` 或无 `entry` 的模块）；
 * 这里的是**本地兜底**，用于服务端不可达时仍能显示入口，避免"断网就一片空白"。
 */
data class ModuleMeta(
    /** 与服务端 `modules.json` 的 id 对齐（如 taskwall / fileTransfer / control） */
    val id: String,
    /** 兜底标题 */
    val label: String,
    /** 兜底图标：用 emoji，与服务端下发格式一致，省一套图标资源 */
    val icon: String,
    /** 兜底描述 */
    val desc: String,
    /** 本地要求的最低客户端版本；为空表示不门禁 */
    val minAppVersion: String? = null,
)

/**
 * 一个前台服务需求。
 *
 * 由框架统一起停（板块自己不碰 Service 生命周期），避免多个板块各写一份通知渠道/权限判断。
 */
data class ForegroundSpec(
    val notificationId: Int,
    val channelId: String,
    val channelName: String,
    val title: String,
    val text: String,
)

/**
 * ★ **板块契约** —— 框架的核心抽象。
 *
 * 设计目标（本文档 §0）：新增一个板块**只允许改一个文件**（注册表加一行）。
 * 因此凡是"每个板块都要做一遍"的事情，全部由框架代劳，不写进本接口：
 *
 *   - 首页卡片/导航入口（由 [ModuleRegistry] + `module.list` 自动渲染）
 *   - 服务端 `enabled=false` / 缺少 entry 的隐藏（框架判断）
 *   - `minAppVersion` 版本门禁与"请升级"提示（框架判断）
 *   - 请求自动带 `bindId` + `mobileToken`（`core/net/ApiClient` 自动注入）
 *   - 身份失效自动跳绑定页（`core/identity/IdentityProvider` 统一广播）
 *   - loading / 空态 / 错误 / 重试（`ui/components` 通用组件）
 *
 * 板块只需要回答三个问题：我是谁（[id]/[meta]）、我的界面是什么（[Screen]）、
 * 我关心哪些实时消息（[onRealtimeMessage]）。
 */
interface ShortcutModule {

    /** 与服务端 `modules.json` 的 id 对齐。这是与 `module.list` 对账的唯一键。 */
    val id: String

    /** 本地兜底元数据，见 [ModuleMeta]。 */
    val meta: ModuleMeta

    /**
     * 入口页面。
     *
     * 实现者**不需要**自己处理"未绑定"——框架保证进入板块前身份已可用
     * （未绑定时导航层不会放行，直接展示绑定页）。
     */
    @Composable
    fun Screen(navigator: ModuleNavigator)

    /**
     * 设置页分片（可选）。
     *
     * 默认不实现 → 设置页不会为该板块生成任何条目。
     * 这样加一个没有设置项的板块时，确实只改注册表一行。
     */
    @Composable
    fun SettingsSection() = Unit

    /**
     * 实时通道消息回调（可选）。
     *
     * 框架把中继消息按注册顺序广播给所有已注册板块；板块自行按需过滤。
     * 默认空实现——不做实时功能的板块（如文件快传）无需关心。
     */
    fun onRealtimeMessage(message: RelayMessage) = Unit

    /**
     * 该板块需要的前台服务（可选）。
     *
     * 返回非空时，框架在板块可见期间负责起停，并处理通知渠道与 Android 13+ 权限。
     */
    val foregroundService: ForegroundSpec? get() = null

    /**
     * 该板块需要的运行时权限（可选）。
     *
     * 框架统一申请与结果回传，板块不直接调 `ActivityResultContracts`，
     * 以免每个板块各写一遍权限流程、各写一套"用户拒绝了怎么办"。
     */
    val permissions: List<String> get() = emptyList()

    /**
     * 权限申请结果回调（可选）。仅在声明了 [permissions] 时被调用。
     */
    fun onPermissionResult(granted: Map<String, Boolean>) = Unit
}

/**
 * 板块内的导航能力。
 *
 * 故意做得比 `NavController` 窄：板块只能用"进入子页 / 返回 / 切到别的板块"，
 * 不允许板块直接操作全局导航图（否则板块间会隐式耦合，破坏"加板块不碰别人"的约定）。
 */
interface ModuleNavigator {
    /** 进入本板块的某个子页面 */
    fun to(route: String)

    /** 返回 */
    fun back()

    /** 切换到另一个板块（按 id） */
    fun switchModule(moduleId: String)
}
