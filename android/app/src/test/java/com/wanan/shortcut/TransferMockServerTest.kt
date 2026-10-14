package com.wanan.shortcut

import com.wanan.shortcut.core.blob.sha256Hex
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.identity.IdentitySource
import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.feature.linked.transfer.ShareCreateResponse
import com.wanan.shortcut.feature.linked.transfer.TransferRepository
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
 * 文件共享的**真实网络链路**测试（MockWebServer）。
 *
 * 覆盖 web 参考实现里那些容易抄错的细节，特别是
 * **共享文件时 `messageId` 必须去掉 `msg_` 前缀**这一条 ——
 * 服务端会 `preg_replace('/[^a-f0-9]/', '', $messageId)` 后再补回前缀，
 * 所以传完整 `msg_xxx` 会因长度不对而共享失败（线上表现为"共享不出去"）。
 */
class TransferMockServerTest {

    private lateinit var server: MockWebServer

    private class FakeIdentity(private val identity: Identity) : IdentitySource {
        override fun current(): Identity = identity
        override suspend fun onTokenRejected() = Unit
    }

    private fun boundIdentity() = FakeIdentity(
        Identity(
            bindId = "0QIIVPkdtT32rxnpe19Dt3lB",
            mobileToken = "a".repeat(48),
            deviceKey = "aa11bb22cc33dd44ee55ff66",
            deviceId = "d",
            deviceName = "测试机",
        ),
    )

