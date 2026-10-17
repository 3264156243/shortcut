package com.wanan.shortcut

import com.wanan.shortcut.feature.linked.control.LanQrPayload
import com.wanan.shortcut.feature.linked.control.VirtualKeyboard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 虚拟键盘字母键的 **VK 大小写** 测试。
 *
 * ## 针对的真实 bug（用户反馈："点字母，实际到电脑的是些快捷键"）
 *
 * 桌面端 `resolve_vk` 对单字符的处理：
 * ```rust
 * if bytes.len() == 1 && bytes[0].is_ascii_alphabetic() {
 *     return Some(bytes[0] as u32);   // 'a' → 0x61
 * }
 * ```
 * 而 `inject.ps1` 的 `SendVk` 把这个值**直接当 Windows 虚拟键码**发给 `SendInput`。
 *
 * Windows 里字母键的 VK 是**大写 ASCII**：
 *   - `VK_A` = `0x41`
 *   - 小写 `a` = `0x61` = **VK_NUMPAD1（小键盘 1）**
 *   - 小写 `z` = `0x7A` = **VK_F11**
 *
 * 于是点字母会落到小键盘数字与 F 键上 —— 用户看到的正是"些快捷键"。
 *
 * 这个测试把"字母必须大写发送"这条规则固化，防止回退。
 */
class VirtualKeyboardVkTest {

    // ---------------- ★ 核心：字母必须转大写 ----------------

    @Test
    fun `字母键必须发大写`() {
        // 小写 'a'(0x61) 在 Windows 里是小键盘 1，必须转成 'A'(0x41)
        assertEquals("A", VirtualKeyboard.toServerKey("a"))
        assertEquals("Z", VirtualKeyboard.toServerKey("z"))
        assertEquals("Q", VirtualKeyboard.toServerKey("q"))
    }

    @Test
    fun `全部 26 个字母都要转大写`() {
        ('a'..'z').forEach { c ->
            val sent = VirtualKeyboard.toServerKey(c.toString())
            assertEquals(
                "字母 $c 应发成大写（否则会落到小键盘/F 键上）",
                c.uppercase(),
                sent,
            )
            // 大写 VK 应落在 0x41..0x5A（A..Z）
            val vk = sent[0].code
            assertTrue(
                "字母 $c 的 VK 应在 0x41..0x5A，实际 0x${vk.toString(16)}",
                vk in 0x41..0x5A,
            )
        }
    }

    @Test
    fun `小写字母直接当 VK 会落到错误按键上`() {
        // 这条测试本身不调用产品代码，而是**证明这个 bug 的机理**，
        // 防止有人"觉得发小写也行"而改回去。
        val lowerA = 'a'.code          // 0x61
        val upperA = 'A'.code          // 0x41
        assertEquals("小写 a = 0x61 = VK_NUMPAD1", 0x61, lowerA)
        assertEquals("大写 A = 0x41 = VK_A", 0x41, upperA)
        assertTrue("两者不同，所以必须转换", lowerA != upperA)

        val lowerZ = 'z'.code          // 0x7A
        assertEquals("小写 z = 0x7A = VK_F11", 0x7A, lowerZ)
    }

    // ---------------- 不应被误转的键 ----------------

    @Test
    fun `数字键不应被改变`() {
        // '1' = 0x31 正好是 VK_1，数字与 ASCII 一致，无需转换
        ('0'..'9').forEach { c ->
            assertEquals("数字 $c 的 VK 与 ASCII 一致，不应改动", c.toString(), VirtualKeyboard.toServerKey(c.toString()))
        }
    }

    @Test
    fun `功能键名不应被改动`() {
        listOf("escape", "backspace", "delete", "capslock", "enter", "tab", "space")
            .forEach { k ->
                assertEquals("键名 $k 应原样发送", k, VirtualKeyboard.toServerKey(k))
            }
    }

    @Test
    fun `esc 与 caps 这类简写仍要映射成服务端认识的名字`() {
        assertEquals("escape", VirtualKeyboard.toServerKey("esc"))
        assertEquals("delete", VirtualKeyboard.toServerKey("del"))
        assertEquals("capslock", VirtualKeyboard.toServerKey("caps"))
    }

    @Test
    fun `符号键应原样发送`() {
        listOf("`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/").forEach { s ->
            assertEquals("符号 $s 应原样发送", s, VirtualKeyboard.toServerKey(s))
        }
    }
}

/**
 * 局域网扫码内容的解析测试。
 *
 * 桌面端状态卡二维码的内容（读 `src/components/ControlPanel.tsx` 确认）：
 * ```
 * 局域网：http://192.168.x.x:9823/?token=<预授权令牌>   ← 扫码即连
 * 云端：  https://shortcut.326415.xyz/control/app/
 * ```
 */
class LanQrPayloadTest {

    @Test
    fun `应解析出带令牌的局域网地址`() {
        val r = LanQrPayload.parse("http://192.168.1.5:9823/?token=abc123")
        assertTrue("应识别为局域网码：$r", r is LanQrPayload.Result.Lan)
        val lan = r as LanQrPayload.Result.Lan
        assertEquals("192.168.1.5:9823", lan.host)
        assertEquals("abc123", lan.token)
    }

    @Test
    fun `没有端口时应补默认端口 9823`() {
        val r = LanQrPayload.parse("http://192.168.1.5/?token=x") as LanQrPayload.Result.Lan
        assertEquals("192.168.1.5:9823", r.host)
        assertEquals("x", r.token)
    }

    @Test
    fun `令牌经过 URL 编码时应正确解码`() {
        // 令牌里可能出现被编码的字符
        val r = LanQrPayload.parse("http://10.0.0.2:9823/?token=a%2Bb%3D") as LanQrPayload.Result.Lan
        assertEquals("a+b=", r.token)
    }

    @Test
    fun `不带令牌的纯地址也应解析（桌面端 lanEntry 未就绪时会退化成这种）`() {
        val r = LanQrPayload.parse("http://192.168.1.7:9823") as LanQrPayload.Result.Lan
        assertEquals("192.168.1.7:9823", r.host)
        assertEquals("无令牌，应走配对流程", "", r.token)
    }

    @Test
    fun `云端控制页二维码应被明确识别`() {
        // 扫错了码要给清楚的指引，而不是"连不上"
        val r = LanQrPayload.parse("https://shortcut.326415.xyz/control/app/")
        assertTrue("应识别为云端控制页：$r", r is LanQrPayload.Result.CloudControlPage)
    }

    @Test
    fun `绑定二维码不应被当成控制码`() {
        val r = LanQrPayload.parse("shortcut://bind?code=ABC123")
        assertTrue("应是 Unknown：$r", r is LanQrPayload.Result.Unknown)
        assertTrue(
            "提示应说明这是绑定码：${(r as LanQrPayload.Result.Unknown).reason}",
            r.reason.contains("绑定"),
        )
    }

    @Test
    fun `乱七八糟的内容应被拒绝`() {
        listOf("hello", "12345", "", "   ", "ftp://x").forEach { raw ->
            val r = LanQrPayload.parse(raw)
            assertTrue("'$raw' 应被拒绝，实际 $r", r is LanQrPayload.Result.Unknown)
        }
    }

    @Test
    fun `token 在其他参数之后也应能取出`() {
        val r = LanQrPayload.parse("http://192.168.1.5:9823/?foo=1&token=xyz&bar=2")
            as LanQrPayload.Result.Lan
        assertEquals("xyz", r.token)
    }
}
