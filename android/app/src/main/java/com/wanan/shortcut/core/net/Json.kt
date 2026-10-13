package com.wanan.shortcut.core.net

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonSyntaxException
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType

/**
 * JSON 工具。
 *
 * ⚠️ 关于编码（实测踩过）：PowerShell 默认按 GBK 发送中文时，服务端收到的 deviceName 是乱码。
 * 安卓侧同理——**必须显式指定 UTF-8**，不能依赖平台默认编码。
 * 这里把 charset 写死在 [JSON_UTF8] 里，OkHttp 会据此编码请求体。
 */
object Json {

    /**
     * 显式 UTF-8。
     * 契约 §1.2：服务端不校验 Content-Type 请求头，但**必须**能正确解出 UTF-8 的中文。
     */
    val JSON_UTF8: MediaType = "application/json; charset=utf-8".toMediaType()

    val gson: Gson = GsonBuilder()
        // 服务端字段是 snake_case 与 camelCase 混用（如 protocolVersion / minAppVersion），
        // 这里保留原样、由各数据类显式标注 @SerializedName，避免"自动转换"带来的隐性错配。
        .disableHtmlEscaping()
        .create()

    /** 解析成对象树；失败返回 null（不抛异常，调用方按 BAD_RESPONSE 处理）。 */
    fun parseObject(raw: String): JsonObject? = try {
        val el = JsonParser.parseString(raw)
        if (el.isJsonObject) el.asJsonObject else null
    } catch (e: JsonSyntaxException) {
        null
    }

    /**
     * 读取 `success` 字段——**api.php 判成败的唯一依据**（契约 §1.2）。
     * 缺省视为 false（服务端所有分支都会带该字段，缺失说明响应异常）。
     */
    fun isSuccess(obj: JsonObject): Boolean =
        obj.has("success") && !obj.get("success").isJsonNull && obj.get("success").asBoolean

    /** 读取错误文案（字符串契约，契约 §1.3）。 */
    fun messageOf(obj: JsonObject): String =
        if (obj.has("message") && !obj.get("message").isJsonNull) obj.get("message").asString else ""
}
