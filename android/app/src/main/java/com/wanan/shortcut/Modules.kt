package com.wanan.shortcut

import com.wanan.shortcut.feature.linked.control.ControlModule
import com.wanan.shortcut.feature.linked.taskwall.TaskwallModule
import com.wanan.shortcut.feature.linked.transfer.TransferModule
import com.wanan.shortcut.feature.local.demo.DemoModule
import com.wanan.shortcut.feature.local.notes.NotesModule
import com.wanan.shortcut.framework.ShortcutModule

/**
 * ★★★ **加板块，只改这个文件** ★★★
 *
 * 这是框架给安卓端定的验收标准（见 `docs/android/安卓端框架设计.md` §7）：
 * 新增一个功能板块时，**只允许改本文件一行**，其余全部由框架自动接上——
 * 首页图标与分区、服务端对账、版本门禁、未绑定置灰、身份注入、错误处理、权限申请。
 *
 * 板块分两类，各自在 `ModuleSpec` 里声明（见 [com.wanan.shortcut.framework.ModuleDomain]）：
 *   - **LOCAL 本机板块**：不依赖电脑、不需绑定、断网可用。服务端无法下架它。
 *   - **LINKED 联动板块**：需要绑定；服务端可远程开关、改元数据。未绑定时置灰。
 *
 * 如果你发现加一个板块需要改第二处（例如改首页、改导航图、改设置页），
 * 说明框架缺了抽象 —— **先去补框架，再回来加板块**。
 */
object Modules {

    fun all(): List<ShortcutModule> = listOf(
        // ===== 本机功能（LOCAL）：不需要连接电脑 =====
        NotesModule(),     // 📝 真功能：本地笔记

        // 框架自证用假板块（排在最后）。证明"加一行就多一个入口"，
        // 同时演示 LOCAL 板块即使服务端不认识它也能正常显示。
        DemoModule(),

        // ===== 连接电脑（LINKED）：需要绑定码 =====
        TaskwallModule(),   // 🗂️ 任务墙（queue 能力）
        TransferModule(),   // 📤 文件共享（blob 能力）
        ControlModule(),    // 🖥️ 电脑控制（realtime 能力）
    )
}
