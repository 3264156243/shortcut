package com.wanan.shortcut.core.update

import com.wanan.shortcut.core.net.Endpoints
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * 更新检查与下载（契约层面属于"自建分发"，不走 sync 协议）。
 *
 * ## 与桌面端更新机制的关系
 *
 * 桌面端用 `electron-updater` + `latest.yml`（`updates/latest.yml`）。
 * 安卓端的清单放在**平级目录** `updates/android/latest.json` ——
 * 字段设计借鉴桌面端（版本、大小、sha256、更新说明），但判据换成 `versionCode`
 * （见 [UpdateManifest] 的说明）。
 *
 * ## 为什么必须校验 sha256
 *
 * APK 从网络下载，中途损坏或被中间人替换都会导致：
 *   - 装不上（签名/包结构损坏）→ 用户以为"更新坏了"
 *   - 更糟：装上一个被篡改的包
 *
 * 服务端清单里给了 sha256，下载后**逐个字节算完比对**，不一致就删掉、不提示安装。
 * 这不是"锦上添花"，是**下载-安装链路的基本正确性**。
 */
class UpdateClient(
    private val manifestUrl: String = Endpoints.ANDROID_UPDATE_MANIFEST,
    private val client: OkHttpClient = defaultClient(),
) {

    /**
     * 拉取版本清单。
     *
     * @return 成功且字段可用时返回 [UpdateManifest]；网络失败/格式错误返回失败
     */
    suspend fun fetchManifest(): ApiResult<UpdateManifest> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(manifestUrl)
            // 更新清单**必须不缓存**：否则刚发布的版本可能被 CDN/本地缓存挡住，
            // 用户点"检查更新"永远看不到新版。
            .header("Cache-Control", "no-cache")
            .header("Pragma", "no-cache")
            .get()
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext ApiResult.BusinessFail(
                        "检查更新失败（HTTP ${response.code}）",
                        response.code,
                    )
                }
                val raw = response.body?.string().orEmpty()
                val obj = Json.parseObject(raw)
                    ?: return@withContext ApiResult.TransportFail(
                        ApiResult.TransportFail.Kind.BAD_RESPONSE,
                    )

                val manifest = try {
                    Json.gson.fromJson(obj, UpdateManifest::class.java)
                } catch (e: Exception) {
                    null
                }

                if (manifest == null || !manifest.isUsable) {
                    // 清单不完整时不当作"有新版本"，也不报错打扰用户 ——
                    // 直接视为"暂无更新"更安全（避免因为服务端配置问题弹一个装不了的更新）
                    ApiResult.BusinessFail("版本信息不完整")
                } else {
                    ApiResult.Ok(manifest)
                }
            }
        } catch (e: IOException) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        } catch (e: Exception) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.UNKNOWN, cause = e)
        }
    }

    /** 下载进度回调（已下载字节 / 总字节）。总字节可能为 0（服务端没给 Content-Length）。 */
    fun interface ProgressListener {
        fun onProgress(downloaded: Long, total: Long)
    }

    /**
     * 下载 APK 到 [targetFile]，并**校验 sha256**。
     *
     * ## ★ 进度回调必须限流（这是修掉的真实性能问题）
     *
     * 用户反馈"更新下载速度太慢，几 kb/s，手机网络正常"。
     * 服务端本身不慢（实测 Cloudflare 命中缓存、本机 1.3 MB/s），
     * 慢在**客户端自己的回调频率**：
     *
     * 早先每读 64 KB 就回调一次 → 35 MB 约 **565 次**回调，
     * 而每次回调都会新建一个 `UpdateUiState.Downloading` 推给 StateFlow，
     * 触发整页 Compose 重组（重建整个对话框 + 进度条 + 文本）。
     * 这些重组跑在主线程，反过来拖住下载循环 → 下载看起来只有几 KB/s。
     *
     * 现在改成：**按时间限流**（默认 150ms 一次，约 6.7 次/秒），
     * UI 刷新足够顺滑，又不会把下载线程压住。
     *
     * @param onProgress 进度回调（在 IO 线程调用，已限流）
     * @return 成功返回文件；校验失败/网络失败返回失败，且**已删除半成品文件**
     */
    suspend fun download(
        manifest: UpdateManifest,
        targetFile: File,
        progressIntervalMs: Long = 150L,
        onProgress: ProgressListener? = null,
    ): ApiResult<File> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(manifest.apkUrl).get().build()

        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext ApiResult.BusinessFail(
                        "下载失败（HTTP ${response.code}）",
                        response.code,
                    )
                }
                val body = response.body
                    ?: return@withContext ApiResult.TransportFail(
                        ApiResult.TransportFail.Kind.BAD_RESPONSE,
                    )

                // 服务端给了大小就用它；否则回落清单里的 size
                val total = if (body.contentLength() > 0) body.contentLength() else manifest.size

                targetFile.parentFile?.mkdirs()
                val digest = MessageDigest.getInstance("SHA-256")
                var downloaded = 0L

                // 限流用的时间戳（见 KDoc：无限流会拖死下载）
                var lastReportMs = 0L

                try {
                    FileOutputStream(targetFile).use { out ->
                        body.byteStream().use { input ->
                            // 缓冲区从 64KB 提到 256KB：减少系统调用次数，
                            // 对 35MB 的文件更友好（移动网络下尤其明显）
                            val buffer = ByteArray(256 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read <= 0) break
                                out.write(buffer, 0, read)
                                digest.update(buffer, 0, read)
                                downloaded += read

                                // ★ 按时间限流，而不是每次读都回调
                                val now = System.currentTimeMillis()
                                if (now - lastReportMs >= progressIntervalMs) {
                                    lastReportMs = now
                                    onProgress?.onProgress(downloaded, total)
                                }
                            }
                        }
                        out.flush()
                    }

                    // 收尾：保证 UI 一定看到 100%（限流可能跳过了最后一次）
                    onProgress?.onProgress(downloaded, total)
                } catch (e: IOException) {
                    targetFile.delete()
                    return@withContext ApiResult.TransportFail(
                        ApiResult.TransportFail.Kind.NETWORK, cause = e,
                    )
                }

                // ★ 校验 sha256：不一致就删掉，绝不提示安装
                val actual = digest.digest().toHex()
                if (!actual.equals(manifest.sha256, ignoreCase = true)) {
                    targetFile.delete()
                    return@withContext ApiResult.BusinessFail(
                        "安装包校验失败（可能下载不完整），请重试",
                    )
                }

                // 顺带校验大小（服务端声明了的话）—— 双保险
                if (manifest.size > 0 && downloaded != manifest.size) {
                    targetFile.delete()
                    return@withContext ApiResult.BusinessFail(
                        "安装包大小不符（预期 ${manifest.size} 字节，实际 $downloaded）",
                    )
                }

                ApiResult.Ok(targetFile)
            }
        } catch (e: IOException) {
            targetFile.delete()
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        } catch (e: Exception) {
            targetFile.delete()
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.UNKNOWN, cause = e)
        }
    }

    companion object {
        /**
         * 下载超时给得比较宽：APK 有几十 MB，慢网络下需要时间。
         * 但**不能设成 0（无限）** —— 卡住时要能失败，而不是永远转圈。
         */
        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}

/** 字节数组 → 小写 hex（与清单里 sha256 的表示一致）。 */
internal fun ByteArray.toHex(): String {
    val sb = StringBuilder(size * 2)
    for (b in this) {
        val v = b.toInt() and 0xFF
        sb.append("0123456789abcdef"[v ushr 4])
        sb.append("0123456789abcdef"[v and 0x0F])
    }
    return sb.toString()
}

/**
 * 计算文件的 sha256（用于"已下载文件是否还有效"的判断，
 * 例如下载完成但用户当时没安装、下次启动要不要重新下）。
 */
fun sha256OfFile(file: File): String? = try {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            digest.update(buffer, 0, read)
        }
    }
    digest.digest().toHex()
} catch (e: Exception) {
    null
}
