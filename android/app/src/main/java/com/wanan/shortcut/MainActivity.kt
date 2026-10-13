package com.wanan.shortcut

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.prefs.AppPrefs
import com.wanan.shortcut.feature.bind.BindScreen
import com.wanan.shortcut.feature.home.HomeScreen
import com.wanan.shortcut.feature.settings.SettingsScreen
import com.wanan.shortcut.ui.components.GridTextureBackground
import com.wanan.shortcut.ui.components.ShortCutTopBar
import com.wanan.shortcut.ui.components.ShortCutTopBarWithStatus
import com.wanan.shortcut.ui.nav.Routes
import com.wanan.shortcut.ui.nav.ShortCutNavigationBar
import com.wanan.shortcut.ui.theme.ShortCutTheme

/**
 * 唯一 Activity。
 *
 * 单 Activity + Compose 内部路由：板块不注册自己的 Activity
 * （否则每加一个板块都要改 `AndroidManifest`，违背"加板块只改一个文件"）。
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // edge-to-edge：内容延伸到状态栏/导航栏之下，由 Compose 的 inset 机制负责避让。
        //
        // ⚠️ 这一步本身没错。错在**以前只调了它、却没有任何 inset 处理**，
        // 导致返回按钮被状态栏盖住、点不到（用户反馈的缺陷 B1）。
        // 现在内边距统一由 AppRoot 里那一个 Scaffold 承接。
        enableEdgeToEdge()

        val container = appContainer

        setContent {
            val prefs by container.appPrefs.flow
                .collectAsStateWithLifecycle(initialValue = AppPrefs())

            ShortCutTheme(prefs = prefs) {
                // 网格纹理背景：复刻 web 四个移动端页面的 24px 网格。
                // 做成偏好开关（见设置 → 外观），因为手机屏幕小，可能显脏 ——
                // 用户翻一下就能定，比在文档里争论强。
                //
                // ⚠️ 图层顺序：纹理必须画在**最底层**，其上所有容器都必须透明，
                // 否则纹理被盖住等于没画。因此：
                //   - 这里不套不透明 Surface；
                //   - AppRoot 里 Scaffold 的 containerColor 用 Transparent。
                GridTextureBackground(enabled = prefs.gridTexture) {
                    AppRoot(container)
                }
            }
        }
    }
}

/**
 * 应用根：全局脚手架 + 导航图。
 *
 * ## inset 处理（修缺陷 B1）
 *
 * **全应用只有这一个 `Scaffold`**，由它统一承接窗口内边距：
 * - `topBar` / `bottomBar` 自动避让状态栏与手势导航条；
 * - 它给出的 `innerPadding` 已包含状态栏高度与底部标签栏高度；
 * - 内容区因此只需 `Modifier.padding(innerPadding)`。
 *
 * ⚠️ **不要**在任何子页面里再加 `statusBarsPadding()` / `navigationBarsPadding()` /
 * `systemBarsPadding()` —— 会与 Scaffold 的 padding 二次叠加，顶部多出一大块空白。
 * 这是 edge-to-edge 最常见的坑。
 *
 * ## 返回行为（修缺陷 B2）
 *
 * 用 `NavHost` 取代手写路由状态后，系统返回/右滑**自动出栈**：
 * 板块子页 → 板块主页 → 首页 →（首页再返回才）退出 App。
 * 这正是用户反馈"右滑直接退出软件"的根因所在。
 */
