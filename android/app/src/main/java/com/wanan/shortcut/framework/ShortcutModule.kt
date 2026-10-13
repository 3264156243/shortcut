package com.wanan.shortcut.framework

import androidx.compose.runtime.Composable
import com.wanan.shortcut.core.realtime.RelayMessage

/**
 * 一个前台服务需求。
 *
 * 由框架统一起停（板块自己不碰 Service 生命周期），避免多个板块各写一份
 * 通知渠道/权限判断。
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
 * 设计目标（设计文档 §2.4）：新增一个板块**只允许改一个文件**（注册表加一行）。
 * 凡是"每个板块都要做一遍"的事情，全部由框架代劳，不写进本接口：
 *
 *   - 首页入口卡片 / 分区 / 排序（由 [ModuleRegistry] + `module.list` + `HomeLayout` 合成）
 *   - **未绑定时的置灰与提示**（框架按 [ModuleSpec.domain] 决定，板块不判断）
 *   - `enabled=false` / 缺少 entry 的隐藏、`minAppVersion` 版本门禁
 *   - 请求自动带 `bindId` + `mobileToken`
 *   - 身份失效自动跳绑定页
 *   - loading / 空态 / 错误 / 重试
 *   - 板块内子页导航
 *   - 权限申请与前台服务起停
 *
 * 板块只需要回答：我是谁（[spec]）、我的界面是什么（[Screen]）。
 */
interface ShortcutModule {

    /**
     * 板块声明（含 [ModuleDomain] 与 [Capability]）。
     *
     * 这是框架唯一用来识别板块的东西——[ModuleSpec.id] 是与服务端对账的键。
     */
    val spec: ModuleSpec

    /** 便捷访问（大量地方要用 id） */
    val id: String get() = spec.id

    /**
     * 入口页面。
     *
     * 实现者**不需要**自己处理"未绑定"——框架只对 [ModuleDomain.LINKED] 板块拦截，
     * 且拦截逻辑在 `ModuleHostScreen`，不在这里。
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
     * ⚠️ 消息来自**全局唯一**的那条连接（见设计文档 §5），
     * 板块**不要**自己建 WS —— 契约 §7.6：每 bindId 最多 3 条连接。
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

    /** 权限申请结果回调（可选）。仅在声明了 [permissions] 时被调用。 */
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

/**
 * 当前板块的子路由（框架维护，板块只读）。
 *
 * 用法：板块在 [ShortcutModule.Screen] 里读它来决定渲染哪个子页：
 * ```kotlin
 * when (LocalModuleSubRoute.current) {
 *     null -> ListPage(onCompose = { navigator.to("compose") })
 *     "compose" -> ComposePage(onBack = navigator::back)
 *     else -> ListPage(...)
 * }
 * ```
 *
 * 为什么用 CompositionLocal 而不是让板块自己存 `remember` 状态：
 * 子路由要能响应系统返回键、并在进程重建后恢复，这属于宿主职责。
 */
val LocalModuleSubRoute = androidx.compose.runtime.compositionLocalOf<String?> { null }

/** 由框架调用，把子路由注入给板块。 */
@Composable
fun ProvideModuleSubRoute(route: String?, content: @Composable () -> Unit) {
    androidx.compose.runtime.CompositionLocalProvider(LocalModuleSubRoute provides route, content)
}
