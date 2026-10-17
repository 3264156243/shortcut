package com.wanan.shortcut

import com.wanan.shortcut.feature.linked.control.ControlCommands
import com.wanan.shortcut.feature.linked.control.LanChannel
import com.wanan.shortcut.feature.linked.control.chunkByUtf8Bytes
import com.wanan.shortcut.feature.linked.control.takeUtf8Bytes
import com.wanan.shortcut.core.lan.LanClient
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 局域网控制指令的真实链路测试。
 *
 * ## 针对的真实 bug："局域网直连后打字还是没有同步"
 *
 * 查下来是**三个问题叠加**，每一个单独都足以让"打字没反应"：
 *
 * 1. **`ok:false` 被当成成功**（最致命）
 *    桌面端 `api_type` / `api_key` 的响应是
 *    `{ok: <注入是否成功>, injector: <注入器是否就绪>}`，
 *    注入失败时**依然是 HTTP 200**。
 *    早先版本只检查 HTTP 状态 → 界面认为"发送成功"，电脑却毫无反应。
 *
 * 2. **打字指令被设成 silent**，失败时连提示都没有 → 完全无从排查。
 *
 * 3. **`/api/type` 有 2000 UTF-8 字节上限**，超限直接 400；
 *    早先按字符数算（中文 1 字符 = 3 字节），一次输入几百个汉字就会超。
 */
class LanControlTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun channel() = LanChannel(
        LanClient(),
        server.url("/").toString().trimEnd('/'),
        token = "test-token",
    )

    // ---------------- ★ 核心：ok 字段 ----------------

    @Test
    fun `ok 为 true 时应判为成功`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"ok":true,"injector":true}"""),
        )

        val r = channel().call("/api/type", mapOf("text" to "a"))
        assertTrue("应成功：$r", r is com.wanan.shortcut.feature.linked.control.ControlResult.Ok)
    }

    @Test
    fun `ok 为 false 时必须判为失败`() = runBlocking {
        // 这就是"打字没同步"的直接来源：HTTP 200 但注入失败
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"ok":false,"injector":true}"""),
        )

        val r = channel().call("/api/type", mapOf("text" to "a"))
        assertTrue(
            "HTTP 200 + ok:false 必须判为失败，否则界面显示已发送而电脑毫无反应：$r",
            r is com.wanan.shortcut.feature.linked.control.ControlResult.Fail,
        )
    }

    @Test
    fun `注入器未就绪时应给出可诊断的提示`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"ok":false,"injector":false}"""),
        )

        val r = channel().call("/api/type", mapOf("text" to "a"))
        val fail = r as com.wanan.shortcut.feature.linked.control.ControlResult.Fail
        assertTrue(
            "提示应指向'注入器未就绪'，让用户知道去检查桌面端：${fail.message}",
            fail.message.contains("注入器") || fail.message.contains("没有准备好"),
        )
    }

    @Test
    fun `响应里没有 ok 字段时不应被误判为失败`() = runBlocking {
        // /api/ping、/api/status 这类不带 ok，不能因为"没有 ok"就判失败
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"authMode":"pair","injector":true}"""),
        )

        val r = channel().call("/api/ping", emptyMap())
        assertTrue("没有 ok 字段应视为成功：$r", r is com.wanan.shortcut.feature.linked.control.ControlResult.Ok)
    }

    @Test
    fun `ok 为 false 时不应把通道标记为不可用`() = runBlocking {
        // 注入失败 ≠ 网络不通。若误降级，界面会显示"未连接"，更误导
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"ok":false,"injector":true}"""),
        )

        val ch = channel()
        ch.call("/api/type", mapOf("text" to "a"))
        assertTrue("网络是通的，通道应保持可用", ch.available)
    }

    // ---------------- 打字请求形状 ----------------

    @Test
    fun `打字应发到 api-type 且文本在 text 字段`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"ok":true,"injector":true}"""),
        )

        channel().call("/api/type", ControlCommands.type("你好").second)

        val req = server.takeRequest()
        assertTrue("路径应为 /api/type：${req.path}", req.path.orEmpty().endsWith("/api/type"))
        val body = req.body.readUtf8()
        assertTrue("中文应正确编码：$body", body.contains("你好"))
    }

    @Test
    fun `打字应带 Bearer 令牌`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"ok":true,"injector":true}"""),
        )

        channel().call("/api/type", mapOf("text" to "x"))

        val req = server.takeRequest()
        assertEquals("Bearer test-token", req.getHeader("Authorization"))
    }

    // ---------------- ★ UTF-8 分片（第三个 bug） ----------------

    @Test
    fun `中文按字节截断不应超过上限`() {
        // 中文 1 字符 = 3 字节，上限 2000 字节 → 最多 666 个汉字
        val text = "中".repeat(1000)   // 3000 字节
        val chunk = text.takeUtf8Bytes(2000)

        assertTrue(
            "截断后字节数应 ≤ 2000，实际 ${chunk.toByteArray(Charsets.UTF_8).size}",
            chunk.toByteArray(Charsets.UTF_8).size <= 2000,
        )
        assertEquals("应保留 666 个汉字（666*3=1998）", 666, chunk.length)
    }

    @Test
    fun `分片后每片都不超过上限且能拼回原文`() {
        val text = "中".repeat(1000)   // 3000 字节
        val chunks = text.chunkByUtf8Bytes(2000)

        assertEquals("3000 字节 / 2000 上限 → 应切成 2 片", 2, chunks.size)
        chunks.forEach { c ->
            assertTrue(
                "每片都应 ≤ 2000 字节，实际 ${c.toByteArray(Charsets.UTF_8).size}",
                c.toByteArray(Charsets.UTF_8).size <= 2000,
            )
        }
        assertEquals("拼回来应与原文完全一致（不能切坏汉字）", text, chunks.joinToString(""))
    }

    @Test
    fun `ASCII 文本按字节分片`() {
        val text = "a".repeat(5000)   // 5000 字节
        val chunks = text.chunkByUtf8Bytes(2000)

        assertEquals(3, chunks.size)   // 2000 + 2000 + 1000
        assertEquals(2000, chunks[0].length)
        assertEquals(1000, chunks[2].length)
        assertEquals(text, chunks.joinToString(""))
    }

    @Test
    fun `空文本不应产生分片`() {
        assertTrue("".chunkByUtf8Bytes(2000).isEmpty())
    }

    @Test
    fun `恰好等于上限时应只有一片`() {
        val text = "a".repeat(2000)
        assertEquals(1, text.chunkByUtf8Bytes(2000).size)
    }

    @Test
    fun `emoji 不应被切成两半`() {
        // 😀 在 UTF-16 里是 2 个码元、UTF-8 里是 4 字节
        val text = "😀".repeat(600)   // 2400 字节
        val chunks = text.chunkByUtf8Bytes(2000)

        assertEquals("拼回应完全一致（不能出现半个 emoji）", text, chunks.joinToString(""))
        chunks.forEach { c ->
            assertTrue(c.toByteArray(Charsets.UTF_8).size <= 2000)
        }
    }

    @Test
    fun `type 应自动把超长文本截到上限内`() {
        // 即使调用方直接传超长文本，type() 也不该产出会被服务端 400 的请求
        val (path, body) = ControlCommands.type("中".repeat(1000))
        val sent = body["text"] as String

        assertEquals("/api/type", path)
        assertTrue(
            "单次 type 的字节数必须 ≤ 2000：${sent.toByteArray(Charsets.UTF_8).size}",
            sent.toByteArray(Charsets.UTF_8).size <= 2000,
        )
    }

    @Test
    fun `typeChunks 对短文本应只产出一片`() {
        val chunks = ControlCommands.typeChunks("你好")
        assertEquals(1, chunks.size)
        assertEquals("你好", chunks[0].second["text"])
    }

    @Test
    fun `typeChunks 对超长文本应产出多片且顺序保持`() {
        val text = (1..800).joinToString("") { "字" }   // 2400 字节
        val chunks = ControlCommands.typeChunks(text)

        assertTrue("应切成多片", chunks.size > 1)
        val rejoined = chunks.joinToString("") { it.second["text"] as String }
        assertEquals("顺序与内容应与原文一致", text, rejoined)
        chunks.forEach {
            assertEquals("/api/type", it.first)
        }
    }

    // ---------------- 其它指令的 ok 语义 ----------------

    @Test
    fun `单键的 ok 为 false 也应判为失败`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"ok":false,"injector":true}"""),
        )

        val r = channel().call("/api/key", mapOf("key" to "a"))
        assertTrue(
            "退格等单键同理：ok:false 必须判失败",
            r is com.wanan.shortcut.feature.linked.control.ControlResult.Fail,
        )
    }

    @Test
    fun `网络失败时通道应降级为不可用`() = runBlocking {
        // 与"注入失败"相反：连不上才是真的不可用，界面应显示未连接
        val ch = LanChannel(LanClient(), "http://192.0.2.1:9823", "t")
        ch.call("/api/type", mapOf("text" to "a"))
        assertFalse("网络不通应降级", ch.available)
    }
}
