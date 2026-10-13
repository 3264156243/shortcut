package com.wanan.shortcut

import android.app.Application
import android.content.Context

/**
 * Application：初始化 DI 容器并恢复身份。
 *
 * 刻意保持轻量——不做网络请求、不起服务。
 * 身份恢复（含 deviceKey 惰性生成）由 UI 层的 splash/导航决定时机，
 * 避免 Application 里做挂起操作导致启动卡顿。
 */
class ShortcutApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

/** 便捷取容器（仅用于 Composable/Activity；业务代码请走构造注入）。 */
val Context.appContainer: AppContainer
    get() = (applicationContext as ShortcutApp).container
