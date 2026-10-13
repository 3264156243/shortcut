package com.wanan.shortcut

import androidx.compose.runtime.Composable
import com.wanan.shortcut.core.api.NoopApiClient
import com.wanan.shortcut.framework.Capability
import com.wanan.shortcut.framework.HomeLayout
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleListResponse
import com.wanan.shortcut.framework.ModuleNavigator
import com.wanan.shortcut.framework.ModuleRegistry
import com.wanan.shortcut.framework.ModuleSpec
import com.wanan.shortcut.framework.ServerModule
import com.wanan.shortcut.framework.ShortcutModule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 框架分域逻辑测试 —— **本次重构的核心验证**。
 *
 * 这些用例覆盖的正是用户指出的那个结构性缺陷：
 * "服务端没声明的板块就不显示" 与 "未绑定一律拦住"。
 * 它们同时也是"加板块只改一个文件"这个承诺的回归保护。
 *
 * 不需要真机、不需要网络：注册表逻辑是纯函数。
 */
class ModuleRegistryDomainTest {

    // ---------------- 测试替身 ----------------

    private class FakeLocal(id: String, order: Int = 10) : ShortcutModule {
        override val spec = ModuleSpec(
            id = id, label = "本机$id", icon = "📝", desc = "本机功能",
            domain = ModuleDomain.LOCAL, capability = Capability.NONE, order = order,
        )
        @Composable override fun Screen(navigator: ModuleNavigator) = Unit
    }

    private class FakeLinked(
        id: String,
        order: Int = 100,
        minAndroidVersion: String? = null,
    ) : ShortcutModule {
        override val spec = ModuleSpec(
            id = id, label = "联动$id", icon = "🗂️", desc = "联动功能",
            domain = ModuleDomain.LINKED, capability = Capability.QUEUE,
            order = order, minAndroidVersion = minAndroidVersion,
        )
        @Composable override fun Screen(navigator: ModuleNavigator) = Unit
    }

    private fun registry(vararg modules: ShortcutModule) =
        ModuleRegistry(modules.toList(), NoopApiClient)

    private fun serverModule(
        id: String,
        enabled: Boolean = true,
        entry: String = "/$id/",
        label: String = "",
        icon: String = "",
        desc: String = "",
        /** 桌面端版本号（服务端下发），**不用于安卓门禁** */
        minAppVersion: String = "",
        /** 安卓端版本号下限（服务端当前不下发） */
        minAndroidVersion: String = "",
    ) = ServerModule(
        id = id, label = label, icon = icon, desc = desc, entry = entry,
        enabled = enabled, minAppVersion = minAppVersion,
        minAndroidVersion = minAndroidVersion,
    )

    private fun manifest(vararg modules: ServerModule) =
        ModuleListResponse(version = 1, protocolVersion = 1, modules = modules.toList())

    // ---------------- 核心缺陷 1：LOCAL 板块不依赖服务端 ----------------

