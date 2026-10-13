package com.wanan.shortcut

import com.wanan.shortcut.core.net.Json
import com.wanan.shortcut.core.util.DateFormats
import com.wanan.shortcut.feature.linked.taskwall.PullResponse
import com.wanan.shortcut.feature.linked.taskwall.PushResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * 任务墙（queue 能力）协议测试（契约 §5）+ 时间格式测试（契约 §1.2）。
 *
 * 这里的数据全部取自 **2026-10-13 线上实测的真实响应**，
 * 而不是照文档手抄——文档与实现的差异正是最容易出 bug 的地方。
 */
class TaskwallContractTest {

    // ---------- 契约 §5.2：pull 响应 ----------

    @Test
    fun `pull 响应应正确解析长文本与提醒字段`() {
        // 线上实测的真实响应
        val body = """
            {"success":true,"tasks":[{"id":"rmt_a03a334713ebe3e8b9bdc04e",
             "text":"安卓端测试任务","longText":true,"details":"这是长文本详情",
             "reminderEnabled":true,"reminderAt":"2026-10-13T11:02:04.000Z",
             "boardName":"","createdAt":"2026-10-13T10:02:04+08:00"}],"count":1}
        """.trimIndent()
        val obj = Json.parseObject(body)!!

        val parsed = Json.gson.fromJson(obj, PullResponse::class.java)
        assertEquals(1, parsed.count)
        assertEquals(1, parsed.tasks.size)

        val task = parsed.tasks.first()
        assertEquals("rmt_a03a334713ebe3e8b9bdc04e", task.id)
        assertEquals("安卓端测试任务", task.text)
        assertTrue("longText 必须为 true", task.longText)
        assertEquals("这是长文本详情", task.details)
        assertTrue("reminderEnabled 必须为 true", task.reminderEnabled)
        assertEquals("2026-10-13T11:02:04.000Z", task.reminderAt)
        // createdAt 是 +08:00 形式，而 reminderAt 是 Z 形式 —— 两者格式不同
        assertEquals("2026-10-13T10:02:04+08:00", task.createdAt)
    }

    @Test
    fun `空任务列表应正常解析`() {
        // ack 之后 pull 会返回这个形状（实测确认）
        val obj = Json.parseObject("""{"success":true,"tasks":[],"count":0}""")!!
        val parsed = Json.gson.fromJson(obj, PullResponse::class.java)
        assertTrue(parsed.tasks.isEmpty())
        assertEquals(0, parsed.count)
    }

    // ---------- 契约 §5.1：push 响应与"已排队不等于失败" ----------

    @Test
    fun `push 返回 deliveredRealtime=false 时任务仍算成功入队`() {
        // 线上实测：桌面离线时 deliveredRealtime=false，但 success=true 且已入队。
        // 契约 §5.1 明确"false 不代表失败"。UI 必须区分文案，不能让用户以为发丢了。
        val body = """{"success":true,"taskId":"rmt_a03a334713ebe3e8b9bdc04e",
                       "deliveredRealtime":false,"desktopOnline":false}"""
        val obj = Json.parseObject(body)!!
        assertTrue("这仍是成功响应", Json.isSuccess(obj))

        val parsed = Json.gson.fromJson(obj, PushResponse::class.java)
        assertFalse(parsed.deliveredRealtime)
        assertFalse(parsed.desktopOnline)
        assertEquals("rmt_a03a334713ebe3e8b9bdc04e", parsed.taskId)
    }

    // ---------- 契约 §5：board 必须是 taskwall ----------

    @Test
    fun `push 失败文案应可被识别`() {
        // 以下四条均为 2026-10-13 线上实测的真实失败响应（HTTP 均为 200）
        val cases = mapOf(
            """{"success":false,"message":"任务标题不能为空"}""" to "任务标题不能为空",
            """{"success":false,"message":"暂不支持的板块"}""" to "暂不支持的板块",
            """{"success":false,"message":"提醒时间格式无效"}""" to "提醒时间格式无效",
            """{"success":false,"message":"缺少待确认任务"}""" to "缺少待确认任务",
        )
        cases.forEach { (json, expected) ->
            val obj = Json.parseObject(json)!!
            assertFalse("必须判为失败: $json", Json.isSuccess(obj))
            assertEquals(expected, Json.messageOf(obj))
        }
    }

    // ---------- 契约 §1.2：两种时间格式必须分别处理 ----------

    @Test
    fun `服务端时间应能解析带偏移与不带偏移两种形态`() {
        // 带 +08:00（PHP date('c')）
        assertNotNull(DateFormats.parseServerTime("2026-10-13T10:02:04+08:00"))
        // 不带偏移（某些字段可能没有）
        assertNotNull(DateFormats.parseServerTime("2026-10-13T10:02:04"))

        // 2026-10-13T10:02:04+08:00 == UTC 02:02:04
        val millis = DateFormats.parseServerTime("2026-10-13T10:02:04+08:00")!!
        val utc = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = millis }
        assertEquals(2, utc.get(Calendar.HOUR_OF_DAY))
        assertEquals(13, utc.get(Calendar.DAY_OF_MONTH))
    }

    @Test
    fun `解析失败应返回 null 而不是抛异常`() {
        // 一条任务的显示时间不该让整个列表崩掉
        assertNull(DateFormats.parseServerTime(""))
        assertNull(DateFormats.parseServerTime("not-a-date"))
        assertNull(DateFormats.parseServerTime("2026-13-45T99:99:99+08:00"))
    }

    @Test
    fun `reminderAt 应生成为 UTC 的 Z 形式`() {
        // 契约 §1.2：reminderAt 是客户端原样透传的，网页端发 toISOString() 的 UTC 形式。
        // 必须与之一致，否则桌面端解析出的提醒时刻会偏 8 小时。
        val millis = DateFormats.parseServerTime("2026-10-13T10:02:04+08:00")!!
        val iso = DateFormats.toIsoUtc(millis)

        assertTrue("必须是 Z 结尾: $iso", iso.endsWith("Z"))
        assertEquals("2026-10-13T02:02:04.000Z", iso)
    }

    @Test
    fun `UTC 与本地时间转换应保持同一时刻`() {
        // 关键回归点：如果实现里漏了 timeZone = UTC，
        // 在 UTC+8 机器上生成的字符串会比真实时刻早 8 小时。
        val original = 1_760_000_000_000L   // 任意固定时刻
        val iso = DateFormats.toIsoUtc(original)

        // 用独立的解析路径还原，确认是同一时刻
        val restored = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .parse(iso)!!.time
        assertEquals(original, restored)
    }
}
