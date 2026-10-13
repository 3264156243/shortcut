package com.wanan.shortcut

import com.google.gson.JsonObject
import com.wanan.shortcut.core.net.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 协议层自证测试 —— **不依赖真机、不依赖网络**，`gradle test` 即可跑。
 *
 * 为什么这些测试重要：契约里的绝大多数坑都是"判断逻辑写错"，
 * 而这些逻辑在真机上要复现很麻烦（要么占用真实绑定、要么制造限流）。
 * 把它们固化成单元测试，才能在每次改动后确认没有回归。
 */
class ProtocolContractTest {

    // ---------- 契约 §1.2：api.php 业务失败也是 HTTP 200 ----------

    @Test
    fun `业务失败仍应被识别为失败`() {
        // 这正是线上"未知操作"的真实响应，HTTP 状态是 200
        val body = """{"success":false,"message":"未知操作"}"""
        val obj = Json.parseObject(body)!!

        assertFalse("success=false 必须判为失败，绝不能按 HTTP 200 当成功", Json.isSuccess(obj))
        assertEquals("未知操作", Json.messageOf(obj))
    }

    @Test
    fun `业务成功应被识别为成功`() {
        val obj = Json.parseObject("""{"success":true,"bindId":"w9cwEp3mlpwTB4y1e90WpNhN"}""")!!
        assertTrue(Json.isSuccess(obj))
    }

    @Test
    fun `缺少 success 字段应视为失败`() {
        // 服务端所有分支都会带 success；缺失说明响应异常（如 HTML 错误页被解析）
        val obj = Json.parseObject("""{"message":"oops"}""")!!
        assertFalse(Json.isSuccess(obj))
    }

    @Test
    fun `success 为 null 应视为失败`() {
        val obj = Json.parseObject("""{"success":null}""")!!
        assertFalse(Json.isSuccess(obj))
    }

    @Test
    fun `非对象响应应返回 null 而不是抛异常`() {
        // 服务端故障时可能返回 HTML；不能让解析异常冒泡到 UI
        assertTrue(Json.parseObject("<html>502 Bad Gateway</html>") == null)
        assertTrue(Json.parseObject("") == null)
        assertTrue(Json.parseObject("[1,2,3]") == null)
    }

    // ---------- 契约 §2.6：mobile.bind 返回字段 ----------

    @Test
    fun `mobile_bind 响应字段可被正确读取`() {
        // 线上真实响应形状（2026-10-13 实测）
        val body = """
            {"success":true,"bindId":"0QIIVPkdtT32rxnpe19Dt3lB","code":"JLA7X4",
             "mobileToken":"537bcc4fefb6d18be07ddcd27067fa19849d171fef3235ed",
             "deviceId":"853c7925f726f0952a86eabd","deviceName":"安卓测试机"}
        """.trimIndent()
        val obj = Json.parseObject(body)!!

        assertTrue(Json.isSuccess(obj))
        assertEquals("0QIIVPkdtT32rxnpe19Dt3lB", obj.get("bindId").asString)
        assertEquals("853c7925f726f0952a86eabd", obj.get("deviceId").asString)
        // 48 位 hex（契约 §1.3）
        assertEquals(48, obj.get("mobileToken").asString.length)
    }

    // ---------- 契约 §4.1：module.list 的 policy 可能是数组也可能是对象 ----------

    @Test
    fun `policy 为数组时不应导致整个清单解析失败`() {
        // 真实响应里 taskwall 的 policy 就是 []；若声明成对象会直接抛异常，
        // 导致首页整个渲染不出来 —— 这是实际存在的形状差异。
        val body = """
            {"success":true,"version":1,"protocolVersion":1,"clientProtocol":1,
             "modules":[
               {"id":"taskwall","label":"任务墙","icon":"🗂️","entry":"/taskwall/",
                "capabilities":["queue"],"minAppVersion":"2.4.5","enabled":true,"policy":[]},
               {"id":"fileTransfer","label":"文件共享","entry":"/transfer/",
                "capabilities":["blob"],"minAppVersion":"2.4.5","enabled":true,
                "policy":{"maxFileMb":1024,"retentionHours":24}}
             ],"bound":false,"side":""}
        """.trimIndent()
        val obj = Json.parseObject(body)!!
        assertTrue(Json.isSuccess(obj))
        assertEquals(1, obj.get("protocolVersion").asInt)
        assertEquals(2, obj.getAsJsonArray("modules").size())
    }
}
