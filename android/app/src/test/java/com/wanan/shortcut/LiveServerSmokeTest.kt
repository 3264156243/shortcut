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
 * 打真实服务端，覆盖 **绑定 → 建任务 → 拉取 → 确认消费 → 再拉取应为空** 全闭环。
 * 它填的正是"从没执行过真实网络路径"这个空白。
 *
 * ## 为什么默认跳过（`assumeTrue`）
 *
 * 它会**在服务端留下真实数据**、需要网络、且受服务端限流影响。
 * 因此不做成常规单测（否则 CI/离线环境会红），
 * 只在你显式提供测试绑定凭据时运行：
 *
 * ```powershell
 * # 先拿一个独立测试绑定（不要用真实绑定！）
 * curl -s -X POST https://shortcut.326415.xyz/sync/api.php \
 *   -H 'Content-Type: application/json' \
 *   -d '{"action":"bind.create","deviceName":"android-dev"}'
 * # 再用 code 换手机凭证，然后把两个值传进来：
 * .\gradlew.bat testDebugUnitTest --tests "*LiveServerSmokeTest*" `
 *   -Dsc.live.bindId=<bindId> -Dsc.live.mobileToken=<mobileToken>
 * ```
 *
 * ⚠️ 必须用**自建测试绑定**：`mobile.bind` 会**轮换**该设备的凭证，
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
            "未提供线上测试凭据，跳过（见本类注释的用法）",
            bindId.isNotBlank() && mobileToken.isNotBlank(),
        )
    }

    @Test
    fun `线上闭环_建任务_拉取_确认消费_再拉取为空`() = runBlocking {
        requireCreds()
        val repo = repository()

        // 1) 先记录拉取前的基线（可能非空，因为服务端队列是共享的）
        val before = repo.pull()
        assertTrue("pull 应成功：$before", before is ApiResult.Ok)
        val beforeIds = (before as ApiResult.Ok).data.tasks.map { it.id }.toSet()

        // 2) 下发一个带唯一标记的任务（longText + reminder 都开，验证严格布尔真的生效）
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

        val pushData = (pushed as ApiResult.Ok).data
        assertTrue("应返回 taskId", pushData.taskId.startsWith("rmt_"))

        // 3) 拉取，必须能看到刚推的任务，且长文本/提醒字段**原样回读**
        //    （这是"严格布尔真的生效"的实证 —— 若发成字符串 "true"，
        //     longText 会静默变 false，这里就会失败）
        val after = repo.pull()
        assertTrue("pull 应成功：$after", after is ApiResult.Ok)

        val tasks = (after as ApiResult.Ok).data.tasks
        val mine = tasks.firstOrNull { it.text == marker }
        assertTrue("刚 push 的任务必须能被 pull 到（说明队列链路通）", mine != null)

        val task = mine!!
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
        assertEquals("不该混入旧任务", beforeIds.count { id -> tasks.any { it.id == id } }, beforeIds.size)

        // 4) 只确认消费**我们自己**建的那条（不要动队列里别人的任务）
        val ack = repo.ack(listOf(task.id))
        assertTrue("ack 应成功：$ack", ack is ApiResult.Ok)
        assertEquals(1, (ack as ApiResult.Ok).data.removed)

        // 5) 再拉取，我们的任务必须消失
        val final = repo.pull()
        val remaining = (final as ApiResult.Ok).data.tasks.map { it.id }
        assertTrue("已消费的任务不应再出现", task.id !in remaining)
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

        // 直接构造一个 board 不对的请求，验证服务端确实按契约拒绝
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
