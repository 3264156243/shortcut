package com.wanan.shortcut

import com.wanan.shortcut.core.lan.LanClient
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 局域网探测测试 —— 针对用户反馈"**局域网都无法连接**"。
 *
 * ## 这段逻辑为什么必须有
 *
 * 桌面端用 `UdpSocket.connect("8.8.8.8:80")` 探测"默认出口网卡"来生成局域网地址
 * （`src-tauri/src/control.rs` 的 `lan_urls()`）。装了 VMware / VirtualBox / Docker
 * 的电脑上，这个探测**很容易选中虚拟网卡**，给出手机连不上的 IP
 * （如 `192.168.56.1`）。而且那个函数的"双网卡补充"**并未实现**，
 * 所以 `urls` 实际只有一个候选，选错就没有备选。
 *
 * web 端拿到地址后是"浏览器直接跳转"，失败就是白屏。
 * 安卓端若照抄，就会表现为：
 *   **界面显示"已直连"，但每条指令都失败** —— 用户完全看不出问题在哪。
 *
 * 因此这里先探测，只连真正可达的候选。
 */
class LanProbeTest {

    private lateinit var server: MockWebServer
    private val client = LanClient()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun baseUrl() = server.url("/").toString().trimEnd('/')

    // ---------------- 可达性判定 ----------------

