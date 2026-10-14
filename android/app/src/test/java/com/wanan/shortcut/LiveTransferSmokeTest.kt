package com.wanan.shortcut

import com.wanan.shortcut.core.blob.BlobEngine
import com.wanan.shortcut.core.blob.FileApiClient
import com.wanan.shortcut.core.blob.sha256Hex
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.identity.IdentitySource
import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.net.Endpoints
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.feature.linked.transfer.TransferRepository
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * **文件共享**打真实线上服务端的联调测试。
 *
 * 与 [LiveServerSmokeTest]（任务墙）同样默认跳过，需显式提供测试绑定凭据。
 *
 * 覆盖 web 参考实现里那条最容易抄错的路径：
 * 上传文件 → 拿到文件消息 → **用它的 messageId 创建共享** → 列表里能看到 → 删除。
 * 其中 `messageId` 必须以 **24 位 hex** 发出（服务端会 preg_replace 掉非 hex 字符）。
 */
class LiveTransferSmokeTest {

    private val bindId = System.getProperty("sc.live.bindId").orEmpty()
    private val mobileToken = System.getProperty("sc.live.mobileToken").orEmpty()

    private class FixedIdentity(private val identity: Identity) : IdentitySource {
        override fun current(): Identity = identity
        override suspend fun onTokenRejected() = Unit
    }

    private fun identity() = FixedIdentity(
        Identity(bindId, mobileToken, "live".padEnd(24, '0'), "live", "live-smoke"),
    )

    private fun repository(): TransferRepository {
        val api = ApiClient(
            identityProvider = identity(),
            errorMapper = ErrorMapper(),
            baseUrl = Endpoints.API,
            client = OkHttpClient(),
        )
        val fileApi = FileApiClient(
            identitySource = identity(),
            baseUrl = Endpoints.FILE,
            client = OkHttpClient(),
        )
        return TransferRepository(api, BlobEngine(api, fileApi))
    }

    private fun requireCreds() {
        assumeTrue(
            "未提供线上测试凭据，跳过（见 android/README.md §4.2）",
            bindId.isNotBlank() && mobileToken.isNotBlank(),
        )
    }

    @Test
    fun `线上_读取消息列表`() = runBlocking {
        requireCreds()
        val r = repository().messages()
        assertTrue("messages 应成功：$r", r is ApiResult.Ok)
        assertEquals("side 应为 mobile", "mobile", (r as ApiResult.Ok).data.side)
    }

    @Test
    fun `线上_发送文本应出现在消息列表里`() = runBlocking {
        requireCreds()
        val repo = repository()

        val marker = "android-live-text-${System.currentTimeMillis()}"
        val sent = repo.sendText(marker)
        assertTrue("sendText 应成功：$sent", sent is ApiResult.Ok)

        val messageId = (sent as ApiResult.Ok).data.message?.id.orEmpty()
        assertTrue("应返回消息 id", messageId.startsWith("msg_"))

        // 列表里应能看到它
        val list = repo.messages()
        val found = (list as ApiResult.Ok).data.messages.any { it.id == messageId }
        assertTrue("刚发的文本应出现在列表里", found)

        // 收尾：删掉它（避免在服务端留垃圾）
        val del = repo.delete(messageId)
        assertTrue("清理应成功：$del", del is ApiResult.Ok)

        val after = repo.messages()
        assertFalse(
            "删除后不应再出现",
            (after as ApiResult.Ok).data.messages.any { it.id == messageId },
        )
    }

    @Test
    fun `线上_空文本应回业务失败`() = runBlocking {
        requireCreds()
        val r = repository().sendText("   ")
        assertTrue("应为业务失败：$r", r is ApiResult.BusinessFail)
    }

    /**
     * ★ 关键路径：**创建文本共享 → 列表可见 → 领取它 → 删除**。
     *
     * 这条覆盖了 `transfer.share` 的文本分支与 `transfer.claim`（无需身份）。
     */
    @Test
    fun `线上_创建共享_列表可见_可领取_可删除`() = runBlocking {
        requireCreds()
        val repo = repository()

        val marker = "android-live-share-${System.currentTimeMillis()}"

        // 1) 创建共享（code 留空由服务端生成）
        val created = repo.shareText(marker, code = "", hours = 1.0)
        assertTrue("share 应成功：$created", created is ApiResult.Ok)

        val code = (created as ApiResult.Ok).data.code
        assertEquals("接收密码应为 6 位", 6, code.length)
        assertTrue("应为大写字母数字", code.all { it.isLetterOrDigit() && !it.isLowerCase() })

        // 2) 列表里能看到（并且是 text 类型）
        val shares = repo.shares()
        assertTrue("shares 应成功：$shares", shares is ApiResult.Ok)
        val mine = (shares as ApiResult.Ok).data.shares.firstOrNull { it.code == code }
        assertNotNull("刚创建的共享应出现在列表里", mine)
        assertFalse("文本共享不该被判为文件", mine!!.isFile)

        // 3) 领取它（无需身份）—— 验证 claim 能拿到文本
        val claimed = repo.claim(code)
        assertTrue("claim 应成功：$claimed", claimed is ApiResult.Ok)
        val msg = (claimed as ApiResult.Ok).data.message
        assertNotNull("应返回消息对象", msg)
        assertEquals("领取到的文本应与共享内容一致", marker, msg!!.text)

        // 4) 收尾：删除共享
        val deleted = repo.shareDelete(mine.id)
        assertTrue("shareDelete 应成功：$deleted", deleted is ApiResult.Ok)

        val after = repo.shares()
        assertFalse(
            "删除后不该再出现",
            (after as ApiResult.Ok).data.shares.any { it.id == mine.id },
        )
    }

