package com.wanan.shortcut.core.lan

import com.google.gson.JsonObject
import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

/**
 * 局域网 HTTP 客户端（契约 §8.3 / §8.4）。
 *
 * ## ⚠️ 与云端接口的三处关键差异（照 web 与控制页实现对齐）
 *
 * 1. **没有 `success` 字段**：局域网接口成功就是 HTTP 200 + 自己的 JSON 形状
 *    （契约 §8.4 末尾明确写了"这里**没有** `success` 字段，与 api.php 不同！"）。
 * 2. **鉴权走 `Authorization: Bearer <token>`**（或 `x-token`），不是 `bindId`+`mobileToken`。
 * 3. **明文 HTTP**：`http://192.168.x.x:9823`。Android 9+ 默认拦截，
 *    已在 `network_security_config.xml` 放行（契约 §8.5）。
 *
 * ## 地址会变（契约 §8.5-2）
 *
 * 每次「局域网直连」都要重新向云端问 `/api/lan-entry`，**不要缓存 IP**。
 * 所以本类**不持有 baseUrl 字段** —— 每次调用都把 url 传进来，从类型上防止缓存。
 */
class LanClient(
    private val client: OkHttpClient = defaultClient(),
) {

    /**
     * 调一个局域网接口。
     *
     * @param baseUrl 形如 `http://192.168.1.5:9823`（由 `/api/lan-entry` 现取）
     * @param token 预授权令牌（桌面端「局域网直连」运行期间有效）
     * @param path 形如 `/api/type`
     * @param body POST 的 JSON 体；null 表示不需要 body
     */
    suspend fun post(
        baseUrl: String,
        token: String,
        path: String,
        body: Map<String, Any?>? = null,
    ): ApiResult<JsonObject> = withContext(Dispatchers.IO) {
        val url = baseUrl.trimEnd('/') + path
        val json = if (body == null) "{}" else Json.gson.toJson(body)
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            // 同时也带 x-token：契约 §8.3 说两者都接受，多带一个不会更差
            .header("x-token", token)
            .post(json.toRequestBody(JSON_UTF8))
            .build()

        try {
            client.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                val obj = Json.parseObject(raw)

                // 鉴权失败统一 401（契约 §8.4）
                if (response.code == 401) {
                    val mode = obj?.let { if (it.has("authMode")) it.get("authMode").asString else "" }.orEmpty()
                    return@withContext ApiResult.Unauthorized
                }

                if (!response.isSuccessful) {
                    // 局域网接口用真实状态码；错误体是 {error: "..."}（没有 success/message）
                    val err = obj?.let { o ->
                        when {
                            o.has("error") && !o.get("error").isJsonNull -> o.get("error").asString
                            o.has("message") && !o.get("message").isJsonNull -> o.get("message").asString
                            else -> null
                        }
                    }
                    return@withContext ApiResult.BusinessFail(
                        err ?: "局域网请求失败（HTTP ${response.code}）",
                        response.code,
                    )
                }

                if (obj == null) {
                    return@withContext ApiResult.TransportFail(
                        ApiResult.TransportFail.Kind.BAD_RESPONSE, response.code,
                    )
                }
                // ⚠️ 局域网接口**没有 success 字段**，到这里就算成功
                ApiResult.Ok(obj)
            }
        } catch (e: SocketTimeoutException) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.TIMEOUT, cause = e)
        } catch (e: IOException) {
            // 最常见的原因：手机与电脑不在同一 Wi-Fi（契约 §8.5-3）
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        } catch (e: Exception) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.UNKNOWN, cause = e)
        }
    }

    /**
     * `POST /api/pair` —— 用 6 位绑定码换令牌（契约 §8.4）。
     *
     * 只有 `authMode='pair'` 时才需要；用 `/api/lan-entry` 拿到的预授权 token 可以直接用。
     */
    suspend fun pair(baseUrl: String, code: String): ApiResult<String> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/api/pair")
            .post(Json.gson.toJson(mapOf("code" to code)).toRequestBody(JSON_UTF8))
            .build()
        try {
            client.newCall(request).execute().use { response ->
                val obj = Json.parseObject(response.body?.string().orEmpty())
                if (!response.isSuccessful) {
                    val err = obj?.let { if (it.has("error")) it.get("error").asString else null }
                    return@withContext ApiResult.BusinessFail(
                        err ?: "绑定码错误", response.code,
                    )
                }
                val token = obj?.let { if (it.has("token") && !it.get("token").isJsonNull) it.get("token").asString else "" }
                if (token.isNullOrBlank()) {
                    ApiResult.TransportFail(ApiResult.TransportFail.Kind.BAD_RESPONSE)
                } else {
                    ApiResult.Ok(token)
                }
            }
        } catch (e: Exception) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        }
    }

    /**
     * `GET /api/config` —— **无需鉴权**，告诉你这个服务要不要配对（契约 §8.4）。
     *
     * 比 [status] 更轻：只返回 `{authMode, requirePair, basePath}`。
     * 探测阶段用它**开销最小**；需要 `pairCode` / `urls` 时再用 [status]。
     */
    suspend fun config(baseUrl: String): ApiResult<JsonObject> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(baseUrl.trimEnd('/') + "/api/config").get().build()
        try {
            client.newCall(request).execute().use { response ->
                val obj = Json.parseObject(response.body?.string().orEmpty())
                if (!response.isSuccessful || obj == null) {
                    ApiResult.TransportFail(ApiResult.TransportFail.Kind.BAD_RESPONSE, response.code)
                } else {
                    ApiResult.Ok(obj)
                }
            }
        } catch (e: Exception) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        }
    }

    /**
     * `GET /api/status` —— **无需鉴权**，返回运行状态、候选地址与配对码（契约 §8.4）。
     *
     * ## 为什么这个接口对"不依赖云端的局域网直连"至关重要
     *
     * 契约 §8.2 的推荐路径是"经云端 WS 问 `/api/lan-entry`"，
     * 但那**要求云端通道可用**。而本接口无需鉴权、直接由电脑端的局域网服务提供，
     * 因此可以支撑一条**完全独立于云端**的路径：
     *
     * ```
     * 用户填/扫电脑地址 → GET /api/status 探测到服务 + 拿到 pairCode
     *                  → POST /api/pair 用 pairCode 换 token
     *                  → 之后所有控制指令带 Bearer token
     * ```
     *
     * 注意 `pairCode` **不是绑定码**：它是电脑端「局域网直连」启动时随机生成的
     * 6 位码（`src-tauri/src/control.rs` 的 `new_pair_code()`），可被 `/api/reset-code` 重置。
     */
    suspend fun status(baseUrl: String): ApiResult<JsonObject> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(baseUrl.trimEnd('/') + "/api/status").get().build()
        try {
            client.newCall(request).execute().use { response ->
                val obj = Json.parseObject(response.body?.string().orEmpty())
                if (!response.isSuccessful || obj == null) {
                    ApiResult.TransportFail(ApiResult.TransportFail.Kind.BAD_RESPONSE, response.code)
                } else {
                    ApiResult.Ok(obj)
                }
            }
        } catch (e: Exception) {
            ApiResult.TransportFail(ApiResult.TransportFail.Kind.NETWORK, cause = e)
        }
    }

    /**
     * 探测结果：一个候选局域网地址是否真的可达。
     */
    data class ProbeResult(
        val baseUrl: String,
        val reachable: Boolean,
        /** 可达时是"这个服务"（`/api/config` 能解析出 authMode） */
        val isControlService: Boolean,
        /** 不可达时的原因（给用户看） */
        val failure: String? = null,
    )

    /**
     * 探测一个候选地址是否可达。
     *
     * ## 为什么必须有这一步（这是修掉的真实缺陷）
     *
     * 桌面端用 `UdpSocket.connect("8.8.8.8:80")` 探测"默认出口网卡"来生成局域网地址
     * （`src-tauri/src/control.rs` 的 `lan_urls()`）。
     * 装了 VMware / VirtualBox / Docker 的电脑上，**这个探测很容易选中虚拟网卡**，
     * 得到的 IP（如 `192.168.56.1`）手机根本连不上。
     *
     * 更糟的是那个函数的"双网卡补充"**并未实现**（源码注释自己承认），
     * 所以 `urls` 实际只有一个候选 —— 选错了就没有备选。
     *
     * 而 web 端拿到地址后是"浏览器直接跳转"，失败就是白屏、用户无从判断。
     * 安卓端**不能重复这个体验**，所以这里先探测：
     *   - 可达 → 才宣布"已直连"；
     *   - 全不可达 → 给出可诊断的原因（而不是假装连上、每条指令都失败）。
     */
    suspend fun probe(baseUrl: String): ProbeResult = withContext(Dispatchers.IO) {
        val normalized = baseUrl.trimEnd('/')
        try {
            // 用 /api/config（无需鉴权）判断"是不是一个局域网控制服务"
            val request = Request.Builder().url("$normalized/api/config").get().build()
            client.newCall(request).execute().use { response ->
                val obj = Json.parseObject(response.body?.string().orEmpty())
                val looksLikeService = obj != null &&
                    (obj.has("authMode") || obj.has("basePath") || obj.has("requirePair"))
                ProbeResult(
                    baseUrl = normalized,
                    reachable = response.isSuccessful,
                    isControlService = looksLikeService,
                    failure = if (response.isSuccessful) null else "HTTP ${response.code}",
                )
            }
        } catch (e: SocketTimeoutException) {
            ProbeResult(normalized, reachable = false, isControlService = false, failure = "连接超时")
        } catch (e: IOException) {
            // 最常见：不在同一 Wi-Fi、网段不同、AP 隔离、电脑防火墙拦截
            ProbeResult(
                normalized,
                reachable = false,
                isControlService = false,
                failure = e.message ?: "网络不可达",
            )
        } catch (e: Exception) {
            ProbeResult(normalized, reachable = false, isControlService = false, failure = e.message)
        }
    }

    /**
     * 逐个候选地址探测，返回**第一个真正可达**的。
     *
     * @param candidates 桌面端给的候选地址（`url` + `urls`）；会去重
     * @return 命中的探测结果；全都不可达时返回 null
     */
    suspend fun probeFirstReachable(candidates: List<String>): ProbeResult? {
        val unique = candidates.map { it.trim().trimEnd('/') }
            .filter { it.isNotBlank() }
            .distinct()

        for (candidate in unique) {
            val result = probe(candidate)
            if (result.reachable) return result
        }
        return null
    }

    companion object {
        private val JSON_UTF8 = "application/json; charset=utf-8".toMediaType()

        /**
         * 局域网请求超时给得比较短：同网段延迟通常 5–15ms（契约 §8.1），
         * 长时间等待只说明"不在同一网络"，不如早点失败让用户回退到云端。
         */
        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .build()
    }
}
