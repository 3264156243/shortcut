package com.wanan.shortcut

import com.wanan.shortcut.core.update.UpdateClient
import com.wanan.shortcut.core.update.UpdateManifest
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/**
 * 下载进度的**限流**测试。
 *
 * ## 针对的真实问题
 *
 * 用户反馈"更新下载速度太慢，几 kb/s，手机网络正常"。
 * 服务端不慢（实测 Cloudflare 命中缓存、本机 1.3 MB/s），
 * 慢在**客户端自己**：早先每读 64 KB 就回调一次，
 * 35 MB 约 565 次回调，每次都推 StateFlow → 触发整页 Compose 重组 →
 * 主线程被占满 → 反过来拖住下载循环。
 *
 * ## 测试要证明什么
 *
 * 1. 回调次数显著少于"分包数"（确实限流了）；
 * 2. 最后一定会收到 downloaded == total（否则进度条停在 99% 卡住）；
 * 3. 下载内容与 sha256 校验仍然正确（限流不能影响正确性）。
 */
class UpdateDownloadThrottleTest {

    private lateinit var server: MockWebServer
    private lateinit var tempDir: File

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        tempDir = File(System.getProperty("java.io.tmpdir"), "sc-throttle-${System.nanoTime()}")
        tempDir.mkdirs()
    }

    @After
    fun tearDown() {
        server.shutdown()
        tempDir.deleteRecursively()
    }

    private fun sha256Of(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun client() = UpdateClient(
        manifestUrl = server.url("/x").toString(),
        client = OkHttpClient(),
    )

    private fun manifestFor(content: ByteArray) = UpdateManifest(
        versionCode = 2,
        versionName = "0.2.1",
        apkUrl = server.url("/app.apk").toString(),
        sha256 = sha256Of(content),
        size = content.size.toLong(),
    )

    @Test
    fun `回调次数应远少于分包数（限流生效）`() = runBlocking {
        // 4 MB：按 256KB 缓冲算是 16 次读；若每读都回调，至少 16 次。
        // 限流后（150ms）在一台快机器上应该只有个位数。
        val content = ByteArray(4 * 1024 * 1024) { it.toByte() }
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        var callbacks = 0
        val target = File(tempDir, "app.apk")
        val r = client().download(
            manifest = manifestFor(content),
            targetFile = target,
            progressIntervalMs = 150L,
        ) { _, _ -> callbacks++ }

        assertTrue("下载应成功：$r", r is com.wanan.shortcut.core.result.ApiResult.Ok)
        val chunks = (content.size + 256 * 1024 - 1) / (256 * 1024)
        // 关键断言：回调次数不该接近分包数
        assertTrue(
            "回调次数 $callbacks 应远少于分包数 $chunks（限流没生效会拖慢下载）",
            callbacks < chunks,
        )
        // 但至少要有一次（否则进度条不动）
        assertTrue("至少应回调一次，实际 $callbacks", callbacks >= 1)
    }

    @Test
    fun `最后一次回调必须报满总大小`() = runBlocking {
        // 限流容易漏掉最后一次 → 进度条永远停在 99%，看起来像卡死
        val content = ByteArray(2 * 1024 * 1024) { it.toByte() }
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        var lastDownloaded = -1L
        var lastTotal = -1L
        val target = File(tempDir, "app.apk")
        client().download(manifestFor(content), target) { d, t ->
            lastDownloaded = d
            lastTotal = t
        }

        assertEquals("最后一次回调的已下载字节应等于总大小", content.size.toLong(), lastDownloaded)
        assertEquals("总大小应等于文件大小", content.size.toLong(), lastTotal)
    }

    @Test
    fun `限流不应影响内容正确性与 sha256 校验`() = runBlocking {
        val content = "这是一段用来验证限流不影响正确性的内容".toByteArray(Charsets.UTF_8)
            .let { it + ByteArray(512 * 1024) { i -> (i % 251).toByte() } }
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        val target = File(tempDir, "app.apk")
        val r = client().download(manifestFor(content), target, progressIntervalMs = 50L)

        assertTrue("应成功：$r", r is com.wanan.shortcut.core.result.ApiResult.Ok)
        assertTrue("文件应存在", target.exists())
        assertEquals("内容长度应一致", content.size.toLong(), target.length())
        // 内容逐字节一致（sha256 校验能在 download 内部已保证，这里再确认一次读回内容）
        assertTrue("内容应完全一致", content.contentEquals(target.readBytes()))
    }

    @Test
    fun `进度应单调递增`() = runBlocking {
        val content = ByteArray(3 * 1024 * 1024) { it.toByte() }
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        val progress = mutableListOf<Long>()
        val target = File(tempDir, "app.apk")
        client().download(manifestFor(content), target) { d, _ -> progress.add(d) }

        progress.zipWithNext().forEach { (a, b) ->
            assertTrue("进度不应回退：$a -> $b", b >= a)
        }
    }

    @Test
    fun `间隔设为 0 时退化为每次回调，用于对比验证`() = runBlocking {
        // 这条用来证明"限流确实是那个变量在起作用"，
        // 而不是别的原因让回调变少
        val content = ByteArray(2 * 1024 * 1024) { it.toByte() }
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        var unlimited = 0
        val t1 = File(tempDir, "a.apk")
        client().download(manifestFor(content), t1, progressIntervalMs = 0) { _, _ -> unlimited++ }

        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))
        var throttled = 0
        val t2 = File(tempDir, "b.apk")
        client().download(manifestFor(content), t2, progressIntervalMs = 5000) { _, _ -> throttled++ }

        assertTrue(
            "不限流时回调次数($unlimited)应远多于强限流时($throttled)",
            unlimited > throttled,
        )
    }
}
