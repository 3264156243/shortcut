package com.wanan.shortcut

import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.identity.IdentitySource
import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.net.Endpoints
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.feature.linked.taskwall.TaskwallRepository
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * **真实线上服务器**的联调测试（打 `shortcut.326415.xyz`）。
 *
 * ## 这个测试存在的意义
 *
 * 用户问过一句很关键的话："**当前这个任务墙功能是真的能用吗，是跑通了吗**"。
 * 当时的诚实回答是：协议层用 PowerShell 实测过、解析逻辑有单测，
 * 但**安卓端的代码从没真正发过一次请求**（本机无模拟器、无真机）。
 * "能编译 + 单测绿"不等于"链路能跑"。
 *
 * 本测试用**真实的 [ApiClient] / [TaskwallRepository]（线上同一套代码）**
 * 打真实服务端，覆盖手机端真正的职责闭环。
 *
 * ## ⚠️ 曾用错误的"通过标准"给 bug 盖章
 *
 * 本测试第一版写的是 `push → ack → 再拉取应为空`，并把它当成闭环通过。
 * 但 `ack` **是桌面端的职责**，手机端调用会把任务从队列删掉、
 * 导致桌面端永远收不到 —— 我当时等于用测试**确认了一个破坏性 bug**。
 *
 * 现已改为验证**正确的**契约：
 * - 手机 push 后，任务**必须留在队列里**（等桌面来取）；
 * - 手机端**不得**调用 `ack` 去消费它。
 *
 * 清理测试数据用 `ack` 是不得已（否则会在服务端留垃圾），
 * 但那一步是**测试收尾**，不是被测行为本身 —— 注释里已明确区分。
 *
 * ## 为什么默认跳过（`assumeTrue`）
 *
 * 会**在服务端留下真实数据**、需要网络、且受服务端限流影响。
 * 只在显式提供测试绑定凭据时运行（见 `android/README.md` §4.2）。
 *
 * ⚠️ 必须用**自建测试绑定**：`mobile.bind` 会**轮换**该设备凭证，
 * 拿真实绑定做实验会把用户的真机顶下线（协同规范 §8.11 明确禁止）。
 */
class LiveServerSmokeTest {

    private val bindId = System.getProperty("sc.live.bindId").orEmpty()
    private val mobileToken = System.getProperty("sc.live.mobileToken").orEmpty()

    private class FixedIdentity(private val identity: Identity) : IdentitySource {
        override fun current(): Identity = identity
        override suspend fun onTokenRejected() = Unit
    }

    private fun repository(): TaskwallRepository {
        val client = ApiClient(
            identityProvider = FixedIdentity(
                Identity(
                    bindId = bindId,
                    mobileToken = mobileToken,
                    deviceKey = "live".padEnd(24, '0'),
                    deviceId = "live",
                    deviceName = "live-smoke",
                ),
            ),
            errorMapper = ErrorMapper(),
            baseUrl = Endpoints.API,          // ★ 真实线上地址
            client = OkHttpClient(),
        )
        return TaskwallRepository(client)
    }

    private fun requireCreds() {
        assumeTrue(
            "未提供线上测试凭据，跳过（见 android/README.md §4.2）",
            bindId.isNotBlank() && mobileToken.isNotBlank(),
        )
    }

    @Test
    fun `线上_手机推送的任务必须留在队列里等桌面接收`() = runBlocking {
        requireCreds()
        val repo = repository()

        // 1) 基线
        val before = repo.pull()
        assertTrue("pull 应成功：$before", before is ApiResult.Ok)
        val beforeIds = (before as ApiResult.Ok).data.tasks.map { it.id }.toSet()

        // 2) 手机端下发（longText + reminder 同开，验证严格布尔真的生效）
        val marker = "android-live-${System.currentTimeMillis()}"
        val pushed = repo.push(
            text = marker,
            longText = true,
            details = "线上联调详情",
            reminderEnabled = true,
            reminderAtIso = "2026-12-31T00:00:00.000Z",
            boardName = "",
        )
        assertTrue("push 应成功：$pushed", pushed is ApiResult.Ok)
        val taskId = (pushed as ApiResult.Ok).data.taskId
        assertTrue("应返回 taskId", taskId.startsWith("rmt_"))

        // 3) ★ 核心断言：任务必须**还在队列里**（这是"桌面端能收到"的前提）
        val after = repo.pull()
        assertTrue("pull 应成功：$after", after is ApiResult.Ok)
        val tasks = (after as ApiResult.Ok).data.tasks
        val mine = tasks.firstOrNull { it.id == taskId }
        assertTrue(
            "手机 push 后任务必须留在队列里等桌面取走；取不到说明它被提前消费掉了",
            mine != null,
        )

        // 4) 字段原样回读（严格布尔生效的实证：若发成字符串 "true"，服务端会静默忽略）
        val task = mine!!
        assertEquals("任务标题应原样回读", marker, task.text)
        assertTrue(
            "longText 必须回读为 true —— 为 false 说明布尔被序列化成了字符串（服务端静默忽略）",
            task.longText,
        )
        assertEquals("长文本详情应原样回读", "线上联调详情", task.details)
        assertTrue(
            "reminderEnabled 必须回读为 true —— 同上",
            task.reminderEnabled,
        )
        assertEquals("reminderAt 应原样回读", "2026-12-31T00:00:00.000Z", task.reminderAt)

        // 5) 不该影响队列里原有的任务
        beforeIds.forEach { id ->
            assertTrue("原有任务 $id 不应消失", tasks.any { it.id == id })
        }

        // 6) 测试收尾：清掉**我们刚建的那一条**，避免在服务端留垃圾。
        //    ⚠️ 这一步是清理，不是被测行为 —— 手机端在真实使用中**绝不**这样做。
        val cleanup = repo.ack(listOf(taskId))
        assertTrue("清理应成功：$cleanup", cleanup is ApiResult.Ok)
        assertEquals(1, (cleanup as ApiResult.Ok).data.removed)

        // 7) 确认清理干净
        val final = repo.pull()
        val remaining = (final as ApiResult.Ok).data.tasks.map { it.id }
        assertTrue("清理后不应再有该任务", taskId !in remaining)
    }

    @Test
    fun `线上错误分支_空标题应回业务失败且 HTTP 为 200`() = runBlocking {
        requireCreds()

        // 契约 §5.1：空文本 → success:false（HTTP 仍是 200）
        val r = repository().push(text = "")
        assertTrue("应为业务失败：$r", r is ApiResult.BusinessFail)
        assertEquals("任务标题不能为空", (r as ApiResult.BusinessFail).message)
    }

    @Test
    fun `线上错误分支_board 非 taskwall 应回暂不支持`() = runBlocking {
        requireCreds()

        val client = ApiClient(
            identityProvider = FixedIdentity(
                Identity(bindId, mobileToken, "k".repeat(24), "d", "t"),
            ),
            errorMapper = ErrorMapper(),
            baseUrl = Endpoints.API,
            client = OkHttpClient(),
        )
        val r = client.post("push", mapOf("board" to "not-taskwall", "text" to "x"))
        assertTrue(r is ApiResult.BusinessFail)
        assertEquals("暂不支持的板块", (r as ApiResult.BusinessFail).message)
    }

    @Test
    fun `线上_board_list 应可调用`() = runBlocking {
        requireCreds()
        val r = repository().boards()
        assertTrue("board.list 应成功：$r", r is ApiResult.Ok)
    }
}
