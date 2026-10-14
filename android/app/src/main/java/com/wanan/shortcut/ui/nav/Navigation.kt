package com.wanan.shortcut.ui.nav

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController

/**
 * 路由定义。
 *
 * ## 为什么改用 Navigation Compose（而不是原来的手写 route 状态）
 *
 * 原来 `MainActivity` 里是：
 * ```kotlin
 * private sealed interface Route { ... }
 * var route by remember { mutableStateOf<Route>(Route.Splash) }
 * ```
 * 它有三个问题，其中第一个是用户实际踩到的**功能性缺陷**：
 *
 * 1. **没有返回栈** → 系统返回/右滑时"无处可退"，**直接退出 App**；
 * 2. 状态不保留：切到设置再回来，首页滚动位置与板块子页全丢；
 * 3. 无法参与 predictive back（API 33+ 的拖动预览动画）。
 *
 * `NavHost` 天然解决这三条，且板块代码完全不受影响 ——
 * 因为板块只调 `ModuleNavigator.to("子页")`，这正是当初把导航收敛成接口的价值。
 */
object Routes {
    /** 顶层：首页 */
    const val HOME = "home"

    /** 顶层：设置 */
    const val SETTINGS = "settings"

    /** 绑定（从首页或置灰的联动板块进入） */
    const val BIND = "bind"

    /**
     * 带 bindId 的绑定直链（对应 web 的 `?bind=<bindId>`）。
     *
     * 场景：用外面相机扫桌面端二维码，打开的是网页链接；
     * 但 App 内也可以直接以 bindId 进入本页并**自动绑定**。
     */
    const val BIND_WITH_ID = "bind/{bindId}"

    const val ARG_BIND_ID = "bindId"

    /** 某板块首页 */
    const val MODULE = "module/{moduleId}"

    /**
     * 板块内子页。
     *
     * ⚠️ 必须做成**独立的路由模式**（而不是给 [MODULE] 加一个可选参数）：
     * Navigation Compose 里路径参数无法"可选"（可选参数只能是查询串），
     * 而且我们**就是要**子页成为独立的返回栈条目 —— 这样系统返回会从子页
     * 弹回板块主页，而不是直接退出板块。
     */
    const val MODULE_SUB = "module/{moduleId}/sub/{subRoute}"

    const val ARG_MODULE_ID = "moduleId"
    const val ARG_SUB_ROUTE = "subRoute"

    fun module(id: String) = "module/$id"
    fun moduleSub(id: String, sub: String) = "module/$id/sub/$sub"

    /** 绑定直链（把 bindId 编进路径，进入即自动绑定） */
    fun bindWithId(bindId: String) = "bind/$bindId"

    /** 哪些路由属于"顶层标签页"（决定底部标签栏是否显示） */
    val TOP_LEVEL = setOf(HOME, SETTINGS)
}

/** 底部标签项定义。加一个标签 = 这里加一行。 */
private data class NavTab(
    val route: String,
    val label: String,
    val icon: ImageVector,
)

private val TABS = listOf(
    NavTab(Routes.HOME, "首页", Icons.Filled.Home),
    NavTab(Routes.SETTINGS, "设置", Icons.Filled.Settings),
)

/**
 * 底部标签栏（Material 3 `NavigationBar`）。
 *
 * ## 设计要点
 *
 * - **只在顶层页显示**：进入板块或详情页时隐藏，返回后恢复。
 *   详情页还挂着底部标签会让人误以为"点了就跳走"，也会挤占内容高度。
 * - **文字始终显示**（`alwaysShowLabel = true`）：工具类 App 的图标辨识度不够，
 *   纯图标会让人猜。
 * - 点击同样板页时**不重复入栈**（`launchSingleTop`），并保存/恢复各标签的状态
 *   （`saveState` / `restoreState`）—— 否则切来切去每次都回到顶部。
 * - **不手动传 `windowInsets`**：用 M3 默认值，它已正确处理手势导航条，
 *   手动再加一次会造成双重内边距。
 */
@Composable
fun ShortCutNavigationBar(
    navController: NavHostController,
    currentRoute: String?,
) {
    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = androidx.compose.ui.unit.Dp.Hairline,
    ) {
        val currentDestination = navController.currentBackStackEntry?.destination

        TABS.forEach { tab ->
            val selected = currentRoute == tab.route ||
                currentDestination?.hierarchy?.any { it.route == tab.route } == true

            NavigationBarItem(
                selected = selected,
                onClick = {
                    if (currentRoute == tab.route) return@NavigationBarItem
                    navController.navigate(tab.route) {
                        // 回到起始目的地并保存状态：标签之间切换不堆栈
                        popUpTo(navController.graph.findStartDestination().id) {
                            saveState = true
                        }
                        launchSingleTop = true     // 同一个标签连点不重复入栈
                        restoreState = true        // 恢复该标签上次的状态
                    }
                },
                icon = { Icon(tab.icon, contentDescription = tab.label) },
                label = { Text(tab.label) },
                alwaysShowLabel = true,
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedTextColor = MaterialTheme.colorScheme.primary,
                    indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        }
    }
}
