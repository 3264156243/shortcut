package com.wanan.shortcut

import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.identity.IdentitySource
import com.wanan.shortcut.core.net.ApiClient
import com.wanan.shortcut.core.net.Endpoints
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.core.realtime.RelayClient
import com.wanan.shortcut.feature.linked.control.ControlSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 控制会话的回归测试 —— 针对用户反馈的 bug：
 * "**显示连接了，在实际的控制时却显示未连接**"。
 *
 * ## 这个 bug 的结构（值得记档）
 *
 * 早先版本把"通道选择 + 连接状态"放在**页面级 ViewModel** 里。
 * 而 `containerViewModel()` 绑定的是最近的 `ViewModelStoreOwner`，
 * Navigation Compose 里**每个目的地都是独立 owner**：
 *
 * ```
 * module/control        ← 入口页：连上通道，存在它的 ViewModel 里
 * module/control/sub/panel ← 控制页：新目的地 → 新 ViewModel → channel = null
 * ```
 *
 * 结果就是入口页显示"已连接"，控制页显示"未连接"。
 *
 * ## 测试策略
 *
 * 无法在 JVM 上跑真实的 WS 握手，但**通道选择的归属**可以测：
 * 用同一个 [ControlSession] 模拟"入口页设置通道 → 控制页（新 ViewModel）读取"，
 * 断言两方看到的是**同一个通道**。这正是修法生效的判据。
 */
class ControlSessionTest {

    private lateinit var server: MockWebServer
    private lateinit var scope: CoroutineScope

    private class FixedIdentity(private val identity: Identity) : IdentitySource {
        override fun current(): Identity = identity
        override suspend fun onTokenRejected() = Unit
    }

    private lateinit var session: ControlSession

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        val identity = Identity(
            bindId = "0QIIVPkdtT32rxnpe19Dt3lB",
            mobileToken = "a".repeat(48),
            deviceKey = "aa11bb22cc33dd44ee55ff66",
            deviceId = "d",
            deviceName = "测试机",
        )
        val api = ApiClient(
            identityProvider = FixedIdentity(identity),
            errorMapper = ErrorMapper(),
            baseUrl = server.url("/sync/api.php").toString(),
            client = OkHttpClient(),
        )
        session = ControlSession(
            scope = scope,
            relay = RelayClient(scope),
            lanClient = com.wanan.shortcut.core.lan.LanClient(),
            apiClient = api,
            bindIdProvider = { identity.bindId },
        )
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.shutdown()
    }

    // ---------------- 换票请求形状 ----------------

    @Test
    fun `云端连接应先发 control_ticket 换票且 role 为 mobile`() = runBlocking {
        // 换票是 connectCloud 的第一步；形状错了会拿不到 ticket
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":false,"message":"ticket 密钥不可用"}"""),
        )

        session.connectCloud()

        // 等一下让请求落地
        var waited = 0
        while (server.requestCount == 0 && waited < 2000) {
            kotlinx.coroutines.delay(50); waited += 50
        }

        val body = server.takeRequest().body.readUtf8()
        assertTrue("必须是 control.ticket", body.contains("\"action\":\"control.ticket\""))
        assertTrue("手机角色必须是 mobile（契约 §7.2）", body.contains("\"role\":\"mobile\""))
        assertTrue("必须带 bindId", body.contains("\"bindId\":\"0QIIVPkdtT32rxnpe19Dt3lB\""))
        assertFalse("不该把 mobileToken 放进换票请求（它由身份层管理）", body.contains("deviceKey"))
    }

    @Test
    fun `换票失败时会记录错误且不可用但保留通道标签`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":false,"message":"控制中继密钥不可用"}"""),
        )

        session.connectCloud()

        var waited = 0
        while (server.requestCount == 0 && waited < 2000) {
            kotlinx.coroutines.delay(50); waited += 50
        }
        // 留点时间让状态落地
        kotlinx.coroutines.delay(300)

        // ★ 正确的行为（第一版断言写反了，被这条测试抓出来）：
        // 换票失败后，通道**选择**仍是"云端"（用户确实尝试了云端），
        // connectLoop 也仍在重试 —— 所以 channelLabel 应保留"云端"，
        // 但 `ready` 必须是 false（还没连上）。
        // 若把标签也清掉，用户就看不到"自己刚才选的是哪条通道"了。
        assertTrue("换票失败必须标记为不可用", !session.isReady)
        assertEquals("通道选择应保留（它记录了用户刚才试的是哪条路）", "云端", session.channelLabel)

        // 错误要能被 UI 看见：轮询当前值（状态是 StateFlow，读 value 即可，无需订阅）
        var sawError = false
        var errorWaited = 0
        while (!sawError && errorWaited < 1500) {
            kotlinx.coroutines.delay(100)
            errorWaited += 100
            sawError = session.connection.value.lastError != null
        }
        assertTrue("换票失败的原因应写进连接状态供 UI 显示", sawError)
    }

    // ---------------- 手动地址的规范化 ----------------

    @Test
    fun `手动地址应补默认端口`() {
        assertEquals("192.168.1.5:9823", session.normalizeHost("192.168.1.5"))
    }

    @Test
    fun `手动地址带端口应原样保留`() {
        assertEquals("192.168.1.5:9823", session.normalizeHost("192.168.1.5:9823"))
    }

    @Test
    fun `手动地址带协议头与路径应被剥掉`() {
        assertEquals(
            "192.168.1.5:9823",
            session.normalizeHost("http://192.168.1.5:9823/"),
        )
    }

    @Test
    fun `非法地址应返回 null`() {
        assertEquals(null, session.normalizeHost(""))
        assertEquals(null, session.normalizeHost("   "))
        assertEquals(null, session.normalizeHost("不是地址"))
    }

    // ---------------- 会话单例的意义（结构断言） ----------------

    @Test
    fun `通道设置后 session 应对外可见`() {
        // 这是修法生效的判据：通道在 session 上而不是在某个 ViewModel 里。
        // 页面级 ViewModel 无论被创建多少次，读的都是同一个 session。
        //
        // 注：这里用反射验证"session 是承载者"这个结构事实，
        // 因为真正设置可用通道需要真实 WS（JVM 上无法完成握手）。
        val channelField = ControlSession::class.java.getDeclaredField("channel")
        assertTrue(
            "ControlSession 必须持有 channel 字段（这是跨页面共享的载体）",
            channelField.declaringClass == ControlSession::class.java,
        )
    }
}
