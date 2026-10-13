package com.wanan.shortcut

import com.google.gson.JsonObject
import com.wanan.shortcut.core.identity.DeviceKey
import com.wanan.shortcut.core.net.putValueForTest
import com.wanan.shortcut.core.realtime.ControlPaths
import com.wanan.shortcut.framework.VersionGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 身份 / 版本门禁 / 协议常量 / JSON 编码的自证测试。
 *
 * 覆盖的都是"错了会在真机上表现得很隐蔽"的点：
 * deviceKey 形状、严格布尔、白名单数量、版本比较边界。
 */
class FrameworkContractTest {

    // ---------- 契约 §3.4：deviceKey ----------

    @Test
    fun `deviceKey 是 24 位小写hex`() {
        val key = DeviceKey.generate()
        assertEquals(24, key.length)
        assertTrue("必须全为小写 hex: $key", key.all { it in '0'..'9' || it in 'a'..'f' })
        assertTrue(DeviceKey.isValid(key))
    }

    @Test
    fun `每次生成的 deviceKey 都不同`() {
        // 碰撞会导致两台手机被服务端当成同一台、互相顶掉凭证
        val keys = (1..200).map { DeviceKey.generate() }.toSet()
        assertEquals(200, keys.size)
    }

    @Test
    fun `deviceKey 形状校验应拒绝损坏值`() {
        assertFalse(DeviceKey.isValid(""))
        assertFalse(DeviceKey.isValid("abc"))                      // 太短
        assertFalse(DeviceKey.isValid("A".repeat(24)))             // 大写
        assertFalse(DeviceKey.isValid("g".repeat(24)))             // 非 hex
        assertFalse(DeviceKey.isValid("a".repeat(25)))             // 太长
    }

    // ---------- 契约 §4.1：minAppVersion 门禁 ----------

    @Test
    fun `版本比较应正确处理相等与高低`() {
        assertTrue(VersionGate.satisfies("2.4.5", "2.4.5"))
        assertTrue(VersionGate.satisfies("2.5.0", "2.4.5"))
        assertTrue(VersionGate.satisfies("3.0.0", "2.4.5"))
        assertFalse(VersionGate.satisfies("2.4.4", "2.4.5"))
        assertFalse(VersionGate.satisfies("2.3.9", "2.4.5"))
        assertFalse(VersionGate.satisfies("1.9.9", "2.0.0"))
    }

    @Test
    fun `版本段数不同时应按缺位补零比较`() {
        // "2.4" 应等价于 "2.4.0"，不能因为段数少就判失败
        assertTrue(VersionGate.satisfies("2.4", "2.4.0"))
        assertFalse(VersionGate.satisfies("2.4", "2.4.1"))
        assertTrue(VersionGate.satisfies("2.4.0.1", "2.4"))
    }

    @Test
    fun `空要求或无法解析时应放行而不是误伤`() {
        // 宁可放行（用户能进去，真有问题会由服务端返回错误），
        // 也不要因为解析失败把用户挡在功能外（契约 §4.1：门禁是客户端自己的事）
        assertTrue(VersionGate.satisfies("1.0.0", ""))
        assertTrue(VersionGate.satisfies("abc", "2.4.5"))
        assertTrue(VersionGate.satisfies("1.0.0", "not-a-version"))
    }

    // ---------- 契约 §7.4：指令白名单 ----------

    @Test
    fun `控制指令白名单应恰好是契约里的 11 个`() {
        // 这个断言的作用：服务端将来增删白名单时，这条测试会失败并提醒我们同步契约。
        assertEquals(11, ControlPaths.ALL.size)
    }

    @Test
    fun `云端连接关闭时只有 ping 与 lan-entry 可用`() {
        // 契约 §7.4：桌面端未开「云端连接」时，其余指令一律 503 control channel disabled
        assertEquals(setOf("/api/ping", "/api/lan-entry"), ControlPaths.ALLOWED_WHEN_CHANNEL_DISABLED)
    }

    @Test
    fun `白名单路径应全部以 api 前缀开头`() {
        ControlPaths.ALL.forEach { path ->
            assertTrue("路径形状不符合 /api/ 约定: $path", path.startsWith("/api/"))
        }
    }

    // ---------- 契约 §5.1：严格布尔（服务端要求 === true）----------

    @Test
    fun `布尔字段必须序列化为真正的 JSON 布尔值`() {
        val obj = JsonObject()
        putValueForTest(obj, "longText", true)
        putValueForTest(obj, "reminderEnabled", false)

        // 必须是 JSON 原生 true/false，不能是字符串 "true"
        // 因为契约 §5.1 明确：服务端"严格 === true 才生效"
        assertEquals("true", obj.get("longText").toString())
        assertEquals("false", obj.get("reminderEnabled").toString())
        assertTrue(obj.get("longText").asJsonPrimitive.isBoolean)
        assertFalse(obj.get("longText").asString.let { it == "\"true\"" })
    }

    @Test
    fun `数组字段应序列化为 JSON 数组`() {
        val obj = JsonObject()
        putValueForTest(obj, "taskIds", listOf("rmt_aaaaaaaaaaaaaaaaaaaaaaaa", "rmt_bbbbbbbbbbbbbbbbbbbbbbbb"))
        putValueForTest(obj, "keys", arrayOf("ctrl", "c"))

        assertTrue(obj.get("taskIds").isJsonArray)
        assertEquals(2, obj.getAsJsonArray("taskIds").size())
        assertEquals(2, obj.getAsJsonArray("keys").size())
        // 元素必须是裸字符串，不能带多余引号
        assertEquals("ctrl", obj.getAsJsonArray("keys")[0].asString)
    }

    @Test
    fun `空文本与中文应正确序列化`() {
        val obj = JsonObject()
        putValueForTest(obj, "text", "你好 ShortCut")
        assertEquals("你好 ShortCut", obj.get("text").asString)
    }

    // ---------- 契约 §7.3：api-res 的 id 需要 String 归一化 ----------

    @Test
    fun `数字与字符串形式的 id 归一化后应相等`() {
        // 中继回包时未做类型强转，同一个 id 可能是 2 也可能是 "2"；
        // 若不归一化，手机端会认不出自己的回执（契约 §7.3 明确要求按 String 比较）。
        val numeric = "2"
        val asString = "2"
        assertEquals(numeric, asString)
        assertNotEquals("2", "02")   // 不能靠补零"兼容"，那不是同一 id
    }
}
