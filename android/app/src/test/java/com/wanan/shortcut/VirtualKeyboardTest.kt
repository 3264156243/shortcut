package com.wanan.shortcut

import com.wanan.shortcut.core.realtime.ControlPaths
import com.wanan.shortcut.feature.linked.control.ControlCommands
import com.wanan.shortcut.feature.linked.control.VirtualKeyboard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 虚拟键盘与指令形状的回归测试。
 *
 * ## 针对的真实 bug
 *
 * 用户反馈："**键盘打字母却是一些快捷键一样的**"。
 *
 * 根因：我把虚拟键盘的按键**一律走 `/api/combo`**，而 web 的规则是
 * （`control/app/js/phone.js:753` 的 `pressVk`）：
 *
 * ```js
 * if (active.length) sendCombo(active.concat([key]));  // 有修饰键 → 组合
 * else sendKey(key);                                   // 无修饰键 → 单键
 * ```
 *
 * 两者在服务端语义不同：
 *   - `/api/key`   → `inject("KEY <vk>")`，按下并释放**一个**键；
 *   - `/api/combo` → "按键序列"，单个字母走它会被当成序列处理。
 *
 * ## 测试策略
 *
 * `ControlCommands` 产出的是 **(path, body)** 二元组，path 是**中继/局域网路径**
 * （如 `/api/key`），**不经过 `api.php`** —— 所以这里直接断言这个二元组，
 * 而不是去打 HTTP。这也让测试成为纯粹的"协议形状"断言，不依赖网络。
 *
 * 字段名是硬契约：`/api/mouse` 的 `dx/dy`、`/api/wheel` 的 `delta` 等
 * 若写错，服务端会静默无效（不是报错），所以必须锁住。
 */
class VirtualKeyboardTest {

    private fun bodyOf(pair: Pair<String, Map<String, Any?>>): Map<String, Any?> = pair.second

    // ---------------- ★ 核心规则：单键 vs 组合键 ----------------

    @Test
    fun `单键必须走 api-key 路径`() {
        val (path, body) = ControlCommands.key("a")

        assertEquals("字母必须走 /api/key", ControlPaths.KEY, path)
        assertEquals("/api/key", path)
        assertEquals("键名放在 key 字段", "a", body["key"])
    }

    @Test
    fun `单键绝不能走 api-combo`() {
        val (path, _) = ControlCommands.key("a")
        assertFalse(
            "走 combo 会变成按键序列 —— 这正是'打字母出来是快捷键'的原因",
            path == ControlPaths.COMBO,
        )
    }

    @Test
    fun `组合键必须走 api-combo 且用 keys 数组`() {
        val (path, body) = ControlCommands.combo(listOf("ctrl", "c"))

        assertEquals(ControlPaths.COMBO, path)
        @Suppress("UNCHECKED_CAST")
        val keys = body["keys"] as List<String>
        assertEquals(listOf("ctrl", "c"), keys)
    }

    @Test
    fun `回车与Tab必须走单键`() {
        // web 的 btnEnter/btnTab 都是 sendKey（phone.js:351）
        listOf("enter", "tab").forEach { k ->
            val (path, body) = ControlCommands.key(k)
            assertEquals("$k 应走 /api/key", ControlPaths.KEY, path)
            assertEquals(k, body["key"])
        }
    }

    @Test
    fun `四个方向键必须走单键`() {
        // web 的 #arrows 是 sendKey(data-key)（phone.js:363）
        listOf("up", "down", "left", "right").forEach { dir ->
            val (path, body) = ControlCommands.key(dir)
            assertEquals("方向键 $dir 应走 /api/key", ControlPaths.KEY, path)
            assertEquals(dir, body["key"])
        }
    }

    @Test
    fun `退格必须走单键`() {
        val (path, body) = ControlCommands.key("backspace")
        assertEquals(ControlPaths.KEY, path)
        assertEquals("backspace", body["key"])
    }

    @Test
    fun `所有单键指令的 path 都应是白名单内的 api-key`() {
        // 契约 §7.4：中继只转发白名单路径，写错会被回 400 path not allowed
        assertTrue(ControlPaths.KEY in ControlPaths.ALL)
        assertTrue(ControlPaths.COMBO in ControlPaths.ALL)
        assertTrue(ControlPaths.TYPE in ControlPaths.ALL)
    }

    // ---------------- 键名映射（必须与服务端 resolve_vk 一致） ----------------

    @Test
    fun `字母键名应映射为该字母本身`() {
        // 服务端 resolve_vk 对单字母返回其 ASCII 大写（control.rs:176）
        assertEquals("a", VirtualKeyboard.toKeyName("a"))
        assertEquals("z", VirtualKeyboard.toKeyName("z"))
        assertEquals("q", VirtualKeyboard.toKeyName("q"))
    }