    @Test
    fun `可达且是控制服务时 probe 应判定成功`() = runBlocking {
        // /api/config 的真实响应形状（契约 §8.4）
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"authMode":"pair","requirePair":true,"basePath":""}"""),
        )

        val r = client.probe(baseUrl())

        assertTrue("应判定可达", r.reachable)
        assertTrue("应识别出这是控制服务（有 authMode）", r.isControlService)
        assertNull(r.failure)
    }

    @Test
    fun `可达但不是控制服务时仍算可达但标记非服务`() {
        runBlocking {
            // 例如连上了路由器管理页：HTTP 200 但不是我们的服务
            server.enqueue(
                MockResponse().setResponseCode(200).setBody("<html>router admin</html>"),
            )

            val r = client.probe(baseUrl())
            assertTrue("HTTP 通了就算可达", r.reachable)
            assertFalse("但不是 ShortCut 控制服务", r.isControlService)
        }
    }

    @Test
    fun `服务端返回错误码时不应判定为可达`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(500).setBody("oops"))

        val r = client.probe(baseUrl())
        assertFalse("HTTP 500 不该算可达", r.reachable)
        assertNotNull("应记录失败原因", r.failure)
    }

    @Test
    fun `地址不可达时应返回失败而不是抛异常`() = runBlocking {
        // 用一个几乎必然连不上的地址（保留测试网段，连接会超时/拒绝）
        val r = client.probe("http://192.0.2.1:9823")

        assertFalse("不可达", r.reachable)
        assertNotNull("应给出失败原因供 UI 显示", r.failure)
    }

    // ---------------- 多候选：这是本修复的核心 ----------------

    @Test
    fun `应从多个候选中挑出真正可达的那个`() = runBlocking {
        // 场景还原：桌面端给了虚拟网卡地址（连不上）+ 真实地址（连得上）
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"authMode":"pair","requirePair":true,"basePath":""}"""),
        )

        val candidates = listOf(
            "http://192.0.2.1:9823",        // 模拟"虚拟网卡地址"，不可达
            baseUrl(),                       // 真实可达的
        )

        val hit = client.probeFirstReachable(candidates)

        assertNotNull("应该找到可达的那个候选", hit)
        assertTrue("命中的应是真实地址", hit!!.reachable)
        assertTrue("且被识别为控制服务", hit.isControlService)
    }

    @Test
    fun `全部候选都不可达时应返回 null`() = runBlocking {
        val hit = client.probeFirstReachable(
            listOf("http://192.0.2.1:9823", "http://192.0.2.2:9823"),
        )
        assertNull("一个都连不上时应返回 null，让 UI 给出可诊断的提示", hit)
    }

    @Test
    fun `候选列表应去重且跳过空值`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"authMode":"pair"}"""),
        )

        // 含重复与空白：应当只真正探测一次
        val hit = client.probeFirstReachable(
            listOf("", "  ", baseUrl(), baseUrl(), "${baseUrl()}/"),
        )

        assertNotNull(hit)
        assertEquals("重复与空白应被去重，只打一次请求", 1, server.requestCount)
    }

    @Test
    fun `空候选列表不应发起任何请求`() = runBlocking {
        val hit = client.probeFirstReachable(emptyList())

        assertNull(hit)
        assertEquals("没有候选就不该发请求", 0, server.requestCount)
    }

    @Test
    fun `候选地址末尾斜杠应被规范化避免双斜杠`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"authMode":"pair"}"""),
        )

        client.probeFirstReachable(listOf("${baseUrl()}/"))

        val path = server.takeRequest().path.orEmpty()
        assertTrue(
            "不应出现 //api/config 这种双斜杠路径：$path",
            !path.contains("//api"),
        )
        assertTrue("应请求 /api/config", path.endsWith("/api/config"))
    }

    // ---------------- 探测用的是无需鉴权的接口 ----------------

    @Test
    fun `探测应请求 api-config 且不带鉴权头`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"authMode":"pair"}"""),
        )

        client.probe(baseUrl())

        val recorded = server.takeRequest()
        assertTrue("应打 /api/config", recorded.path.orEmpty().endsWith("/api/config"))
        assertEquals("GET 方法", "GET", recorded.method)
        // 契约 §8.4：/api/config 无需鉴权；探测阶段也还没拿到 token
        assertNull("不该带 Authorization", recorded.getHeader("Authorization"))
    }

    // ---------------- ★ 不依赖云端的局域网路径：status + pair ----------------

    @Test
    fun `status 应能读到 authMode 与配对码`() = runBlocking {
        // 电脑端 /api/status 的真实形状（src-tauri/src/control.rs:340）
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"authMode":"pair","pairCode":"482913","clients":0,
                   "urls":["http://192.168.1.5:9823"],"basePath":"",
                   "recent":[],"injector":true}""",
            ),
        )

        val r = client.status(baseUrl())

        assertTrue("status 应成功：$r", r is ApiResult.Ok)
        val data = (r as ApiResult.Ok).data
        assertEquals("pair", data.get("authMode").asString)
        assertEquals("应能读到配对码（这是不依赖云端的关键）", "482913", data.get("pairCode").asString)
        assertTrue("应返回 injector 就绪状态", data.get("injector").asBoolean)
    }

    @Test
    fun `status 请求不应带鉴权头`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"authMode":"pair","pairCode":"111111"}"""),
        )

        client.status(baseUrl())

        val recorded = server.takeRequest()
        assertTrue(recorded.path.orEmpty().endsWith("/api/status"))
        assertNull("无需鉴权（契约 §8.4）", recorded.getHeader("Authorization"))
    }

    @Test
    fun `pair 应把配对码放在请求体里并换回 token`() = runBlocking {
        // 电脑端 api_pair 读 body.code（control.rs:372）
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"token":"tok_abc123"}"""),
        )

        val r = client.pair(baseUrl(), "482913")

        assertTrue("配对应成功：$r", r is ApiResult.Ok)
        assertEquals("tok_abc123", (r as ApiResult.Ok).data)

        val body = server.takeRequest().body.readUtf8()
        assertTrue("配对码必须在 body 的 code 字段里：$body", body.contains("\"code\":\"482913\""))
    }

    @Test
    fun `配对码错误时 pair 应返回业务失败并带上服务端文案`() = runBlocking {
        // control.rs:378 用 401 + {"error":"绑定码错误"}
        server.enqueue(
            MockResponse().setResponseCode(401).setBody("""{"error":"绑定码错误"}"""),
        )

        val r = client.pair(baseUrl(), "000000")

        assertTrue("应为失败：$r", r is ApiResult.BusinessFail)
        assertTrue(
            "应保留服务端文案供用户判断：${(r as ApiResult.BusinessFail).message}",
            r.message.contains("绑定码错误"),
        )
    }

    @Test
    fun `pair 返回体缺 token 时应判为失败`() = runBlocking {
        // 防御：服务端异常时可能给个空对象，不能让调用方拿着空 token 去连
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val r = client.pair(baseUrl(), "482913")
        assertTrue("拿不到 token 应判失败：$r", r is ApiResult.TransportFail)
    }

    @Test
    fun `authMode 非 pair 时不应要求配对码`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"authMode":"none","pairCode":null,"urls":[],"injector":true}"""),
        )

        val r = client.status(baseUrl())
        val data = (r as ApiResult.Ok).data
        assertEquals("none", data.get("authMode").asString)
        assertTrue("pairCode 为 null 是合法的", data.get("pairCode").isJsonNull)
    }

    // ---------------- 配对后的控制指令带 Bearer ----------------

    @Test
    fun `控制指令应带 Bearer 令牌`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"ok":true,"injector":true}"""),
        )

        client.post(baseUrl(), token = "tok_abc123", path = "/api/ping")

        val recorded = server.takeRequest()
        assertTrue(recorded.path.orEmpty().endsWith("/api/ping"))
        assertEquals("Bearer tok_abc123", recorded.getHeader("Authorization"))
        assertEquals("契约 §8.3：x-token 也接受，两个都带更稳", "tok_abc123", recorded.getHeader("x-token"))
    }
}
