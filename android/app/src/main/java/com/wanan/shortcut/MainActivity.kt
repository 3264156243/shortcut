package com.wanan.shortcut

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.core.prefs.AppPrefs
import com.wanan.shortcut.feature.bind.BindScreen
import com.wanan.shortcut.feature.home.HomeScreen
import com.wanan.shortcut.feature.settings.SettingsScreen
import com.wanan.shortcut.ui.theme.ShortCutTheme

/**
 * 唯一 Activity。
 *
 * 采用"单 Activity + Compose 内部路由"：
 * 板块不注册自己的 Activity（那样每加一个板块都要动 AndroidManifest，
 * 违背"加板块只改一个文件"）。所有板块页面都是 Composable。
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val container = appContainer

        setContent {
            // 界面偏好（字号/主题）在这里读取后交给主题层，
            // 这样主题不依赖容器，且变更时整棵树自动重组。
            val prefs by container.appPrefs.flow
                .collectAsStateWithLifecycle(initialValue = AppPrefs())

            ShortCutTheme(prefs = prefs) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AppRoot(container)
                }
            }
        }
    }
}

/** 顶层路由：首页 / 绑定 / 设置 / 某板块。 */
private sealed interface Route {
    data object Splash : Route
    data object Bind : Route
    data object Home : Route
    data object Settings : Route
    data class Module(val id: String) : Route
}

@Composable
private fun AppRoot(container: AppContainer) {
    val identity by container.identityProvider.state.collectAsStateWithLifecycle()
    var route by remember { mutableStateOf<Route>(Route.Splash) }

    /**
     * 首屏路由。
     *
     * ⚠️ 与 P0 的关键区别：**未绑定不再强制进绑定页**。
     * 因为本机板块（笔记等）不需要绑定，强制跳转会把整个 App 变成"必须先连电脑"。
     * 现在未绑定也进首页，只是联动板块置灰、点击才引导去绑定 —— 这正是本次重构的目的。
     */
    LaunchedEffect(Unit) {
        container.identityProvider.restore()
        route = Route.Home
    }

    // 身份失效的全局出口：任何板块、任何请求命中"绑定已失效"都会走到这里，
    // 只触发一次（IdentityProvider.onTokenRejected 幂等），避免多个板块同时弹绑定页。
    LaunchedEffect(Unit) {
        container.identityProvider.setUnauthorizedHandler {
            route = Route.Home
        }
    }

    when (val r = route) {
        Route.Splash -> Unit   // 首帧空白，等 restore() 完成；耗时极短

        Route.Bind -> BindScreen(onBound = { route = Route.Home })

        Route.Home -> HomeScreen(
            identity = identity,
            onOpenModule = { id -> route = Route.Module(id) },
            onOpenSettings = { route = Route.Settings },
            onGoBind = { route = Route.Bind },
        )

        Route.Settings -> SettingsScreen(
            identity = identity,
            onUnbound = { route = Route.Bind },
        )

        is Route.Module -> ModuleHostScreen(
            moduleId = r.id,
            identity = identity,
            onBack = { route = Route.Home },
            onSwitchModule = { id -> route = Route.Module(id) },
            onGoBind = { route = Route.Bind },
        )
    }
}