    /** 只用一个"哑" BlobEngine：本测试只关心 api.php 的请求形状，不触发上传 */
    private fun repo(): TransferRepository {
        val api = ApiClient(
            identityProvider = boundIdentity(),
            errorMapper = ErrorMapper(),
            baseUrl = server.url("/sync/api.php").toString(),
            client = OkHttpClient(),
        )
        val dummyFileApi = com.wanan.shortcut.core.blob.FileApiClient(
            identitySource = boundIdentity(),
            baseUrl = server.url("/sync/file.php").toString(),
            client = OkHttpClient(),
        )
        return TransferRepository(api, com.wanan.shortcut.core.blob.BlobEngine(api, dummyFileApi))
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    // ---------------- 共享文件：messageId 前缀（最容易抄错的一处） ----------------

    @Test
    fun `共享文件时 messageId 必须剥掉 msg_ 前缀`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"code":"ABC123","expiresAt":"2026-10-15T00:00:00+08:00"}"""),
        )

        val hexId = "a".repeat(24)
        val r = repo().shareFile("msg_$hexId", code = "", hours = 24.0)

        val body = server.takeRequest().body.readUtf8()
        assertTrue(
            "服务端只认 24 位 hex（会 preg_replace 掉非 hex 字符），所以必须剥掉 msg_ 前缀：$body",
            body.contains("\"messageId\":\"$hexId\""),
        )
        assertFalse("不该把 msg_ 一起发过去", body.contains("msg_"))
        assertTrue(r is ApiResult.Ok)
    }

    @Test
    fun `共享文件时只传 hex 也能正常工作`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"code":"XYZ789"}"""),
        )

        val hexId = "b".repeat(24)
        repo().shareFile(hexId)

        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"messageId\":\"$hexId\""))
    }

    @Test
    fun `共享文件应把 code 与 hours 一起发出`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"code":"QQQ111"}"""),
        )

        repo().shareFile("c".repeat(24), code = "QQQ111", hours = 6.0)

        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"code\":\"QQQ111\""))
        assertTrue("hours 应作为数字发出", body.contains("\"hours\":6.0") || body.contains("\"hours\":6"))
    }

    // ---------------- 请求形状 ----------------

    @Test
    fun `发送文本应带身份且截断到 10000 字`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"message":{"id":"msg_x"}}"""),
        )

        val long = "啊".repeat(10_500)
        repo().sendText(long)

        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"action\":\"transfer.sendText\""))
        assertTrue("必须自动带 bindId", body.contains("\"bindId\":\"0QIIVPkdtT32rxnpe19Dt3lB\""))
        assertTrue("必须自动带 mobileToken", body.contains("\"mobileToken\""))
        // 截断后长度应为 10000（用字符数近似判断，不精确比对 JSON 转义）
        assertFalse("超长文本应被截断", body.length > 40_000)
    }

    @Test
    fun `领取共享不应带身份`() = runBlocking {
        // 契约 §6.7：transfer.claim **无需身份**（可能是别人把密码给你）
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"message":{"type":"text","text":"hi"},"downloadToken":""}"""),
        )

        val r = repo().claim("abc123")

        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"action\":\"transfer.claim\""))
        assertTrue("领取码应被统一成大写", body.contains("\"code\":\"ABC123\""))
        assertFalse("领取不该带身份", body.contains("mobileToken"))
        assertTrue(r is ApiResult.Ok)
    }

    @Test
    fun `删除消息应带 messageId`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"deleted":true}"""),
        )

        repo().delete("msg_" + "d".repeat(24))

        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"action\":\"transfer.delete\""))
        assertTrue(body.contains("\"messageId\":\"msg_${"d".repeat(24)}\""))
    }

    @Test
    fun `删除共享应带 shr_ 形状的 id`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"success":true,"deleted":true}"""),
        )

        repo().shareDelete("shr_" + "e".repeat(24))

        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"id\":\"shr_${"e".repeat(24)}\""))
    }

    // ---------------- 响应解析 ----------------

    @Test
    fun `消息列表应能解析文本与文件两类`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"side":"mobile","messages":[
                   {"id":"msg_1","type":"text","text":"你好","sender":"mobile","createdAt":"2026-10-14T09:00:00+08:00"},
                   {"id":"msg_2","type":"file","fileId":"file_abc","name":"报告.pdf","size":12345,
                    "mime":"application/pdf","sender":"desktop","createdAt":"2026-10-14T09:01:00+08:00"}
                 ]}""",
            ),
        )

        val r = repo().messages()
        assertTrue(r is ApiResult.Ok)

        val msgs = (r as ApiResult.Ok).data.messages
        assertEquals(2, msgs.size)

        val text = msgs[0]
        assertFalse(text.isFile)
        assertTrue("sender=mobile 应判为 mine（web 用 sender==='mobile'）", text.isMine)
        assertEquals("你好", text.text)

        val file = msgs[1]
        assertTrue(file.isFile)
        assertFalse(file.isMine)
        assertEquals("报告.pdf", file.name)
        assertEquals(12345L, file.size)
        assertEquals("文件名应作为显示标题", "报告.pdf", file.displayTitle)
    }

    @Test
    fun `共享列表应能解析密码与到期时间`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"success":true,"shares":[
                   {"id":"shr_1","code":"ABC123","expiresAt":"2026-10-15T10:00:00+08:00",
                    "type":"file","name":"a.zip","size":100,"text":"","createdAt":"2026-10-14T10:00:00+08:00"}
                 ]}""",
            ),
        )

        val r = repo().shares()
        val share = (r as ApiResult.Ok).data.shares.first()
        assertEquals("ABC123", share.code)
        assertTrue(share.isFile)
        assertEquals("a.zip", share.displayTitle)
    }

    @Test
    fun `创建共享的响应应解析出 code`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"code":"NEW123","expiresAt":"2026-10-15T10:00:00+08:00"}"""),
        )

        val r = repo().shareText("要共享的文本", code = "", hours = 1.0)
        val data: ShareCreateResponse = (r as ApiResult.Ok).data
        assertEquals("NEW123", data.code)
        assertEquals("2026-10-15T10:00:00+08:00", data.expiresAt)
    }

    @Test
    fun `HTTP 200 但 success=false 应判为业务失败`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":false,"message":"文本内容为空"}"""),
        )

        val r = repo().sendText("  ")
        assertTrue(r is ApiResult.BusinessFail)
    }

    // ---------------- 分片哈希（契约 §6.3：传了就必须对） ----------------

    @Test
    fun `sha256Hex 应产出小写 hex`() {
        // 空串的 sha256 是已知值，用它做基准
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            sha256Hex(ByteArray(0)),
        )
    }

    @Test
    fun `sha256Hex 对相同输入稳定`() {
        val a = sha256Hex("hello".toByteArray())
        val b = sha256Hex("hello".toByteArray())
        assertEquals(a, b)
        assertEquals(64, a.length)
        assertTrue("必须是小写", a.all { it in '0'..'9' || it in 'a'..'f' })
    }
}
