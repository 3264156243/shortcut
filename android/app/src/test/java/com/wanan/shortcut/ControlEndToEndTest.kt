package com.wanan.shortcut

import com.wanan.shortcut.core.lan.LanClient
import com.wanan.shortcut.feature.linked.control.ControlCommands
import com.wanan.shortcut.feature.linked.control.ControlResult
import com.wanan.shortcut.feature.linked.control.LanChannel
import com.wanan.shortcut.feature.linked.control.TextDiffSync
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * **端到端**验证"打字 → 差量 → 发出 → 桌面端收到"整条链路。
 *
 * ## 为什么需要这个测试
 *
 * 用户连续两次反馈"打字没同步、任何提示没有"。
 * 之前我都是分段测（差量算法单独测、ok 字段单独测），
 * 但**没有一条测试验证"用户打字后，桌面端真的收到了什么"**。
 *
 * 这个测试把整条链路串起来：
 * ```
 * 模拟用户输入 "你" → "你好"
 *   → TextDiffSync 算差量
 *   → ControlCommands.type()
 *   → LanChannel（真实 OkHttp 打到 MockWebServer）
 *   → 断言服务端收到的请求体
 * ```
 * 若某天某一段坏了，这里会直接红，而不是等用户报"没反应"。
 */
class ControlEndToEndTest {

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
        token = "tok",
    )

    private fun okResponse() =
        MockResponse().setResponseCode(200).setBody("""{"ok":true,"injector":true}""")

    /**
     * 模拟一次完整的打字会话：用户逐字输入，验证服务端收到的**文本序列**。
     *
     * 这是最接近真机的验证：不是"某一次调用对不对"，
     * 而是"用户敲了几下键盘之后，电脑上应该依次收到什么"。
     */
    @Test
    fun `逐字输入时服务端应按顺序收到增量文本`() = runBlocking {
        val received = ConcurrentLinkedQueue<String>()
        repeat(3) { server.enqueue(okResponse()) }

        val sync = TextDiffSync()
        val ch = channel()

        // 用户依次输入 "a" → "ab" → "abc"
        for (buffer in listOf("a", "ab", "abc")) {
            for (action in sync.onBufferChanged(buffer)) {
                when (action) {
                    is com.wanan.shortcut.feature.linked.control.SyncAction.TypeText -> {
                        val (path, body) = ControlCommands.type(action.text)
                        val r = ch.call(path, body)
                        assertTrue("发送应成功：$r", r is ControlResult.Ok)
                    }
                    is com.wanan.shortcut.feature.linked.control.SyncAction.PressKey -> {
                        val (path, body) = ControlCommands.key(action.key)
                        ch.call(path, body)
                    }
                }
            }
        }

        // 收集服务端收到的文本
        repeat(3) {
            val req = server.takeRequest()
            val body = req.body.readUtf8()
            val text = Regex("\"text\":\"([^\"]*)\"").find(body)?.groupValues?.get(1)
            if (text != null) received.add(text)
        }

        assertEquals(
            "每次只应发增量：a / b / c（而不是整段重发）",
            listOf("a", "b", "c"),
            received.toList(),
        )
    }

    @Test
    fun `中文输入应发正确的中文而不是拼音`() = runBlocking {
        val sync = TextDiffSync()
        val ch = channel()
        server.enqueue(okResponse())

        // 模拟输入法最终提交"你好"
        val actions = sync.onBufferChanged("你好")
        assertEquals("首次输入应发整段", 1, actions.size)

        val (path, body) = ControlCommands.type((actions[0] as com.wanan.shortcut.feature.linked.control.SyncAction.TypeText).text)
        ch.call(path, body)

        val req = server.takeRequest()
        val raw = req.body.readUtf8()
        assertTrue("请求体应含中文'你好'：$raw", raw.contains("你好"))
        assertTrue("路径应为 /api/type", req.path.orEmpty().endsWith("/api/type"))
    }

    @Test
    fun `退格应按次数发出 api-key 请求`() = runBlocking {
        val sync = TextDiffSync()
        val ch = channel()
        // 首次输入 "abc" 会发一次 type，之后删到 "a" 应发 2 次退格
        server.enqueue(okResponse())
        run {
            val actions = sync.onBufferChanged("abc")
            val (p, b) = ControlCommands.type((actions[0] as com.wanan.shortcut.feature.linked.control.SyncAction.TypeText).text)
            ch.call(p, b)
            server.takeRequest()
        }

        val actions = sync.onBufferChanged("a")
        assertEquals("应退 2 格", 2, actions.size)
        actions.forEach { a ->
            server.enqueue(okResponse())
            val (p, b) = ControlCommands.key((a as com.wanan.shortcut.feature.linked.control.SyncAction.PressKey).key)
            ch.call(p, b)
        }

        repeat(2) {
            val req = server.takeRequest()
            assertTrue("退格应走 /api/key：${req.path}", req.path.orEmpty().endsWith("/api/key"))
            assertTrue("键名应为 backspace", req.body.readUtf8().contains("backspace"))
        }
    }

    @Test
    fun `桌面端拒绝时用户能看到失败`() = runBlocking {
        // injector 未就绪 → 这是"打字没反应"最可能的现场
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"ok":false,"injector":false}"""),
        )

        val ch = channel()
        val (path, body) = ControlCommands.type("a")
        val r = ch.call(path, body)

        assertTrue("应失败：$r", r is ControlResult.Fail)
        val msg = (r as ControlResult.Fail).message
        assertTrue("提示应可理解：$msg", msg.isNotBlank())
        assertTrue(
            "应指出是注入器问题：$msg",
            msg.contains("注入器") || msg.contains("没有准备好"),
        )
    }

    @Test
    fun `超长文本应分片发出且不会超过单次上限`() = runBlocking {
        val text = "字".repeat(900)   // 2700 字节，超过 2000 上限
        val chunks = ControlCommands.typeChunks(text)

        assertTrue("应切成多片", chunks.size >= 2)
        chunks.forEach { (path, body) ->
            assertEquals("/api/type", path)
            val t = body["text"] as String
            assertTrue(
                "每片字节数应 ≤ 2000，实际 ${t.toByteArray(Charsets.UTF_8).size}",
                t.toByteArray(Charsets.UTF_8).size <= 2000,
            )
        }
        assertEquals("拼回应与原文一致", text, chunks.joinToString("") { it.second["text"] as String })
    }
}
