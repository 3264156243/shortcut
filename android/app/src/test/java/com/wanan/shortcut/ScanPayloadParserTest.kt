package com.wanan.shortcut

import com.wanan.shortcut.feature.bind.scan.ScanPayloadParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 二维码内容解析测试（对齐 web `bind/index.html` 的 `connectWithScannedValue`）。
 *
 * ## 为什么这段逻辑值得单独测
 *
 * 摄像头与相册识别依赖 Android 运行时，难以纯 JVM 测试；
 * 而"扫到什么 → 用哪个字段绑定"这段**纯逻辑**恰恰最容易写错：
 * 例如把 24 位 bindId 当成 6 位码发出去 → 服务端回 `绑定码无效`，
 * 而用户看到的是"扫了却绑不上"，很难定位。
 */
class ScanPayloadParserTest {

    private val bindId = "0QIIVPkdtT32rxnpe19Dt3lB"

    // ---------------- 绑定链接（桌面端二维码最常见的内容） ----------------

    @Test
    fun `解析桌面端绑定链接应取出 bindId`() {
        // web 的 renderQR 生成的就是这个形状
        val url = "https://shortcut.326415.xyz/mobile/?bind=$bindId"
        val parsed = ScanPayloadParser.parse(url)

        assertEquals(bindId, parsed.bindId)
        assertNull("这条链接没有 code，不该瞎猜", parsed.code)
    }

    @Test
    fun `解析带 code 的绑定链接应取出 code`() {
        val parsed = ScanPayloadParser.parse("https://shortcut.326415.xyz/bind/?code=F92XSE")

        assertEquals("F92XSE", parsed.code)
        assertNull(parsed.bindId)
    }

    @Test
    fun `链接同时带 bind 与 code 时两个都取到`() {
        // 契约 §2.6：bindId 优先；两个都有也能正确处理（调用方优先用 bindId）
        val parsed = ScanPayloadParser.parse(
            "https://shortcut.326415.xyz/mobile/?bind=$bindId&code=F92XSE",
        )

        assertEquals(bindId, parsed.bindId)
        assertEquals("F92XSE", parsed.code)
    }

    @Test
    fun `参数顺序无关`() {
        val parsed = ScanPayloadParser.parse(
            "https://shortcut.326415.xyz/mobile/?ref=qr&bind=$bindId&x=1",
        )
        assertEquals(bindId, parsed.bindId)
    }

    @Test
    fun `自定义 scheme 的二维码也能解析`() {
        // 不用 java.net.URL 解析的原因之一：非 http(s) scheme 会让 URL 抛异常
        val parsed = ScanPayloadParser.parse("shortcut://bind?bind=$bindId")
        assertEquals(bindId, parsed.bindId)
    }

    // ---------------- 裸 6 位码 ----------------

    @Test
    fun `裸 6 位码应被当作 code`() {
        val parsed = ScanPayloadParser.parse("F92XSE")

        assertEquals("F92XSE", parsed.code)
        assertNull(parsed.bindId)
    }

    @Test
    fun `裸 6 位码的大小写应统一为大写`() {
        // 契约 §2.2：绑定码大小写不敏感，但本地统一大写更可控
        assertEquals("F92XSE", ScanPayloadParser.parse("f92xse").code)
        assertEquals("ABC123", ScanPayloadParser.parse("AbC123").code)
    }

    @Test
    fun `前后空白应被忽略`() {
        assertEquals("F92XSE", ScanPayloadParser.parse("  F92XSE  ").code)
        assertEquals(bindId, ScanPayloadParser.parse("  https://x/mobile/?bind=$bindId  ").bindId)
    }

    // ---------------- 无效内容 ----------------

    @Test
    fun `空内容应解析为空`() {
        assertTrue(ScanPayloadParser.parse(null).isEmpty)
        assertTrue(ScanPayloadParser.parse("").isEmpty)
        assertTrue(ScanPayloadParser.parse("   ").isEmpty)
    }

    @Test
    fun `普通网址不应被误当成绑定信息`() {
        val parsed = ScanPayloadParser.parse("https://www.example.com/some/page")

        assertTrue("无关网址不该产生凭证", parsed.isEmpty)
    }

    @Test
    fun `长度不对的码不应被当成绑定码`() {
        // 5 位 / 7 位都不是合法绑定码（契约 §2.1：恰好 6 位）
        assertTrue(ScanPayloadParser.parse("F92XS").isEmpty)
        assertTrue(ScanPayloadParser.parse("F92XSE7").isEmpty)
    }

    @Test
    fun `纯文本不应被误判`() {
        assertTrue(ScanPayloadParser.parse("这是一段中文文本").isEmpty)
        assertTrue(ScanPayloadParser.parse("hello world").isEmpty)
    }

    @Test
    fun `link 里 bind 为空时不应产生空 bindId`() {
        val parsed = ScanPayloadParser.parse("https://shortcut.326415.xyz/mobile/?bind=")

        assertNull("空值不该被当成有效 bindId", parsed.bindId)
        assertTrue(parsed.isEmpty)
    }

    @Test
    fun `link 里 code 形状不合法时不应取它`() {
        // code 只接受正好 6 位字母数字；过长的值不该被当成绑定码
        val parsed = ScanPayloadParser.parse("https://x/bind/?code=TOOLONGCODE")
        assertNull(parsed.code)
    }

    @Test
    fun `百分号编码的参数应被解码`() {
        // bindId 是 base62 一般无需编码，但 URL 里可能被编码过
        val parsed = ScanPayloadParser.parse("https://x/mobile/?bind=0QIIVPkdtT32rxnpe19Dt3lB%20")
        assertEquals(bindId, parsed.bindId)
    }

    // ---------------- 与 web 行为一致性 ----------------

    @Test
    fun `与 web 一致_优先返回 bindId 以便调用方走契约的 bindId 优先路径`() {
        // web：先试 bindId，失败再用 code（契约 §2.6 也是 bindId 优先）
        val parsed = ScanPayloadParser.parse("https://x/mobile/?bind=$bindId&code=F92XSE")

        assertTrue("bindId 必须解析出来", !parsed.bindId.isNullOrBlank())
        // 调用方的顺序应当是：先看 bindId，再看 code —— 在 BindScreen 里如此实现
    }
}