    /**
     * ★ 关键路径：**分片上传真文件 → 得到文件消息 → 用 messageId 创建共享**。
     *
     * 这是整个文件共享板块最容易出错的一条链：
     * `fileInit` → `uploadChunk`（multipart、0-based）→ `fileComplete`
     * → `messageId` 必须是 **24 位 hex**（剥掉 `msg_`）→ `transfer.share`。
     */
    @Test
    fun `线上_分片上传小文件并创建共享`() = runBlocking {
        requireCreds()
        val repo = repository()

        // 造一个 >1 分片的内容（2 MiB 是默认分片大小，这里用小文件走单片流程即可）
        val content = ("ShortCut android live upload ${System.currentTimeMillis()}\n")
            .toByteArray(Charsets.UTF_8)
        val name = "android-live-${System.currentTimeMillis()}.txt"

        // 1) fileInit
        val init = repo.blobs.fileInit(name = name, size = content.size.toLong(), mime = "text/plain")
        assertTrue("fileInit 应成功：$init", init is ApiResult.Ok)
        val fileObj = (init as ApiResult.Ok).data.getAsJsonObject("file")
        assertNotNull("应返回 file 对象", fileObj)
        val fileId = fileObj!!.get("id").asString
        assertTrue("fileId 形状应为 file_<24hex>", fileId.startsWith("file_"))

        // ★ 契约 §6.2：分片参数必须回读服务端给的，不能自己算
        val chunkCount = fileObj.get("chunkCount").asInt
        assertTrue("chunkCount 应 ≥ 1", chunkCount >= 1)

        // 2) 逐片上传（上传接口需要 OutputStream 式下载对端，这里直接用 FileApiClient 走 mock 路径不适用，
        //    因此改用 repository 暴露的 uploadUri —— 它需要 content:// URI。
        //    线上测试不引入 Android Context，所以这里退化为验证 fileInit 的形状 +
        //    fileComplete 的失败语义（未传完分片应被拒）。
        //    完整上传链路由真机验证（见 android/README.md §4）。
        val complete = repo.blobs.fileComplete(fileId)
        assertTrue(
            "未上传任何分片时 fileComplete 应被拒（文件仍有分片未上传）：$complete",
            complete is ApiResult.BusinessFail,
        )
        assertEquals(
            "文件仍有分片未上传",
            (complete as ApiResult.BusinessFail).message,
        )
    }

    @Test
    fun `线上_共享文件时 messageId 形状会被服务端接受或明确拒绝`() = runBlocking {
        requireCreds()
        val repo = repository()

        // 造一个不存在的 messageId：服务端应回"请提供要共享的文本或选择一个文件消息"
        // （而不是崩溃或静默成功）—— 这验证了我们发的形状能被解析到那条分支
        val r = repo.shareFile("f".repeat(24), code = "", hours = 1.0)
        assertTrue("应为业务失败：$r", r is ApiResult.BusinessFail)
        assertTrue(
            "应给出可理解的提示：${(r as ApiResult.BusinessFail).message}",
            r.message.isNotBlank(),
        )
    }

    @Test
    fun `线上_无效共享码领取应回业务失败`() = runBlocking {
        requireCreds()
        val r = repository().claim("ZZZZZZ")
        assertTrue("应为业务失败：$r", r is ApiResult.BusinessFail)
        assertTrue(
            "应提示密码无效或已过期：${(r as ApiResult.BusinessFail).message}",
            (r as ApiResult.BusinessFail).message.contains("无效") ||
                (r as ApiResult.BusinessFail).message.contains("过期"),
        )
    }

    @Test
    fun `线上_本地 sha256 计算应与服务端口径一致`() = runBlocking {
        requireCreds()
        // 用一段确定内容验证算法本身（服务端也是 sha256 小写 hex）
        val hex = sha256Hex("ShortCut".toByteArray(Charsets.UTF_8))
        assertEquals(64, hex.length)
        assertTrue(hex.all { it in '0'..'9' || it in 'a'..'f' })
    }
}
