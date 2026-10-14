package com.wanan.shortcut.core.blob

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import com.google.gson.JsonObject
import com.wanan.shortcut.core.net.ApiGateway
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 分片上传/下载引擎（契约 §6.1）—— **共享能力底座**。
 *
 * ## 为什么放在 core 而不是某个板块里
 *
 * 文件上传是"文件共享"板块与"共享给他人"两条路径**都要用**的能力
 * （web 的 `transfer/index.html` 里 `uploadFileToMessages()` 被两处复用）。
 * 放进 core 后，第二个用到它的板块不必重写一遍分片逻辑。
 *
 * 流程（严格照契约 §6.1）：
 * ```
 * ① transfer.fileInit  → 拿 file.id / chunkSize / chunkCount
 * ② 逐片 uploadChunk（chunkIndex 从 0 开始，连续）
 * ③ transfer.fileComplete → 服务端校验连续性 + 算全文件 sha256 → 产生文件消息
 * ```
 *
 * ## 契约点名的坑，这里逐条处理
 *
 * | 坑 | 处理 |
 * |---|---|
 * | 自己算分片大小 → `分片序号无效`（陷阱 #4） | **回读服务端返回的 `chunkSize`/`chunkCount`**，不自己算 |
 * | 分片传 base64（陷阱 #5） | 用 multipart 二进制字段 |
 * | `chunkIndex` 从 1 开始 | 从 **0** 开始 |
 * | 分片不连续 → `文件仍有分片未上传` | 顺序 0..n-1，任一失败即中止并报错 |
 */
