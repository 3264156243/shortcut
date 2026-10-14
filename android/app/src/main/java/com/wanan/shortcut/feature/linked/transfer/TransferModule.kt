package com.wanan.shortcut.feature.linked.transfer

import androidx.compose.runtime.Composable
import com.wanan.shortcut.core.realtime.RelayMessage
import com.wanan.shortcut.framework.Capability
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ModuleSpec
import com.wanan.shortcut.framework.ShortcutModule

/**
 * 文件共享板块（blob 能力，契约 §6）。
 *
 * ## 与 web 参考实现（`server/sync/web/transfer/index.html`）的能力对照
 *
 * | web 能力 | 本板块 |
 * |---|---|
 * | 消息列表（气泡/文件/时间） | ✅ |
 * | **3 秒轮询**更新消息 | ✅ |
 * | 发送文本 / 发送文件（多选） | ✅ |
 * | 复制文本 / 删除消息（confirm） | ✅ |
 * | 下载文件 | ✅（流式，支持 1 GB） |
 * | 共享内容：创建（文本/文件）、领取、我的共享列表、删除 | ✅ |
 *
 * ## 数据来源的注意点
 *
 * 文件走 `file.php`（**真实 HTTP 状态码**），其余走 `api.php`（**恒 200 看 success**）。
 * 这层差异由 `core/blob/FileApiClient` 与 `core/net/ApiClient` 各自吸收，
 * 板块不需要判断。
 */
class TransferModule : ShortcutModule {

    override val spec: ModuleSpec = ModuleSpec(
        id = "fileTransfer",                 // 与服务端 modules.json 的 id 对齐
        label = "文件共享",
        icon = "📤",
        desc = "发送/领取文件与文本，共享给他人",
        domain = ModuleDomain.LINKED,
        capability = Capability.BLOB,
        order = 110,
    )

    @Composable
    override fun Screen(navigator: ModuleNavigator) {
        TransferScreen()
    }

    override fun onRealtimeMessage(message: RelayMessage) {
        // 文件共享走 3 秒轮询（与 web 一致），不使用实时通道。
        // 契约 §7.6 限制每 bindId 最多 3 条连接，不该为它再开一条 WS。
    }
}
