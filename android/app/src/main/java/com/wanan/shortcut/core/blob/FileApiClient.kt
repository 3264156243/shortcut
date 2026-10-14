package com.wanan.shortcut.core.blob

import com.google.gson.JsonObject
import com.wanan.shortcut.core.identity.IdentitySource
import com.wanan.shortcut.core.net.Endpoints
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.io.OutputStream
import java.net.SocketTimeoutException
import java.security.MessageDigest

/**
 * `file.php` 客户端 —— 契约 §6.3 / §6.6。
 *
 * ## ⚠️ 与 [com.wanan.shortcut.core.net.ApiClient] 的关键区别（契约 §1.2）
 *
 * | | `api.php` | `file.php` |
 * |---|---|---|
 * | 失败语义 | 业务失败**也是 HTTP 200**，必须读 `success` | 用**真实 HTTP 状态码**（400/403/404/405/500），**同时**返回 `success:false` |
 *
 * 所以这里的判断是**两者都看**：HTTP 非 2xx → 失败；即便 2xx 也再确认 `success`。
 * （契约 §10.2 陷阱 #3 是"用 HTTP 状态码判断 api.php"；反过来在这里漏看状态码同样会出错。）
 */
class FileApiClient(
    private val identitySource: IdentitySource,
    private val baseUrl: String = Endpoints.FILE,
    private val client: OkHttpClient = com.wanan.shortcut.core.net.HttpEngine.file,
) {

    /** 下载结果：写入字节数 + 服务端声明的 sha256 + 本地实算的 sha256。 */
    data class DownloadResult(
        val bytes: Long,
        /** 服务端响应头 `X-Checksum-Sha256`（可能为空串，见契约 §6.6） */
        val serverSha256: String,
        /** 本地边写边算的 sha256（小写 hex） */
        val localSha256: String,
    ) {
        /**
         * 校验是否通过。
         *
         * ⚠️ 服务端**可能返回空哈希**（大文件或未启用），此时**不算失败** ——
         * 不能因为拿不到校验和就拒绝一个已完整下载的文件。
         * 只有"服务端给了哈希且与本地不符"才是真失败。
         */
        val verified: Boolean
            get() = serverSha256.isBlank() || serverSha256.equals(localSha256, ignoreCase = true)
    }

    /**
     * 上传一个分片（契约 §6.3）。
     *
     * ⚠️ 要点（每条都是契约点名的坑）：
     *   - **仅 POST**；
     *   - `chunkIndex` **从 0 开始**（陷阱 #4）；
     *   - `chunk` 是 **multipart/form-data 的二进制文件字段**（不是 base64，陷阱 #5）；
     *   - `chunkHash` 可选，但**传了就必须对**（错了服务端 400 并删掉该分片）。
     *
     * @param chunkHash 该分片的 sha256 小写 hex；传 null 表示不上报
     */
    suspend fun uploadChunk(
        fileId: String,
        chunkIndex: Int,
        chunk: ByteArray,
        fileName: String,
        chunkHash: String? = null,
    ): ApiResult<JsonObject> = withContext(Dispatchers.IO) {
        val identity = identitySource.current()
        if (!identity.isBound) return@withContext ApiResult.Unauthorized

        val bodyBuilder = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("action", "uploadChunk")
            .addFormDataPart("bindId", identity.bindId)
            .addFormDataPart("mobileToken", identity.mobileToken)
            .addFormDataPart("fileId", fileId)
            .addFormDataPart("chunkIndex", chunkIndex.toString())
        if (!chunkHash.isNullOrBlank()) {
            bodyBuilder.addFormDataPart("chunkHash", chunkHash)
        }
        // 字段名必须是 chunk；第三个参数是文件名（服务端只当临时名用）
        bodyBuilder.addFormDataPart(
            "chunk",
            fileName,
            chunk.toRequestBody("application/octet-stream".toMediaTypeOrNull()),
        )

        val request = Request.Builder()
            .url(baseUrl)
            .post(bodyBuilder.build())
            .build()

        try {
            client.newCall(request).execute().use { response ->
                val obj = Json.parseObject(response.body?.string().orEmpty())

                // file.php 用真实状态码：先看状态码
                if (!response.isSuccessful) {
                    val message = obj?.let { Json.messageOf(it) }
                        ?: "分片上传失败（HTTP ${response.code}）"
                    if (response.code == 403 && message.contains("失效")) {
                        identitySource.onTokenRejected()
                        return@withContext ApiResult.Unauthorized
                    }
                    return@withContext ApiResult.BusinessFail(message, response.code)
                }

                if (obj == null) {
                    // 2xx 但不是 JSON：服务端异常（例如被网关截断）
                    return@withContext ApiResult.TransportFail(
                        ApiResult.TransportFail.Kind.BAD_RESPONSE, response.code,
                    )
                }
                if (!Json.isSuccess(obj)) {
                    val message = Json.messageOf(obj)
                    if (message.contains("失效")) {
                        identitySource.onTokenRejected()
                        return@withContext ApiResult.Unauthorized
                    }
                    return@withContext ApiResult.BusinessFail(message, response.code)
                }
                ApiResult.Ok(obj)
            }
        } catch (e: SocketTimeoutException) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.TIMEOUT, cause = e)
        } catch (e: IOException) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        } catch (e: Exception) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.UNKNOWN, cause = e)
        }
    }

    /**
     * 下载文件（契约 §6.6），**流式写入 [sink]**。
     *
     * 两种方式：
     *  1. **本人下载**：带 `bindId` + `mobileToken`；
     *  2. **凭下载令牌**：`token=dl_…`，**无需身份**，令牌**一次性**、900 秒有效（契约 §3.3）。
     *
     * ## 为什么不整份读进内存
     *
     * 单文件上限 **1 GB**（契约 §6.2），读成 ByteArray 会 OOM。
     * 这里边读边写，并**同时更新 sha256 摘要** —— 于是"流式"与"可校验"两者兼得，
     * 不必为了校验再读一遍文件。
     *
     * ## 关于校验和
     *
     * 服务端在响应头给 `X-Checksum-Sha256`（契约 §6.6）。它**可能是空串**，
     * 此时 [DownloadResult.verified] 为 true（不因拿不到校验和就判定失败）。
     */
    suspend fun download(
        fileId: String,
        sink: OutputStream,
        downloadToken: String? = null,
    ): ApiResult<DownloadResult> = withContext(Dispatchers.IO) {
        val useToken = !downloadToken.isNullOrBlank()
        val identity = identitySource.current()

        // 走令牌时不需要身份；走身份时必须已绑定
        if (!useToken && !identity.isBound) return@withContext ApiResult.Unauthorized

        val url = buildString {
            append(baseUrl)
            append("?action=download")
            if (useToken) {
                append("&token=").append(downloadToken)
            } else {
                append("&bindId=").append(identity.bindId)
                append("&mobileToken=").append(identity.mobileToken)
            }
            append("&fileId=").append(fileId)
        }

        val request = Request.Builder().url(url).get().build()

        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    // 失败时是 JSON（真实状态码）；成功时是二进制流
                    val obj = Json.parseObject(response.body?.string().orEmpty())
                    val message = obj?.let { Json.messageOf(it) }
                        ?: "下载失败（HTTP ${response.code}）"
                    if (response.code == 403 && message.contains("失效")) {
                        identitySource.onTokenRejected()
                        return@withContext ApiResult.Unauthorized
                    }
                    return@withContext ApiResult.BusinessFail(message, response.code)
                }

                val body = response.body
                    ?: return@withContext ApiResult.TransportFail(
                        ApiResult.TransportFail.Kind.BAD_RESPONSE, response.code,
                    )

                val serverSha = response.header("X-Checksum-Sha256").orEmpty()
                val digest = MessageDigest.getInstance("SHA-256")

                var written = 0L
                body.byteStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        sink.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        written += read
                    }
                }
                sink.flush()

                ApiResult.Ok(
                    DownloadResult(
                        bytes = written,
                        serverSha256 = serverSha,
                        localSha256 = digest.digest().toHex(),
                    ),
                )
            }
        } catch (e: SocketTimeoutException) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.TIMEOUT, cause = e)
        } catch (e: IOException) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        } catch (e: Exception) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.UNKNOWN, cause = e)
        }
    }
}

/** 字节数组 → 小写 hex（与契约里 sha256 的表示一致）。 */
internal fun ByteArray.toHex(): String {
    val sb = StringBuilder(size * 2)
    for (b in this) {
        val v = b.toInt() and 0xFF
        sb.append(HEX_CHARS[v ushr 4])
        sb.append(HEX_CHARS[v and 0x0F])
    }
    return sb.toString()
}

private const val HEX_CHARS = "0123456789abcdef"

/** 计算一段字节的 sha256 小写 hex（分片哈希上报用，契约 §6.3）。 */
fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).toHex()