class BlobEngine(
    private val apiClient: ApiGateway,
    private val fileApi: FileApiClient,
) {

    /**
     * 下载文件（契约 §6.6），流式写入 [sink]。
     *
     * 直接暴露给板块，避免每个板块各自持有 [FileApiClient]。
     *
     * @param downloadToken 非空表示"凭共享令牌下载"（无需身份、一次性、900 秒）
     */
    suspend fun download(
        fileId: String,
        sink: java.io.OutputStream,
        downloadToken: String? = null,
    ): ApiResult<FileApiClient.DownloadResult> =
        fileApi.download(fileId = fileId, sink = sink, downloadToken = downloadToken)

    /** 上传进度回调（0f..1f）。UI 用它显示进度条。 */
    fun interface ProgressListener {
        fun onProgress(sent: Int, total: Int)
    }

    /** 上传结果：服务端产生的文件消息。 */
    data class UploadedFile(
        val fileId: String,
        val name: String,
        val size: Long,
        /** 完整消息对象（含 `id`，共享文件时要它的 messageId） */
        val message: JsonObject,
    )

    /**
     * 用 `content://` URI 上传一个文件（Android 相册/文件选择器给出的就是这种 URI）。
     *
     * @param uri 文件来源
     * @param displayName 展示用文件名（从 URI 解析，解析不到则用 `file`）
     * @param mime MIME 类型；空则用 `application/octet-stream`
     */
    suspend fun uploadUri(
        context: Context,
        uri: Uri,
        displayName: String,
        mime: String,
        size: Long,
        onProgress: ProgressListener? = null,
    ): ApiResult<UploadedFile> {
        // 契约 §6.2：单文件 > 0 且 ≤ 1 GB（服务端也会校验，这里先拦避免白传）
        if (size <= 0L) return ApiResult.BusinessFail("文件为空")
        if (size > MAX_FILE_BYTES) return ApiResult.BusinessFail("单个文件不能超过 1 GB")

        // ① fileInit
        val init = fileInit(name = displayName, size = size, mime = mime)
        val initOk = when (init) {
            is ApiResult.Ok -> init
            is ApiResult.BusinessFail -> return init
            is ApiResult.TransportFail -> return init
            ApiResult.Unauthorized -> return ApiResult.Unauthorized
        }

        val fileObj = initOk.data.getAsJsonObject("file")
            ?: return ApiResult.TransportFail(ApiResult.TransportFail.Kind.BAD_RESPONSE)

        val fileId = fileObj.stringOrEmpty("id")
        if (fileId.isBlank()) {
            return ApiResult.TransportFail(ApiResult.TransportFail.Kind.BAD_RESPONSE)
        }

        // ★ 回读服务端给的分片参数，**不自己算**（陷阱 #4）
        val chunkSize = fileObj.intOrZero("chunkSize").takeIf { it > 0 } ?: DEFAULT_CHUNK_SIZE
        val chunkCount = fileObj.intOrZero("chunkCount").takeIf { it > 0 }
            ?: ((size + chunkSize - 1) / chunkSize).toInt()

        // ② 逐片上传，0..chunkCount-1
        var sent = 0
        onProgress?.onProgress(0, size.toInt())

        val resolver: ContentResolver = context.contentResolver
        for (index in 0 until chunkCount) {
            val start = index.toLong() * chunkSize
            val end = minOf(size, start + chunkSize)
            val length = (end - start).toInt()
            if (length <= 0) continue

            val chunk = withContext(Dispatchers.IO) {
                readChunk(resolver, uri, start, length)
            } ?: return ApiResult.BusinessFail("读取文件失败（第 $index 片）")

            // 上报分片哈希：契约说"传了就必须对"。这里上报是为了让服务端能发现传输损坏。
            // 若对端校验失败会返回 400「分片哈希校验失败」，比默默写入坏数据好。
            val hash = sha256Hex(chunk)

            when (
                val r = fileApi.uploadChunk(
                    fileId = fileId,
                    chunkIndex = index,
                    chunk = chunk,
                    fileName = "$displayName.part",
                    chunkHash = hash,
                )
            ) {
                is ApiResult.Ok -> Unit
                is ApiResult.BusinessFail -> return r
                is ApiResult.TransportFail -> return r
                ApiResult.Unauthorized -> return ApiResult.Unauthorized
            }

            sent += length
            onProgress?.onProgress(sent, size.toInt())
        }

        // ③ fileComplete（服务端会校验 0..n-1 连续）
        return when (val done = fileComplete(fileId)) {
            is ApiResult.Ok -> {
                val message = done.data.getAsJsonObject("message")
                    ?: return ApiResult.TransportFail(ApiResult.TransportFail.Kind.BAD_RESPONSE)
                ApiResult.Ok(
                    UploadedFile(
                        fileId = fileId,
                        name = message.stringOrEmpty("name").ifBlank { displayName },
                        size = message.longOrZero("size").takeIf { it > 0 } ?: size,
                        message = message,
                    ),
                )
            }
            is ApiResult.BusinessFail -> done
            is ApiResult.TransportFail -> done
            ApiResult.Unauthorized -> ApiResult.Unauthorized
        }
    }

    /** `transfer.fileInit`（契约 §6.2） */
    suspend fun fileInit(name: String, size: Long, mime: String): ApiResult<JsonObject> =
        apiClient.post(
            "transfer.fileInit",
            mapOf(
                "name" to name,
                "size" to size,
                "mime" to mime,
                // 明确 2 MiB：契约默认也是它（钳制 256 KiB..5 MiB）
                "chunkSize" to DEFAULT_CHUNK_SIZE,
            ),
        )

    /** `transfer.fileComplete`（契约 §6.4） */
    suspend fun fileComplete(fileId: String): ApiResult<JsonObject> =
        apiClient.post("transfer.fileComplete", mapOf("fileId" to fileId))

    /** `blob.status` —— 断点续传查询（契约 §6.5） */
    suspend fun status(fileId: String): ApiResult<JsonObject> =
        apiClient.post("blob.status", mapOf("fileId" to fileId))

    private fun readChunk(
        resolver: ContentResolver,
        uri: Uri,
        offset: Long,
        length: Int,
    ): ByteArray? = try {
        resolver.openInputStream(uri)?.use { input ->
            // 跳到分片起点后读满 length（InputStream 不保证一次读满）
            var skipped = 0L
            while (skipped < offset) {
                val s = input.skip(offset - skipped)
                if (s <= 0) break
                skipped += s
            }
            val buffer = ByteArray(length)
            var read = 0
            while (read < length) {
                val n = input.read(buffer, read, length - read)
                if (n <= 0) break
                read += n
            }
            if (read == length) buffer else buffer.copyOf(read)
        }
    } catch (t: Throwable) {
        null
    }

    companion object {
        /** 契约 §6.2：`chunkSize` 默认 2 MiB（钳制 256 KiB..5 MiB） */
        const val DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024

        /** 契约 §6.2：单文件上限 1 GB */
        const val MAX_FILE_BYTES = 1024L * 1024 * 1024
    }
}

// ---- JsonObject 安全读取（字段可能是数字/字符串/缺失）----

internal fun JsonObject.stringOrEmpty(key: String): String =
    if (has(key) && !get(key).isJsonNull) runCatching { get(key).asString }.getOrDefault("") else ""

internal fun JsonObject.intOrZero(key: String): Int =
    if (has(key) && !get(key).isJsonNull) runCatching { get(key).asInt }.getOrDefault(0) else 0

internal fun JsonObject.longOrZero(key: String): Long =
    if (has(key) && !get(key).isJsonNull) runCatching { get(key).asLong }.getOrDefault(0L) else 0L
