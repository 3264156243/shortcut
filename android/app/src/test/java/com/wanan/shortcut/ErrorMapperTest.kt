package com.wanan.shortcut

import com.wanan.shortcut.core.error.ErrorAction
import com.wanan.shortcut.core.error.ErrorMapper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 错误文案映射测试（契约 §1.3 / §1.4 / §2.6）。
 *
 * 契约把这些文案定义为**字符串契约**——服务端改文案就等于改接口。
 * 因此这里把每一条都固化成断言：文案一改，测试立刻失败，
 * 而不是等到用户反馈"点了没反应"。
 */
class ErrorMapperTest {

    private val mapper = ErrorMapper()

    // ---------- 身份失效 → 必须清本地身份 + 跳绑定页 ----------

    @Test
    fun `移动端绑定失效应触发重新绑定`() {
        val msg = "移动端绑定已失效，请重新绑定"
        assertTrue(mapper.isTokenRejected(msg))
        assertEquals(ErrorAction.REBIND, mapper.map(msg))
    }

    @Test
    fun `绑定身份无效与缺少bindId也应触发重新绑定`() {
        assertEquals(ErrorAction.REBIND, mapper.map("绑定身份无效"))
        assertEquals(ErrorAction.REBIND, mapper.map("缺少 bindId"))
    }

    @Test
    fun `桌面端的凭证文案不应被安卓端当作自身失效`() {
        // 契约 §1.3：这两条是桌面/兜底路径的文案，mobile 角色不会遇到。
        // 若误判会造成"安卓端无缘无故把自己解绑"，因此显式断言。
        assertFalse(mapper.isTokenRejected("凭证已失效，请重新绑定或升级客户端"))
        assertFalse(mapper.isTokenRejected("请升级 ShortCut 到最新版（缺少桌面端凭证）"))
    }

    // ---------- 限流 ----------

    @Test
    fun `各类限流文案都应映射为限流动作`() {
        // 契约 §1.4 的各 action 超限文案，共同特征是"过于频繁"
        val messages = listOf(
            "请求过于频繁，请稍后再试",
            "创建绑定过于频繁，请稍后再试",
            "绑定过于频繁，请稍后再试",
            "操作过于频繁，请稍后再试",
            "提交过于频繁，请稍后再试",
            "发送过于频繁",
            "任务墙同步过于频繁，请稍后再试",
        )
        messages.forEach { msg ->
            assertEquals("限流文案未被识别: $msg", ErrorAction.RATE_LIMITED, mapper.map(msg))
        }
    }

    // ---------- 绑定码无效：留在绑定页，不清身份 ----------

    @Test
    fun `绑定码无效应是输入错误而不是重新绑定`() {
        assertEquals(ErrorAction.INVALID_INPUT, mapper.map("绑定码无效"))
        assertEquals(ErrorAction.INVALID_INPUT, mapper.map("绑定码为空"))
    }

    // ---------- 手机数达上限：必须原样展示操作指引 ----------

    @Test
    fun `手机数达上限应原样展示服务端文案`() {
        // 这条文案里含"请先在电脑端「设置 → 移动互联 → 已绑定设备」里移除不用的设备"，
        // 改写会丢掉用户唯一能照做的操作指引（契约 §2.6）
        val msg = "本绑定已绑定 5 台手机（已达上限），请先在电脑端「设置 → 移动互联 → 已绑定设备」里移除不用的设备后再试"
        assertEquals(ErrorAction.SHOW_SERVER_MESSAGE, mapper.map(msg))
    }

    @Test
    fun `未知文案应回落到普通提示`() {
        assertEquals(ErrorAction.SHOW_MESSAGE, mapper.map("某个没见过的新错误"))
        assertEquals(ErrorAction.SHOW_MESSAGE, mapper.map(""))
    }
}
