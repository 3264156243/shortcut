package com.wanan.shortcut

import com.wanan.shortcut.core.update.UpdateClient
import com.wanan.shortcut.core.update.UpdateManifest
import com.wanan.shortcut.core.update.sha256OfFile
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
import java.io.File
import java.security.MessageDigest

/**
 * 应用内更新的回归测试。
 *
 * ## 为什么这两块最值得测
 *
 * 1. **版本比较**：Android 的更新判据是 `versionCode`（整数），
 *    若照抄桌面端的字符串比较，会出现 `"0.10.0" < "0.9.0"` 这种错误 → **永远提示不了更新**。
 * 2. **sha256 校验**：若校验写错（或忘了校验），用户会装到一个损坏/被篡改的包，
 *    表现为"更新装不上"或更糟。校验失败**必须删掉文件且不提示安装**。
 */
class UpdateManifestTest {

    private fun manifest(
        versionCode: Int = 2,
        versionName: String = "0.2.0",
        apkUrl: String = "https://example.com/app.apk",
        sha256: String = "a".repeat(64),
        size: Long = 1000,
        minSupported: Int = 0,
    ) = UpdateManifest(
        versionCode = versionCode,
        versionName = versionName,
        apkUrl = apkUrl,
        sha256 = sha256,
        size = size,
        minSupportedVersionCode = minSupported,
    )

    // ---------------- 版本比较（核心） ----------------

    @Test
    fun `versionCode 更大才算有更新`() {
        assertTrue(manifest(versionCode = 2).isNewerThan(1))
        assertTrue(manifest(versionCode = 10).isNewerThan(9))
    }

    @Test
    fun `versionCode 相等不算更新`() {
        assertFalse(manifest(versionCode = 2).isNewerThan(2))
    }

    @Test
    fun `versionCode 更小不算更新（服务端回滚时不该提示降级）`() {
        assertFalse(manifest(versionCode = 1).isNewerThan(2))
    }

    @Test
    fun `整数比较不会出现字符串比较的死角`() {
        // 这正是**不能照抄桌面端**的原因：
        // 字符串比较下 "0.10.0" < "0.9.0"（字典序），会永远提示不了更新。
        // 用 versionCode 就天然没这个问题：
        assertTrue(
            "0.10.0 (code=10) 必须被识别为比 0.9.0 (code=9) 新",
            manifest(versionCode = 10, versionName = "0.10.0").isNewerThan(9),
        )
    }

    // ---------------- 必须重装的情形 ----------------

    @Test
    fun `低于服务端要求的下限时要求重装`() {
        val m = manifest(versionCode = 5, minSupported = 3)
        assertTrue("versionCode 2 < 下限 3", m.requiresFreshInstall(2))
        assertFalse("versionCode 3 == 下限 3，不用重装", m.requiresFreshInstall(3))
        assertFalse("versionCode 4 > 下限", m.requiresFreshInstall(4))
    }

    @Test
    fun `未设置下限时永不要求重装`() {
        val m = manifest(minSupported = 0)
        assertFalse(m.requiresFreshInstall(1))
    }

    // ---------------- 清单可用性 ----------------

    @Test
    fun `缺关键字段的清单不可用`() {
        // 缺 apkUrl / sha256 / versionCode 都不能拿去下载 ——
        // 否则会弹一个"点下载就失败"的更新框
        assertFalse(manifest(versionCode = 0).isUsable)
        assertFalse(manifest(apkUrl = "").isUsable)
        assertFalse(manifest(sha256 = "").isUsable)
    }

    @Test
    fun `完整清单可用`() {
        assertTrue(manifest().isUsable)
    }
}

/**
 * 下载与校验的测试（MockWebServer）。
 */
class UpdateDownloadTest {