@Composable
private fun AppRoot(container: AppContainer) {
    val navController = rememberNavController()
    val identity by container.identityProvider.state.collectAsStateWithLifecycle()

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // 从当前目的地参数里取出板块 id 与子路由（唯一真相：导航图）
    val moduleId = backStackEntry?.arguments?.getString(Routes.ARG_MODULE_ID)
    val subRoute = backStackEntry?.arguments?.getString(Routes.ARG_SUB_ROUTE)

    // 启动时恢复身份（含 deviceKey 惰性生成）。
    // 未绑定**不再强制跳绑定页** —— 本机板块不需要绑定。
    LaunchedEffect(Unit) {
        container.identityProvider.restore()
    }

    // 身份失效的全局出口：任何请求命中"绑定已失效"都会走到这里，
    // 只触发一次（IdentityProvider.onTokenRejected 幂等）。
    LaunchedEffect(Unit) {
        container.identityProvider.setUnauthorizedHandler {
            if (navController.currentDestination?.route != Routes.BIND) {
                navController.navigate(Routes.BIND) { launchSingleTop = true }
            }
        }
    }

    val isTopLevel = currentRoute in Routes.TOP_LEVEL

    Scaffold(
        topBar = {
            AppTopBar(
                identity = identity,
                currentRoute = currentRoute,
                moduleId = moduleId,
                subRoute = subRoute,
                container = container,
                onBack = { navController.popBackStack() },
            )
        },
        bottomBar = {
            // 只在顶层页显示底部标签栏；进入板块/详情页时隐藏，返回后恢复
            if (isTopLevel) {
                ShortCutNavigationBar(
                    navController = navController,
                    currentRoute = currentRoute,
                )
            }
        },
        // ⚠️ containerColor 必须透明：底层是 GridTextureBackground 画的网格纹理，
        // Scaffold 默认会用 colorScheme.background 铺一层不透明底，把纹理整片盖死
        // （这是"功能写了但看不见"的典型 —— 靠图层顺序排查，不是靠猜）。
        // 页面底色由 GridTextureBackground 负责，它本来就是 colorScheme.background。
        containerColor = Color.Transparent,
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Routes.HOME,
            // ★ 全应用唯一一次 inset 消费处
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(Routes.HOME) {
                HomeScreen(
                    identity = identity,
                    onOpenModule = { id -> navController.navigate(Routes.module(id)) },
                    onOpenSettings = { navController.navigate(Routes.SETTINGS) },
                    onGoBind = { navController.navigate(Routes.BIND) },
                )
            }

            composable(Routes.SETTINGS) {
                SettingsScreen(
                    identity = identity,
                    onUnbound = { navController.navigate(Routes.BIND) },
                )
            }

            composable(Routes.BIND) {
                BindScreen(onBound = { navController.popBackStack() })
            }

            composable(
                route = Routes.MODULE,
                arguments = listOf(navArgument(Routes.ARG_MODULE_ID) { type = NavType.StringType }),
            ) { entry ->
                val id = entry.arguments?.getString(Routes.ARG_MODULE_ID).orEmpty()
                ModuleHostScreen(
                    moduleId = id,
                    subRoute = null,
                    identity = identity,
                    onBack = { navController.popBackStack() },
                    onNavigateSub = { target ->
                        navController.navigate(Routes.moduleSub(id, target)) {
                            launchSingleTop = true
                        }
                    },
                    onGoBind = { navController.navigate(Routes.BIND) },
                )
            }

            composable(
                route = Routes.MODULE_SUB,
                arguments = listOf(
                    navArgument(Routes.ARG_MODULE_ID) { type = NavType.StringType },
                    navArgument(Routes.ARG_SUB_ROUTE) { type = NavType.StringType },
                ),
            ) { entry ->
                val id = entry.arguments?.getString(Routes.ARG_MODULE_ID).orEmpty()
                val sub = entry.arguments?.getString(Routes.ARG_SUB_ROUTE)
                ModuleHostScreen(
                    moduleId = id,
                    subRoute = sub,
                    identity = identity,
                    onBack = { navController.popBackStack() },
                    onNavigateSub = { target ->
                        navController.navigate(Routes.moduleSub(id, target)) {
                            launchSingleTop = true
                        }
                    },
                    onGoBind = { navController.navigate(Routes.BIND) },
                )
            }
        }
    }
}

/**
 * 按当前路由决定顶部栏。
 *
 * 板块页的标题由**板块自己**提供子页标题（`ShortcutModule.subRouteTitle`），
 * 这样"新建任务"这类子页能显示正确标题，而框架不需要知道板块内部细节。
 */
@Composable
private fun AppTopBar(
    identity: Identity,
    currentRoute: String?,
    moduleId: String?,
    subRoute: String?,
    container: AppContainer,
    onBack: () -> Unit,
) {
    when (currentRoute) {
        // 首页顶部栏：标题 + 连接状态（只读，不可点）。
        // 「管理」入口由底部标签栏的「设置」承担，顶部不再重复放一个可点文字
        //（用户反馈：首页上方不需要那个管理）。
        Routes.HOME -> ShortCutTopBarWithStatus(
            title = "ShortCut",
            statusText = if (identity.isBound) "已连接 · ${identity.deviceName}" else "未连接电脑",
            online = identity.isBound,
        )

        Routes.SETTINGS -> ShortCutTopBar(title = "设置")

        Routes.BIND -> ShortCutTopBar(title = "连接电脑", onBack = onBack)

        Routes.MODULE -> {
            val module = moduleId?.let { container.moduleRegistry.get(it) }
            val title = when {
                module == null -> "功能"
                subRoute.isNullOrBlank() -> module.spec.label
                else -> module.subRouteTitle(subRoute) ?: module.spec.label
            }
            ShortCutTopBar(
                title = title,
                subtitle = if (!subRoute.isNullOrBlank()) module?.spec?.label else null,
                onBack = onBack,
            )
        }

        else -> ShortCutTopBar(title = "ShortCut")
    }
}
