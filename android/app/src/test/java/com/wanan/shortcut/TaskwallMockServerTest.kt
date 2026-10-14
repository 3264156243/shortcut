package com.wanan.shortcut

import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.identity.IdentitySource
import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.feature.linked.taskwall.TaskwallRepository
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 任务墙**真实网络链路**测试（用 MockWebServer）。
 *
 * ## 为什么必须有这一层
 *
 * 之前只有协议层纯函数与注册表逻辑测试，它们**都不执行 [ApiClient] 里
 * 真正发请求的那段代码** —— 于是出现了"编译通过、单测全绿，
 * 但功能从没在 App 里跑通过"的尴尬局面。
 *
 * 本类用真实 `OkHttp` 打到本地 MockWebServer，覆盖：
 * 请求体形状（身份注入、严格布尔）→ HTTP 往返 → 响应解析 → 状态映射。
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

    // ---------------- ★ Android 端不得消费队列（曾把 bug 当通过标准） ----------------

    @Test
    fun `手机端 push 之后不得再发 ack`() = runBlocking {
        // 这是**破坏性 bug 的回归测试**（2026-10-14）：
        // 我最初把手机端做成"勾选完成 → ack"，而 ack 会删掉队列条目，
        // 导致桌面端永远收不到该任务。
        //
        // 本用例模拟"用户提交一条任务"的完整流程，
        // 断言：**除了 push（与只读的 board.list/pull）之外，绝不能出现 ack**。
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"taskId":"rmt_a03a334713ebe3e8b9bdc04e","deliveredRealtime":false,"desktopOnline":false}"""),
        )
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"boards":[]}"""),
        )
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"tasks":[],"count":0}"""),
        )

        val repo = repo(boundIdentity())
        repo.push(text = "一条任务")
        repo.boards()
        repo.pull()

        // 逐条检查实际发出的请求
        val actions = (1..server.requestCount).map { i ->
            val recorded = if (i == server.requestCount) server.takeRequest() else server.takeRequest()
            recorded.body.readUtf8()
        }

        assertTrue("应至少发出过 push", actions.any { it.contains("\"action\":\"push\"") })
        assertFalse(
            "手机端绝不能发 ack —— 它会把任务从队列删掉，桌面端就永远收不到了",
            actions.any { it.contains("\"action\":\"ack\"") },
        )
    }

    @Test
    fun `ack 方法存在但界面上不应有调用入口`() {
        // 保留 ack 是为了诊断与线上测试收尾；这里用"源码扫描"锁住
        // "界面层不得调用它"这条约束，避免以后有人又把它接到勾选框上。
        val uiFiles = listOf(
            "app/src/main/java/com/wanan/shortcut/feature/linked/taskwall/TaskwallScreen.kt",
            "app/src/main/java/com/wanan/shortcut/feature/linked/taskwall/TaskwallViewModel.kt",
        )
        val offenders = uiFiles.filter { path ->
            val f = java.io.File(path)
            f.exists() && f.readText().let { text ->
                // 允许注释里提到 ack（我们在注释里解释了为什么不能用），
                // 但不允许出现真正的调用 `repository.ack(` 或 `viewModel.ack(`
                Regex("""\b(repository|viewModel)\.ack\s*\(""").containsMatchIn(text)
            }
        }
        assertTrue(
            "界面层不得调用 ack（会把任务从队列删掉）。违规文件：$offenders",
            offenders.isEmpty(),
        )
    }

    // ---------------- 请求体形状 ----------------

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

        assertTrue("必须带 board=taskwall，否则服务端回「暂不支持的板块」", body.contains("\"board\":\"taskwall\""))
        assertTrue(body.contains("\"bindId\":\"0QIIVPkdtT32rxnpe19Dt3lB\""))
        assertTrue(body.contains("\"mobileToken\":\"${"a".repeat(48)}\""))
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

        assertTrue("longText 必须是 JSON 原生 true：$body", body.contains("\"longText\":true"))
        assertFalse("绝不能发成字符串 \"true\"", body.contains("\"longText\":\"true\""))
        assertTrue("reminderEnabled 必须是 JSON 原生 true", body.contains("\"reminderEnabled\":true"))
        assertFalse(body.contains("\"reminderEnabled\":\"true\""))
        assertTrue("中文必须正确编码", body.contains("测试任务"))
    }

    @Test
    fun `未开长文本时不应带 details 字段`() = runBlocking {
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
    fun `board_list 请求应带 board=taskwall`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"boards":[]}"""),
        )

        repo(boundIdentity()).boards()

        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"board\":\"taskwall\""))
        assertTrue(body.contains("\"action\":\"board.list\""))
    }

    // ---------------- 响应解析 ----------------

    @Test
    fun `pull 能解析出完整的任务字段`() = runBlocking {
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
    fun `board_list 能解析出真实墙名`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"boards":["默认任务墙","工作"]}"""),
        )

        val r = repo(boundIdentity()).boards()
        assertEquals(
            listOf("默认任务墙", "工作"),
            (r as ApiResult.Ok).data.boards,
        )
    }

    @Test
    fun `board_list 空列表应能被识别为需要提示的状态`() = runBlocking {
        // 桌面端还没上报过墙名时会返回空列表（《任务墙板块待办》T1 记录的问题）。
        // 客户端必须能区分"空"与"失败"，才能给出不同提示。
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"boards":[]}"""),
        )

        val r = repo(boundIdentity()).boards()
        assertTrue(r is ApiResult.Ok)
        assertTrue("应解析为空列表（而非报错）", (r as ApiResult.Ok).data.boards.isEmpty())
    }

    @Test
    fun `board_list 的 boardsUpdatedAt 应能被解析`() = runBlocking {
        // ⚠️ 线上服务端实际返回该字段，但仓库里没有任何分支定义它
        // （2026-10-14 实测：{"success":true,"boards":[],"boardsUpdatedAt":""}）。
        // 说明线上部署比仓库新。这里锁住"我们能读到它"，
        // 因为客户端要用它区分"从没上报过"与"上报过但为空"。
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"boards":[],"boardsUpdatedAt":"2026-10-14T09:00:00+08:00"}""",
            ),
        )

        val r = repo(boundIdentity()).boards()
        assertTrue(r is ApiResult.Ok)
        assertEquals(
            "2026-10-14T09:00:00+08:00",
            (r as ApiResult.Ok).data.boardsUpdatedAt,
        )
    }

    @Test
    fun `board_list 未提供 boardsUpdatedAt 时应回落为空串`() = runBlocking {
        // 老版服务端不返回该字段时不能崩，也不能报错
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"boards":["默认任务墙"]}"""),
        )

        val r = repo(boundIdentity()).boards()
        assertTrue(r is ApiResult.Ok)
        val data = (r as ApiResult.Ok).data
        assertEquals(listOf("默认任务墙"), data.boards)
        assertEquals("", data.boardsUpdatedAt)
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
        assertFalse((r as ApiResult.Ok).data.deliveredRealtime)
    }

    // ---------------- 失败语义 ----------------

    @Test
    fun `HTTP 200 但 success=false 必须判为业务失败`() = runBlocking {
        // 契约 §1.2 / §10.2 陷阱 #3：api.php 业务失败也是 HTTP 200。
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
    fun `ack 空数组应在本地拦截不发请求`() = runBlocking {
        // 保留该方法用于诊断；空数组本地拦掉，返回业务失败语义而不是抛异常。
        val r = repo(boundIdentity()).ack(emptyList())

        assertTrue(r is ApiResult.BusinessFail)
        assertEquals("缺少待确认任务", (r as ApiResult.BusinessFail).message)
        assertEquals("不该发出请求", 0, server.requestCount)
    }
}
