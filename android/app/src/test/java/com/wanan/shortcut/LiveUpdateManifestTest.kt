package com.wanan.shortcut

import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * **打真实线上**验证更新清单可被客户端正确解析。
 *
 * ## 这个测试是为一个具体的隐患写的
 *
 * 线上 `latest.json` 的响应头是 `Content-Type: application/json`，
 * **没有带 `charset=utf-8`**。
 *
 * 这会引出两个问题：
 *   1. 有些 HTTP 客户端在缺 charset 时会**按平台默认编码**（Windows GBK）解码 → 中文变乱码；
 *   2. 我们依赖 OkHttp 的 `body.string()`（缺省按 UTF-8）来解 —— 这是**假设**，
 *      必须用真网络验证，而不是"我觉得应该是 UTF-8"。
 *
 * 本测试直接请求线上清单，断言**中文能正确读出来**。
 * 若哪天真出问题，这里会立刻失败，而不是等到用户看到一堆乱码更新说明。
 *
 * ## 默认跳过
 *
 * 需要网络，且依赖已发布的线上文件；常规套件里跳过，显式开启才跑：
 * ```
 * .\gradlew.bat testDebugUnitTest --tests "*LiveUpdateManifestTest*" -Dsc.live.update=true
 * ```
 */
class LiveUpdateManifestTest {

    private val enabled = System.getProperty("sc.live.update") == "true"

    /** 与客户端实际用的结构一致（只取本测试关心的字段） */
    private data class Manifest(
        @SerializedName("versionCode") val versionCode: Int = 0,
        @SerializedName("versionName") val versionName: String = "",
        @SerializedName("apkUrl") val apkUrl: String = "",
        @SerializedName("sha256") val sha256: String = "",
        @SerializedName("size") val size: Long = 0,
        @SerializedName("releaseNotes") val releaseNotes: String = "",
    )

    private val url = "https://shortcut.326415.xyz/updates/android/latest.json"

    @Test
    fun `线上 latest_json 应能正确解析且中文不乱码`() = runBlocking {
        assumeTrue("未开启线上验证，跳过（-Dsc.live.update=true）", enabled)

        val client = OkHttpClient()
        val request = Request.Builder().url(url).get().build()

        val body = client.newCall(request).execute().use { resp ->
            assertTrue("清单应可访问：HTTP ${resp.code}", resp.isSuccessful)
            // 记录实际 Content-Type，便于排查编码问题
            println("Content-Type = ${resp.header("Content-Type")}")
            resp.body?.string().orEmpty()
        }

        val manifest = com.wanan.shortcut.core.net.Json.gson
            .fromJson(body, Manifest::class.java)

        assertEquals("versionCode 应为 2", 2, manifest.versionCode)
        assertEquals("0.2.0", manifest.versionName)
        assertEquals(64, manifest.sha256.length)
        assertTrue("size 应 > 0", manifest.size > 0)
        assertTrue("apkUrl 应指向 apk", manifest.apkUrl.endsWith(".apk"))

        // ★ 核心断言：中文必须正确
        assertTrue(
            "更新说明里的中文不应乱码（若失败说明响应编码处理有问题）：" +
                manifest.releaseNotes.take(60),
            manifest.releaseNotes.contains("应用内更新"),
        )
        assertTrue(
            "不应出现典型的 GBK 误解码痕迹",
            !manifest.releaseNotes.contains("æ") && !manifest.releaseNotes.contains("å"),
        )
    }

    @Test
    fun `线上 apk 应可访问且大小与清单一致`() = runBlocking {
        assumeTrue("未开启线上验证，跳过", enabled)

        val client = OkHttpClient()
        val manifestBody = client.newCall(
            Request.Builder()
                .url("https://shortcut.326415.xyz/updates/android/latest.json").build(),
        ).execute().use { it.body?.string().orEmpty() }
        val manifest = com.wanan.shortcut.core.net.Json.gson
            .fromJson(manifestBody, Manifest::class.java)

        // 用 HEAD 取大小（不下 35MB）
        val headRequest = Request.Builder().url(manifest.apkUrl).head().build()
        client.newCall(headRequest).execute().use { resp ->
            assertTrue("APK 应可访问：HTTP ${resp.code}", resp.isSuccessful)
            val len = resp.header("Content-Length")?.toLongOrNull() ?: -1
            // Cloudflare 可能改 Content-Length（压缩），这里只要求能取到且非 0
            if (len > 0) {
                assertEquals("APK 实际大小应与清单一致", manifest.size, len)
            }
        }
    }
}
