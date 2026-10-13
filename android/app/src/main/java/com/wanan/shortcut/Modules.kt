package com.wanan.shortcut

import com.wanan.shortcut.feature.demo.DemoModule
import com.wanan.shortcut.framework.ShortcutModule

/**
 * ★★★ **加板块，只改这个文件** ★★★
 *
 * 这是框架给安卓端定的验收标准（见 `docs/android/安卓端开工需求计划.md` §2.2）：
 * 新增一个功能板块时，**只允许改本文件一行**，其余全部由框架自动接上——
 * 导航入口、图标、标题、服务端启停对账、版本门禁、身份注入、错误处理、权限申请。
 *
 * 如果你发现加一个板块需要改第二处（例如改首页、改导航图、改设置页），
 * 说明框架缺了抽象 —— **先去补框架，再回来加板块**。
 *
 * 当前登记：P0 阶段仅有框架自证用的假板块；P1 起加入 taskwall / control。
 */
object Modules {

    fun all(): List<ShortcutModule> = listOf(
        // —— 框架自证：假板块。它存在的唯一目的是证明"加一行就能多一个入口"。
        DemoModule(),

        // —— P1：任务墙（queue 能力）
        // TaskwallModule(),

        // —— P2：电脑控制（realtime 能力 + 前台服务）
        // ControlModule(),
    )
}
