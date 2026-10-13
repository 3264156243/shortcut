package com.wanan.shortcut

import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.identity.IdentitySource
import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.feature.linked.taskwall.PushResponse
import com.wanan.shortcut.feature.linked.taskwall.TaskwallRepository
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 任务墙**真实网络链路**测试（用 MockWebServer）。
 *
 * ## 为什么必须有这一层测试
 *
 * 之前只有两类测试：协议层纯函数（解析 JSON 字符串）和注册表逻辑。
 * 它们都**不执行 [ApiClient] 里真正发请求的那段代码** ——
 * 于是出现了"编译通过、单测全绿，但功能从没在 App 里跑通过"的尴尬局面。
 *
 * 本类用真实的 `OkHttp` 打到本地 MockWebServer，覆盖：
 *   请求体形状（含身份注入、严格布尔）→ HTTP 往返 → 响应解析 → 状态映射
 *
 * 相比"打真实线上服务器"，MockWebServer 的优势是**确定性**：
 * 不依赖网络、不会在服务端留下测试数据、可复现异常分支。
 * 真实线上服务器的联调见 [LiveServerSmokeTest]。
 */
class TaskwallMockServerTest {

    private lateinit var server: MockWebServer

    /** 内存身份，避免依赖 Android Context（这正是抽出 IdentitySource 的目的）。 */
    private class FakeIdentity(
        private var identity: Identity,
    ) : IdentitySource {
        var rejectCount = 0
            private set

        override fun current(): Identity = identity

        override suspend fun onTokenRejected() {
            rejectCount++
            identity = Identity("", "", identity.deviceKey, "", "")
        }
    }

    private fun repo(identity: IdentitySource): TaskwallRepository {
        val client = ApiClient(
            identityProvider = identity,
            errorMapper = ErrorMapper(),
            baseUrl = server.url("/sync/api.php").toString(),
            client = OkHttpClient(),
        )
        return TaskwallRepository(client)
    }

    private fun boundIdentity() = FakeIdentity(
        Identity(
            bindId = "0QIIVPkdtT32rxnpe19Dt3lB",
            mobileToken = "a".repeat(48),
            deviceKey = "aa11bb22cc33dd44ee55ff66",
            deviceId = "853c7925f726f0952a86eabd",
            deviceName = "测试机",
        ),
    )

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    // ---------------- 请求体形状（最容易写错的地方） ----------------