    @Test
    fun `特殊键名应映射为服务端认识的 vk 名`() {
        // 必须与 control.rs 的 resolve_vk match 分支一致，否则服务端返回 ok:false
        assertEquals("escape", VirtualKeyboard.toKeyName("esc"))
        assertEquals("delete", VirtualKeyboard.toKeyName("del"))
        assertEquals("capslock", VirtualKeyboard.toKeyName("caps"))
        assertEquals("backspace", VirtualKeyboard.toKeyName("backspace"))
        assertEquals("enter", VirtualKeyboard.toKeyName("enter"))
        assertEquals("tab", VirtualKeyboard.toKeyName("tab"))
        assertEquals("space", VirtualKeyboard.toKeyName("space"))
    }

    @Test
    fun `未被特殊映射的键应原样透传`() {
        // 数字与符号在原样透传时服务端能解析（resolve_vk 有对应分支）
        listOf("1", "0", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`").forEach { k ->
            assertEquals("符号 $k 应原样透传", k, VirtualKeyboard.toKeyName(k))
        }
    }

    @Test
    fun `修饰键集合应完整`() {
        assertEquals(
            setOf("ctrl", "shift", "alt", "win"),
            VirtualKeyboard.MODIFIERS.toSet(),
        )
    }

    // ---------------- 键位表完整性 ----------------

    @Test
    fun `键位表应包含完整的字母`() {
        val all = VirtualKeyboard.ROWS.flatten()
        ('a'..'z').forEach { c ->
            assertTrue("应包含字母键 $c", all.any { it == c.toString() })
        }
    }

    @Test
    fun `键位表应包含数字与常用符号`() {
        val all = VirtualKeyboard.ROWS.flatten()
        ('0'..'9').forEach { c ->
            assertTrue("应包含数字键 $c", all.any { it == c.toString() })
        }
        listOf("-", "=", "[", "]", ";", "'", ",", ".", "/", "\\", "`").forEach { s ->
            assertTrue("应包含符号键 $s", all.any { it == s })
        }
    }

    @Test
    fun `键位表应包含功能键与编辑键`() {
        val all = VirtualKeyboard.ROWS.flatten()
        listOf("f1", "f12", "esc", "backspace", "enter", "tab", "caps", "shift", "ctrl", "alt", "win", "space")
            .forEach { k -> assertTrue("应包含 $k", all.any { it == k }) }
    }

    @Test
    fun `键位表每行都不应为空`() {
        assertTrue("应有键位行", VirtualKeyboard.ROWS.isNotEmpty())
        VirtualKeyboard.ROWS.forEachIndexed { i, row ->
            assertTrue("第 $i 行不应为空", row.isNotEmpty())
        }
    }

    // ---------------- 其它指令的字段名（写错会静默无效） ----------------

    @Test
    fun `打字指令应走 api-type 且文本在 text 字段`() {
        val (path, body) = ControlCommands.type("你好")

        assertEquals(ControlPaths.TYPE, path)
        assertEquals("你好", body["text"])
    }

    @Test
    fun `鼠标指令字段名必须是 dx 与 dy`() {
        // control.rs 的 api_mouse 读 dx/dy
        val (path, body) = ControlCommands.mouse(10, -5)

        assertEquals(ControlPaths.MOUSE, path)
        assertEquals(10, body["dx"])
        assertEquals(-5, body["dy"])
    }

    @Test
    fun `滚轮指令字段名必须是 delta`() {
        // control.rs 的 api_wheel 读 delta
        val (path, body) = ControlCommands.wheel(240)

        assertEquals(ControlPaths.WHEEL, path)
        assertEquals(240, body["delta"])
    }

    @Test
    fun `点击指令字段名必须是 button`() {
        // control.rs 的 api_click 读 button
        val (path, body) = ControlCommands.click("right")

        assertEquals(ControlPaths.CLICK, path)
        assertEquals("right", body["button"])
    }

    @Test
    fun `剪贴板粘贴字段名必须是 text`() {
        val (path, body) = ControlCommands.clipboardPaste("内容")

        assertEquals(ControlPaths.CLIPBOARD_PASTE, path)
        assertEquals("内容", body["text"])
    }

    @Test
    fun `剪贴板刷新与清空应无参数`() {
        assertEquals(ControlPaths.CLIPBOARD_REFRESH, ControlCommands.clipboardRefresh().first)
        assertTrue(ControlCommands.clipboardRefresh().second.isEmpty())
        assertEquals(ControlPaths.CLIPBOARD_CLEAR, ControlCommands.clipboardClear().first)
        assertTrue(ControlCommands.clipboardClear().second.isEmpty())
    }

    @Test
    fun `所有指令的 path 都必须在白名单内`() {
        // 契约 §7.4：中继只转发白名单路径
        val all = listOf(
            ControlCommands.type("x"),
            ControlCommands.key("a"),
            ControlCommands.combo(listOf("ctrl", "c")),
            ControlCommands.mouse(1, 1),
            ControlCommands.click("left"),
            ControlCommands.wheel(1),
            ControlCommands.clipboardRefresh(),
            ControlCommands.clipboardPaste("x"),
            ControlCommands.clipboardClear(),
        )
        all.forEach { (path, _) ->
            assertTrue("路径 $path 必须在白名单里", path in ControlPaths.ALL)
        }
    }
}
