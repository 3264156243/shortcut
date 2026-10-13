package com.wanan.shortcut.core.net

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive

/**
 * 把 Kotlin 值安全地放进 [JsonObject]。
 *
 * 为什么要这个：Gson 的 `addProperty` 只有 String/Number/Boolean/Char 四个重载，
 * 直接传 `Any?` 编译不过；而协议里的 `params` 天然是异构的
 * （文本是 String、`longText`/`reminderEnabled` 是 Boolean、`chunkIndex` 是 Int、
 * `keys`/`taskIds` 是数组、`boards` 是字符串数组）。
 *
 * ⚠️ 这里还要处理契约里一个很容易踩的点（§5.1）：
 * 服务端对 `longText` / `reminderEnabled` 要求**严格 `=== true`** 才生效。
 * 也就是说必须发真正的 JSON `true`，发 `"true"` 字符串是**无效**的。
 * 所以本函数对 Boolean 一律走 [JsonPrimitive] 的布尔分支，绝不做字符串化。
 */
internal fun putValue(target: JsonObject, key: String, value: Any?) {
    when (value) {
        null -> target.add(key, com.google.gson.JsonNull.INSTANCE)

        is Boolean -> target.addProperty(key, value)          // → JSON true/false（严格比较要求）
        is Number -> target.addProperty(key, value)
        is Char -> target.addProperty(key, value)
        is String -> target.addProperty(key, value)

        is Array<*> -> {
            val arr = JsonArray()
            value.forEach { item -> arr.add(primitiveOf(item)) }
            target.add(key, arr)
        }

        is Iterable<*> -> {
            val arr = JsonArray()
            value.forEach { item -> arr.add(primitiveOf(item)) }
            target.add(key, arr)
        }

        else -> target.addProperty(key, value.toString())
    }
}

/** 数组元素的轻量转换（协议里的数组元素都是标量）。 */
private fun primitiveOf(item: Any?) = when (item) {
    null -> com.google.gson.JsonNull.INSTANCE
    is Boolean -> JsonPrimitive(item)
    is Number -> JsonPrimitive(item)
    is String -> JsonPrimitive(item)
    else -> JsonPrimitive(item.toString())
}

/**
 * 供单元测试直接调用 [putValue]。
 *
 * 用它而不是把 [putValue] 改成 public：生产代码的可见性不该为测试让步，
 * 但"严格布尔"这条契约（§5.1）值得用测试锁住——写错会导致
 * 长文本/提醒时间被服务端**静默忽略**，是最难排查的一类 bug。
 */
internal fun putValueForTest(target: JsonObject, key: String, value: Any?) =
    putValue(target, key, value)
