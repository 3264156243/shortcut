package com.wanan.shortcut

import com.wanan.shortcut.feature.home.HomeLayoutStyle
import com.wanan.shortcut.ui.nav.Routes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 导航与界面规范的回归测试（不依赖真机）。
 *
 * 这些用例把"用户反馈過的缺陷"固化成断言，避免以后改代码时又退回去。
 *
 * ⚠️ 诚实说明覆盖边界：路由**拼接/解析**、标签集合、布局风格这些纯逻辑
 * 可以在这里测；而"返回按钮是否被状态栏遮住"、"右滑是否退出 App"属于
 * **真机交互**，JVM 测试无法覆盖 —— 那部分靠设计规范 §7 的人工验收清单。
 * 我不想让这些测试给人"缺陷已被自动验证"的错觉。
 */
class NavigationContractTest {

    // ---------------- 缺陷 B2：返回栈 ----------------

    @Test
    fun `板块与子页必须是不同的路由`() {
        // 这是 B2 的关键：子页若与板块主页共用路由（例如靠内部状态表达），
        // 子页就不会成为独立的返回栈条目，系统返回会直接退出板块。
        val module = Routes.module("taskwall")
        val sub = Routes.moduleSub("taskwall", "compose")

        assertNotEquals(
            "子页路由必须与板块主页不同（否则无法出栈）",
            module,
            sub,
        )
        assertEquals("module/taskwall", module)
        assertEquals("module/taskwall/sub/compose", sub)
    }

    @Test
    fun `路由模式与实际路径形状一致`() {
        // 模式用 {xxx} 占位；实际路径用真实值。二者段数必须一致，
        // 否则 NavHost 匹配不上（表现为"点了没反应"）。
        fun segments(p: String) = p.split('/').size

        assertEquals(
            "MODULE 模式与实际路径段数必须一致",
            segments(Routes.MODULE),
            segments(Routes.module("x")),
        )
        assertEquals(
            "MODULE_SUB 模式与实际路径段数必须一致",
            segments(Routes.MODULE_SUB),
            segments(Routes.moduleSub("x", "y")),
        )
    }

    @Test
    fun `参数名与路由模式中的占位符一致`() {
        // 占位符名字写错会导致 args.getString() 返回 null（静默拿到空 id）
        assertTrue(Routes.MODULE.contains("{${Routes.ARG_MODULE_ID}}"))
        assertTrue(Routes.MODULE_SUB.contains("{${Routes.ARG_MODULE_ID}}"))
        assertTrue(Routes.MODULE_SUB.contains("{${Routes.ARG_SUB_ROUTE}}"))
    }

    @Test
    fun `顶层路由恰好是首页与设置`() {
        // 底部标签栏只在顶层页显示；这里错了会导致标签栏在板块页也出现或不出现
        assertEquals(setOf(Routes.HOME, Routes.SETTINGS), Routes.TOP_LEVEL)
    }

    @Test
    fun `绑定页不是顶层页`() {
        // 绑定页应从首页进入、带返回箭头，且不显示底部标签栏
        assertFalse(Routes.BIND in Routes.TOP_LEVEL)
    }

    @Test
    fun `板块路由不属于顶层`() {
        assertFalse(Routes.MODULE in Routes.TOP_LEVEL)
        assertFalse(Routes.MODULE_SUB in Routes.TOP_LEVEL)
    }

    // ---------------- 首页形式（用户要求"可扩展多种形式"） ----------------

    @Test
    fun `首页默认形式是网格`() {
        // 用户明确："第一期先图标网格"
        assertEquals(HomeLayoutStyle.GRID, HomeLayoutStyle.DEFAULT)
    }

    @Test
    fun `网格与列表两种形式都已实现`() {
        // 用户："我想都要有，并且后续能不能扩展很多形式"
        val names = HomeLayoutStyle.entries.map { it.name }
        assertTrue("GRID 必须存在", "GRID" in names)
        assertTrue("LIST 必须存在", "LIST" in names)
    }

    @Test
    fun `未知的形式名应回落到默认而不是崩溃`() {
        // 偏好文件里的值可能来自旧版本；读不出来时不能崩
        assertEquals(HomeLayoutStyle.DEFAULT, HomeLayoutStyle.fromName("NO_SUCH_STYLE"))
        assertEquals(HomeLayoutStyle.DEFAULT, HomeLayoutStyle.fromName(null))
        assertEquals(HomeLayoutStyle.LIST, HomeLayoutStyle.fromName("LIST"))
    }

    @Test
    fun `每种形式都有中文标签`() {
        // 设置页要显示给用户，不能出现空标签
        HomeLayoutStyle.entries.forEach { style ->
            assertTrue("${style.name} 缺少标签", style.label.isNotBlank())
        }
    }
}