    @Test
    fun `pull 请求应带 board=taskwall 与自动注入的身份`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"tasks":[],"count":0}"""),
        )

        repo(boundIdentity()).pull()

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        val body = recorded.body.readUtf8()

        // 契约 §5：queue 接口必须显式带 board="taskwall"
        assertTrue("必须带 board=taskwall，否则服务端回「暂不支持的板块」", body.contains("\"board\":\"taskwall\""))
        // 身份必须由 ApiClient 自动注入（板块不该自己拼）
        assertTrue(body.contains("\"bindId\":\"0QIIVPkdtT32rxnpe19Dt3lB\""))
        assertTrue(body.contains("\"mobileToken\":\"${"a".repeat(48)}\""))
        assertTrue(body.contains("\"action\":\"pull\""))
    }

    @Test
    fun `push 的布尔字段必须是 JSON 原生 true 而不是字符串`() = runBlocking {
        // 契约 §5.1：longText / reminderEnabled 要**严格 === true** 才生效。
        // 发成字符串 "true" 服务端会静默忽略（不报错！）—— 最难查的一类 bug。
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"taskId":"rmt_a03a334713ebe3e8b9bdc04e","deliveredRealtime":true,"desktopOnline":true}"""),
        )

        repo(boundIdentity()).push(
            text = "测试任务",
            longText = true,
            details = "详情内容",
            reminderEnabled = true,
            reminderAtIso = "2026-10-14T02:00:00.000Z",
            boardName = "默认任务墙",
        )

        val body = server.takeRequest().body.readUtf8()

        // 必须是裸 true，不能是 "true"
        assertTrue("longText 必须是 JSON 原生 true：$body", body.contains("\"longText\":true"))
        assertFalse("绝不能发成字符串 \"true\"", body.contains("\"longText\":\"true\""))
        assertTrue("reminderEnabled 必须是 JSON 原生 true", body.contains("\"reminderEnabled\":true"))
        assertFalse(body.contains("\"reminderEnabled\":\"true\""))

        // 中文字段必须正确编码（UTF-8），不能乱码
        assertTrue("中文必须正确编码", body.contains("测试任务"))
    }

    @Test
    fun `未开长文本时不应带 details 字段`() = runBlocking {
        // 契约 §5.1：details 仅当 longText===true 才被读取。
        // 不带它可以让请求形状与网页端参考实现一致。
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"taskId":"rmt_x","deliveredRealtime":false,"desktopOnline":false}"""),
        )

        repo(boundIdentity()).push(text = "普通任务", longText = false, details = "不该被带上")

        val body = server.takeRequest().body.readUtf8()
        assertFalse("longText=false 时不应带 details", body.contains("details"))
        assertFalse("也不应带 longText 字段", body.contains("longText"))
    }

    @Test
    fun `ack 应把 taskIds 序列化为 JSON 数组`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"removed":1}"""),
        )

        repo(boundIdentity()).ack(listOf("rmt_a03a334713ebe3e8b9bdc04e"))

        val body = server.takeRequest().body.readUtf8()
        assertTrue("taskIds 必须是数组：$body", body.contains("\"taskIds\":[\"rmt_a03a334713ebe3e8b9bdc04e\"]"))
    }

    @Test
    fun `ack 空数组应在本地拦截不发请求`() = runBlocking {
        // 服务端会回「缺少待确认任务」；本地拦掉可以省一次往返，
        // 但必须返回业务失败语义而不是抛异常。
        val r = repo(boundIdentity()).ack(emptyList())

        assertTrue(r is ApiResult.BusinessFail)
        assertEquals("缺少待确认任务", (r as ApiResult.BusinessFail).message)
        assertEquals("不该发出请求", 0, server.requestCount)
    }

    // ---------------- 响应解析 ----------------

    @Test
    fun `pull 能解析出完整的任务字段`() = runBlocking {
        // 用**线上实测的真实响应形状**
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"tasks":[{"id":"rmt_a03a334713ebe3e8b9bdc04e",
                   "text":"安卓端测试任务","longText":true,"details":"这是长文本详情",
                   "reminderEnabled":true,"reminderAt":"2026-10-14T02:00:00.000Z",
                   "boardName":"","createdAt":"2026-10-14T09:00:00+08:00"}],"count":1}""",
            ),
        )

        val r = repo(boundIdentity()).pull()
        assertTrue("应成功", r is ApiResult.Ok)

        val task = (r as ApiResult.Ok).data.tasks.first()
        assertEquals("rmt_a03a334713ebe3e8b9bdc04e", task.id)
        assertEquals("安卓端测试任务", task.text)
        assertTrue(task.longText)
        assertEquals("这是长文本详情", task.details)
        assertTrue(task.reminderEnabled)
    }

    @Test
    fun `push 的 deliveredRealtime 为 false 时仍是成功`() = runBlocking {
        // 契约 §5.1：桌面离线时 false，但任务已入队 —— 不是失败
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"taskId":"rmt_a03a334713ebe3e8b9bdc04e","deliveredRealtime":false,"desktopOnline":false}""",
            ),
        )

        val r = repo(boundIdentity()).push(text = "离线任务")
        assertTrue(r is ApiResult.Ok)
        val data = (r as ApiResult.Ok).data
        assertFalse(data.deliveredRealtime)
        assertEquals("rmt_a03a334713ebe3e8b9bdc04e", data.taskId)
    }

    // ---------------- 失败语义（契约最反直觉的部分） ----------------

    @Test
    fun `HTTP 200 但 success=false 必须判为业务失败`() = runBlocking {
        // 契约 §1.2 / §10.2 陷阱 #3：api.php 业务失败也是 HTTP 200。
        // 若用 HTTP 状态码判断，这里会被误判成"成功"。
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":false,"message":"任务标题不能为空"}"""),
        )

        val r = repo(boundIdentity()).push(text = "")

        assertTrue("必须判为业务失败", r is ApiResult.BusinessFail)
        assertEquals("任务标题不能为空", (r as ApiResult.BusinessFail).message)
    }

    @Test
    fun `令牌失效应触发身份清理并返回未授权`() = runBlocking {
        val identity = boundIdentity()
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":false,"message":"移动端绑定已失效，请重新绑定"}"""),
        )

        val r = repo(identity).pull()

        assertTrue("应返回 Unauthorized", r is ApiResult.Unauthorized)
        assertEquals("必须通知身份层清理", 1, identity.rejectCount)
    }

    @Test
    fun `服务端返回非 JSON 时应归为可重试的传输失败`() = runBlocking {
        // 服务端故障时可能返回 HTML 错误页
        server.enqueue(
            MockResponse().setResponseCode(502).setBody("<html>502 Bad Gateway</html>"),
        )

        val r = repo(boundIdentity()).pull()

        assertTrue(r is ApiResult.TransportFail)
        assertEquals(
            ApiResult.TransportFail.Kind.BAD_RESPONSE,
            (r as ApiResult.TransportFail).kind,
        )
    }

    @Test
    fun `未绑定时不应发出请求`() = runBlocking {
        val unbound = FakeIdentity(Identity("", "", "k".repeat(24), "", ""))

        val r = repo(unbound).pull()

        assertTrue(r is ApiResult.Unauthorized)
        assertEquals("未绑定不该发请求", 0, server.requestCount)
    }

    @Test
    fun `服务端 500 但带 success=false 时应为业务失败而不是崩溃`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(500)
                .setBody("""{"success":false,"message":"服务器内部错误"}"""),
        )

        val r = repo(boundIdentity()).pull()
        assertTrue(r is ApiResult.BusinessFail)
    }

    @Test
    fun `board_list 能解析出真实墙名`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"boards":["默认任务墙","工作"]}"""),
        )

        val r = repo(boundIdentity()).boards()
        assertNotNull(r)
        assertEquals(
            listOf("默认任务墙", "工作"),
            (r as ApiResult.Ok).data.boards,
        )
    }

    @Test
    fun `push 响应可解析出 taskId`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"taskId":"rmt_a03a334713ebe3e8b9bdc04e","deliveredRealtime":true,"desktopOnline":true}""",
            ),
        )
        val r = repo(boundIdentity()).push(text = "x")
        val data: PushResponse = (r as ApiResult.Ok).data
        assertEquals("rmt_a03a334713ebe3e8b9bdc04e", data.taskId)
    }
}