    @Test
    fun `本机板块即使服务端没声明也必须显示`() {
        // 这是 P0 的结构性 bug：resolve() 里 `serverById[id] ?: return null`
        // 会让服务端完全不知道的本机功能永远出不来。
        val reg = registry(FakeLocal("notes"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall")),   // 清单里没有 notes
            currentAppVersion = "0.1.0",
        )

        assertEquals("本机板块必须显示", 1, entries.size)
        assertEquals("notes", entries.first().module.spec.id)
    }

    @Test
    fun `本机板块不受服务端 enabled 与 minAppVersion 影响`() {
        // 服务端即便"下架"了同 id 的模块，也不能影响本机板块
        val reg = registry(FakeLocal("notes"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("notes", enabled = false, minAppVersion = "99.0.0")),
            currentAppVersion = "0.1.0",
        )
        assertEquals("本机板块由本地说了算", 1, entries.size)
        assertFalse(entries.first().requiresUpgrade)
    }

    @Test
    fun `本机板块断网时（清单为 null）依然显示`() {
        val reg = registry(FakeLocal("notes"))
        val entries = reg.resolve(manifest = null, currentAppVersion = "0.1.0")
        assertEquals(1, entries.size)
    }

    // ---------------- 核心缺陷 2：未绑定只影响 LINKED ----------------

    @Test
    fun `未绑定时本机板块可用而联动板块置灰`() {
        // P0 的第二个 bug：ModuleHostScreen 对所有板块一律 `!isBound -> EmptyState`。
        // 现在可用性由框架按 domain 判定。
        val reg = registry(FakeLocal("notes"), FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall")),
            currentAppVersion = "0.1.0",
            bound = false,      // ★ 未绑定
        )

        val local = entries.first { it.module.spec.id == "notes" }
        val linked = entries.first { it.module.spec.id == "taskwall" }

        assertTrue("本机板块未绑定也应可用", local.available)
        assertFalse("联动板块未绑定应置灰（但显示，不隐藏）", linked.available)
    }

    @Test
    fun `绑定后联动板块变为可用`() {
        val reg = registry(FakeLocal("notes"), FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall")),
            currentAppVersion = "0.1.0",
            bound = true,
        )
        assertTrue(entries.first { it.module.spec.id == "taskwall" }.available)
    }

    // ---------------- LINKED 的服务端对账规则 ----------------

    @Test
    fun `联动板块在服务端下架时不显示`() {
        val reg = registry(FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall", enabled = false)),
            currentAppVersion = "0.1.0",
            bound = true,
        )
        assertTrue("enabled=false 应隐藏", entries.isEmpty())
    }

    @Test
    fun `联动板块服务端缺 entry 时不显示`() {
        val reg = registry(FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall", entry = "")),
            currentAppVersion = "0.1.0",
            bound = true,
        )
        assertTrue("无 entry 应隐藏（契约 §4.1）", entries.isEmpty())
    }

    @Test
    fun `联动板块清单里没有它时不显示`() {
        val reg = registry(FakeLinked("control"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall")),   // 只有 taskwall
            currentAppVersion = "0.1.0",
            bound = true,
        )
        assertTrue("服务端没声明的联动板块应隐藏", entries.isEmpty())
    }

    @Test
    fun `清单拉取失败时联动板块按本地兜底显示`() {
        // 断网不该让 App 变成空壳
        val reg = registry(FakeLinked("taskwall"))
        val entries = reg.resolve(manifest = null, currentAppVersion = "0.1.0", bound = true)
        assertEquals(1, entries.size)
        assertTrue(entries.first().available)
    }

    @Test
    fun `版本不足时显示但标记需升级而不是隐藏`() {
        // 契约 §10.2 陷阱 #8：隐藏会让用户以为功能消失
        val reg = registry(FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall", minAndroidVersion = "9.9.9")),
            currentAppVersion = "0.1.0",
            bound = true,
        )
        assertEquals("仍应显示", 1, entries.size)
        assertTrue("应标记需升级", entries.first().requiresUpgrade)
    }

    // ---------------- ★ 回归：绝不拿桌面端版本号卡安卓客户端 ----------------

    @Test
    fun `服务端的 minAppVersion 不得用于安卓端版本门禁`() {
        // 这是真实踩过的 bug（2026-10-13）：
        // 服务端 modules.json 下发的 minAppVersion 是**桌面端**版本号（"2.4.5"），
        // 而安卓端是 0.1.0。若拿它做门禁，0.1.0 < 2.4.5 恒成立，
        // → 任务墙/文件共享/电脑控制**全部永久显示"需升级"、点不进去**。
        //
        // 判据：只要服务端给了 minAppVersion，就绝不能因此把安卓端标成"需升级"。
        val reg = registry(FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall", minAppVersion = "2.4.5")),
            currentAppVersion = "0.1.0",
            bound = true,
        )

        assertEquals(1, entries.size)
        assertFalse(
            "服务端 minAppVersion 是桌面端版本号，不得用于安卓门禁（否则板块被永久锁死）",
            entries.first().requiresUpgrade,
        )
    }

    @Test
    fun `本机声明的 minAndroidVersion 仍能正常门禁`() {
        // 与上一条对照：安卓端自己的版本体系内比较必须正常工作，
        // 否则这个机制就形同虚设。
        val reg = registry(FakeLinked("taskwall", minAndroidVersion = "0.5.0"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall")),
            currentAppVersion = "0.1.0",
            bound = true,
        )
        assertTrue("安卓端 0.1.0 < 0.5.0 应标记需升级", entries.first().requiresUpgrade)
    }

    @Test
    fun `安卓端版本满足时不应标记需升级`() {
        val reg = registry(FakeLinked("taskwall", minAndroidVersion = "0.1.0"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall")),
            currentAppVersion = "0.1.0",
            bound = true,
        )
        assertFalse(entries.first().requiresUpgrade)
    }

    // ---------------- ★ 集成级：用**真实注册的板块**验证 ----------------

    @Test
    fun `真实注册的板块在已绑定且服务端按线上清单下发时都应可进入`() {
        // 这条用例的价值：它跑的是 Modules.all() 里**真实的板块声明**，
        // 而不是测试替身。上一版把 minAppVersion="2.4.5" 写进 TaskwallModule 时，
        // 上面那些用 FakeLinked 的用例全都会通过，只有这一条会失败。
        val reg = ModuleRegistry(Modules.all(), NoopApiClient)

        // 复刻线上 module.list 的真实形状（2026-10-13 实测）
        val realManifest = manifest(
            serverModule("taskwall", entry = "/taskwall/", minAppVersion = "2.4.5"),
            serverModule(
                "fileTransfer", entry = "/transfer/", minAppVersion = "2.4.5",
                label = "文件共享", icon = "📤",
            ),
            serverModule(
                "control", entry = "/control/", minAppVersion = "2.4.5",
                label = "电脑控制", icon = "🖥️",
            ),
        )

        val entries = reg.resolve(
            manifest = realManifest,
            currentAppVersion = "0.1.0",   // 安卓端当前版本
            bound = true,
        )

        // 本机板块（笔记/自检）不受服务端清单影响，必然在列表里
        val localIds = entries.filter { it.domain == ModuleDomain.LOCAL }.map { it.module.spec.id }
        assertTrue("本机板块应存在", localIds.isNotEmpty())

        // 关键断言：已绑定 + 服务端声明了模块 → 不得因版本被标记"需升级"
        entries.forEach { entry ->
            assertFalse(
                "板块 ${entry.module.spec.id} 不该被标记需升级" +
                    "（检查是否误用了服务端的 minAppVersion 做安卓门禁）",
                entry.requiresUpgrade,
            )
        }

        // 已绑定时联动板块必须可用
        val linked = entries.filter { it.domain == ModuleDomain.LINKED }
        assertTrue("线上清单里的 taskwall 应可显示", linked.any { it.module.spec.id == "taskwall" })
        linked.forEach { entry ->
            assertTrue(
                "已绑定时联动板块 ${entry.module.spec.id} 应可进入",
                entry.available,
            )
        }
    }

    @Test
    fun `服务端字段优先于本地兜底`() {
        val reg = registry(FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(
                serverModule("taskwall", label = "服务端名字", icon = "🎯", desc = "服务端描述"),
            ),
            currentAppVersion = "0.1.0",
            bound = true,
        )
        val e = entries.first()
        assertEquals("服务端名字", e.label)
        assertEquals("🎯", e.icon)
        assertEquals("服务端描述", e.desc)
    }

    @Test
    fun `服务端字段为空时回落本地兜底`() {
        val reg = registry(FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall")),   // label/icon/desc 都为空
            currentAppVersion = "0.1.0",
            bound = true,
        )
        val e = entries.first()
        assertEquals("联动taskwall", e.label)
        assertEquals("🗂️", e.icon)
    }

    // ---------------- 分区 ----------------

    @Test
    fun `分区应把本机功能排在连接电脑之前`() {
        val reg = registry(FakeLocal("notes"), FakeLinked("taskwall"))
        val entries = reg.resolve(
            manifest = manifest(serverModule("taskwall")),
            currentAppVersion = "0.1.0",
            bound = true,
        )
        val sections = reg.group(entries)

        assertEquals(2, sections.size)
        assertEquals(ModuleSpec.GROUP_LOCAL, sections[0].title)
        assertEquals(ModuleSpec.GROUP_LINKED, sections[1].title)
        assertEquals("notes", sections[0].entries.first().module.spec.id)
    }

    @Test
    fun `同区内按 order 排序`() {
        val reg = registry(
            FakeLocal("b", order = 20),
            FakeLocal("a", order = 5),
            FakeLocal("c", order = 15),
        )
        val entries = reg.resolve(null, "0.1.0")
        assertEquals(listOf("a", "c", "b"), entries.map { it.module.spec.id })
    }

    @Test
    fun `空分区不会被生成`() {
        val reg = registry(FakeLocal("notes"))
        val sections = reg.group(reg.resolve(null, "0.1.0"))
        assertEquals(1, sections.size)
        assertEquals(ModuleSpec.GROUP_LOCAL, sections.first().title)
    }

    // ---------------- 布局覆盖层（为将来的"自定义排序/分组/隐藏"预留） ----------------

    @Test
    fun `布局覆盖可以隐藏板块`() {
        val reg = registry(FakeLocal("notes"), FakeLocal("calc"))
        val layout = HomeLayout(hidden = setOf("calc"))
        val entries = reg.resolve(null, "0.1.0", layout = layout)

        assertEquals(1, entries.size)
        assertEquals("notes", entries.first().module.spec.id)
    }

    @Test
    fun `布局覆盖可以覆盖排序`() {
        val reg = registry(FakeLocal("a", order = 1), FakeLocal("b", order = 2))
        // 用户把 b 拖到 a 前面
        val layout = HomeLayout(orderOverrides = mapOf("b" to 0))
        val entries = reg.resolve(null, "0.1.0", layout = layout)

        assertEquals(listOf("b", "a"), entries.map { it.module.spec.id })
    }

    @Test
    fun `布局覆盖可以自定义分组`() {
        val reg = registry(FakeLocal("notes"), FakeLocal("calc"))
        val layout = HomeLayout(groupOverrides = mapOf("calc" to "工具"))
        val sections = reg.group(reg.resolve(null, "0.1.0", layout = layout))

        // "本机功能"仍在首位（产品固定观感），自定义分组排在其后
        assertEquals("本机功能", sections[0].title)
        assertEquals("工具", sections[1].title)
        assertEquals("calc", sections[1].entries.first().module.spec.id)
    }

    // ---------------- 注册表基本行为 ----------------

    @Test
    fun `按 id 取板块`() {
        val reg = registry(FakeLocal("notes"), FakeLinked("taskwall"))
        assertEquals("notes", reg.get("notes")?.spec?.id)
        assertNull(reg.get("no-such-module"))
    }

    @Test
    fun `实时消息会分发给所有板块`() {
        val reg = registry(FakeLocal("notes"), FakeLinked("taskwall"))
        // 不抛异常即通过；真实分发行为由各板块的 onRealtimeMessage 决定
        reg.dispatchRealtime(com.wanan.shortcut.core.realtime.RelayMessage.Pong(now = 1L))
    }
}