    private lateinit var server: MockWebServer
    private lateinit var tempDir: File

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        tempDir = File(System.getProperty("java.io.tmpdir"), "sc-update-test-${System.nanoTime()}")
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
        manifestUrl = server.url("/latest.json").toString(),
        client = OkHttpClient(),
    )

    // ---------------- 清单拉取 ----------------

    @Test
    fun `应能解析服务端清单`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"versionCode":2,"versionName":"0.2.0",
                   "apkUrl":"https://x/a.apk","sha256":"${"a".repeat(64)}",
                   "size":123,"releaseNotes":"## 0.2.0","releaseDate":"2026-10-15T00:00:00+08:00",
                   "minSupportedVersionCode":1}""",
            ),
        )

        val r = client().fetchManifest()
        assertTrue("应成功：$r", r is com.wanan.shortcut.core.result.ApiResult.Ok)

        val m = (r as com.wanan.shortcut.core.result.ApiResult.Ok).data
        assertEquals(2, m.versionCode)
        assertEquals("0.2.0", m.versionName)
        assertEquals("## 0.2.0", m.releaseNotes)
        assertEquals(1, m.minSupportedVersionCode)
    }

    @Test
    fun `清单请求应带不缓存头`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"versionCode":1}"""))

        client().fetchManifest()

        val recorded = server.takeRequest()
        assertTrue(
            "必须不缓存：否则刚发布的版本会被 CDN/本地缓存挡住，用户永远看不到更新",
            recorded.getHeader("Cache-Control")?.contains("no-cache") == true,
        )
    }

    @Test
    fun `清单不完整时应判为业务失败而不是当成有更新`() = runBlocking {
        // 缺 sha256 的清单直接拿去下载，用户会下载一个无法校验的包
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"versionCode":2,"versionName":"0.2.0","apkUrl":"https://x/a.apk"}"""),
        )

        val r = client().fetchManifest()
        assertTrue("应判为失败：$r", r is com.wanan.shortcut.core.result.ApiResult.BusinessFail)
    }

    @Test
    fun `清单返回 404 时应判为失败`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404).setBody("not found"))

        val r = client().fetchManifest()
        assertTrue(r is com.wanan.shortcut.core.result.ApiResult.BusinessFail)
    }

    // ---------------- 下载与 sha256 校验（核心） ----------------

    @Test
    fun `sha256 正确时应下载成功`() = runBlocking {
        val content = "这是一段假的 APK 内容".toByteArray(Charsets.UTF_8)
        val manifest = UpdateManifest(
            versionCode = 2, versionName = "0.2.0",
            apkUrl = server.url("/app.apk").toString(),
            sha256 = sha256Of(content),
            size = content.size.toLong(),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        val target = File(tempDir, "app.apk")
        val r = UpdateClient(manifestUrl = server.url("/x").toString(), client = OkHttpClient())
            .download(manifest, target)

        assertTrue("应成功：$r", r is com.wanan.shortcut.core.result.ApiResult.Ok)
        assertTrue("文件应存在", target.exists())
        assertEquals(content.size.toLong(), target.length())
    }

    @Test
    fun `sha256 不匹配时必须失败且删掉文件`() = runBlocking {
        // 这是最关键的一条：校验失败绝不能留下文件、更不能提示安装
        val content = "被篡改的内容".toByteArray(Charsets.UTF_8)
        val manifest = UpdateManifest(
            versionCode = 2, versionName = "0.2.0",
            apkUrl = server.url("/app.apk").toString(),
            sha256 = "0".repeat(64),   // 故意错的哈希
            size = content.size.toLong(),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        val target = File(tempDir, "app.apk")
        val r = UpdateClient(manifestUrl = server.url("/x").toString(), client = OkHttpClient())
            .download(manifest, target)

        assertTrue("应判为失败：$r", r is com.wanan.shortcut.core.result.ApiResult.BusinessFail)
        assertFalse("★ 校验失败必须删掉文件，绝不能留着让用户去装", target.exists())
    }

    @Test
    fun `大小不符时必须失败且删掉文件`() = runBlocking {
        val content = "内容".toByteArray(Charsets.UTF_8)
        val manifest = UpdateManifest(
            versionCode = 2, versionName = "0.2.0",
            apkUrl = server.url("/app.apk").toString(),
            sha256 = sha256Of(content),
            size = 999999,   // 故意与真实大小不符
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        val target = File(tempDir, "app.apk")
        val r = UpdateClient(manifestUrl = server.url("/x").toString(), client = OkHttpClient())
            .download(manifest, target)

        assertTrue(r is com.wanan.shortcut.core.result.ApiResult.BusinessFail)
        assertFalse("大小不符也要删掉", target.exists())
    }

    @Test
    fun `哈希比较应忽略大小写`() = runBlocking {
        val content = "abc".toByteArray(Charsets.UTF_8)
        val upper = sha256Of(content).uppercase()
        val manifest = UpdateManifest(
            versionCode = 2, versionName = "0.2.0",
            apkUrl = server.url("/app.apk").toString(),
            sha256 = upper,
            size = content.size.toLong(),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        val target = File(tempDir, "app.apk")
        val r = UpdateClient(manifestUrl = server.url("/x").toString(), client = OkHttpClient())
            .download(manifest, target)

        assertTrue("大写哈希也应通过：$r", r is com.wanan.shortcut.core.result.ApiResult.Ok)
    }

    @Test
    fun `下载 404 时应失败且不留下文件`() = runBlocking {
        val manifest = UpdateManifest(
            versionCode = 2, versionName = "0.2.0",
            apkUrl = server.url("/app.apk").toString(),
            sha256 = "a".repeat(64),
            size = 100,
        )
        server.enqueue(MockResponse().setResponseCode(404))

        val target = File(tempDir, "app.apk")
        val r = UpdateClient(manifestUrl = server.url("/x").toString(), client = OkHttpClient())
            .download(manifest, target)

        assertTrue(r is com.wanan.shortcut.core.result.ApiResult.BusinessFail)
        assertFalse(target.exists())
    }

    @Test
    fun `下载进度会被回调`() = runBlocking {
        val content = ByteArray(300 * 1024) { it.toByte() }   // 300 KB，会分多个 64KB 块
        val manifest = UpdateManifest(
            versionCode = 2, versionName = "0.2.0",
            apkUrl = server.url("/app.apk").toString(),
            sha256 = sha256Of(content),
            size = content.size.toLong(),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        val progress = mutableListOf<Long>()
        val target = File(tempDir, "app.apk")
        UpdateClient(manifestUrl = server.url("/x").toString(), client = OkHttpClient())
            .download(manifest, target) { downloaded, _ -> progress.add(downloaded) }

        assertTrue("应有多次进度回调", progress.size > 1)
        assertEquals("最后一次应等于总大小", content.size.toLong(), progress.last())
        // 进度应单调递增
        progress.zipWithNext().forEach { (a, b) ->
            assertTrue("进度不应回退：$a -> $b", b >= a)
        }
    }

    // ---------------- 文件哈希工具 ----------------

    @Test
    fun `sha256OfFile 应与内存计算一致`() {
        val content = "文件内容".toByteArray(Charsets.UTF_8)
        val f = File(tempDir, "x.bin")
        f.writeBytes(content)

        assertEquals(sha256Of(content), sha256OfFile(f))
    }

    @Test
    fun `sha256OfFile 对不存在的文件返回 null`() {
        assertEquals(null, sha256OfFile(File(tempDir, "not-exists.bin")))
    }

    @Test
    fun `空文件哈希应是已知值`() {
        val f = File(tempDir, "empty.bin")
        f.writeBytes(ByteArray(0))
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            sha256OfFile(f),
        )
    }

    @Test
    fun `清单解析出的下载地址应可用于下载`() = runBlocking {
        val content = "apk".toByteArray(Charsets.UTF_8)
        val apkUrl = server.url("/app.apk").toString()

        // 先返回清单，再返回 APK —— 模拟真实流程
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"versionCode":9,"versionName":"1.0.0","apkUrl":"$apkUrl",
                   "sha256":"${sha256Of(content)}","size":${content.size}}""",
            ),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(content)))

        val c = UpdateClient(manifestUrl = server.url("/latest.json").toString(), client = OkHttpClient())
        val manifestResult = c.fetchManifest()
        assertTrue(manifestResult is com.wanan.shortcut.core.result.ApiResult.Ok)
        val m = (manifestResult as com.wanan.shortcut.core.result.ApiResult.Ok).data

        val target = File(tempDir, "app.apk")
        val r = c.download(m, target)
        assertTrue("整条链路应通：$r", r is com.wanan.shortcut.core.result.ApiResult.Ok)
        assertNotNull(sha256OfFile(target))
    }
}
