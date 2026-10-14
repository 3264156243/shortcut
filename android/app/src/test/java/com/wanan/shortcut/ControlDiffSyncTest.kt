package com.wanan.shortcut

import com.wanan.shortcut.feature.linked.control.SyncAction
import com.wanan.shortcut.feature.linked.control.TextDiffSync
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 差量文本同步测试（对齐 web `control/app/js/phone.js` 的 `syncFromBuffer()`）。
 *
 * ## 为什么这段最值得测
 *
 * 它决定"手机输入什么、电脑就出现什么"。算错的**表现**很隐蔽：
 * 电脑上的字莫名多几个或少几个、光标位置乱跳 —— 靠肉眼很难定位是算法问题。
 * 而它是纯逻辑，可以完整覆盖，所以这里把 web 的每个分支都固化成断言。
 */
class ControlDiffSyncTest {

    private fun types(actions: List<SyncAction>): List<String> =
        actions.filterIsInstance<SyncAction.TypeText>().map { it.text }

    private fun keys(actions: List<SyncAction>): List<String> =
        actions.filterIsInstance<SyncAction.PressKey>().map { it.key }

    // ---------------- 情况 B：尾部追加（最常见的输入路径） ----------------

    @Test
    fun `首次输入应把整段打过去`() {
        val sync = TextDiffSync()
        val actions = sync.onBufferChanged("你好")

        assertEquals(listOf("你好"), types(actions))
        assertTrue(keys(actions).isEmpty())
        assertEquals("你好", sync.sentSnapshot())
    }

    @Test
    fun `追加字符只应发送新增部分`() {
        // 这是这个算法存在的意义：不能每次输入都重发整段
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")
        val actions = sync.onBufferChanged("abcd")

        assertEquals("只应发新增的那个字符", listOf("d"), types(actions))
        assertEquals("abcd", sync.sentSnapshot())
    }

    @Test
    fun `连续追加应各自只发增量`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("a")
        assertEquals(listOf("b"), types(sync.onBufferChanged("ab")))
        assertEquals(listOf("c"), types(sync.onBufferChanged("abc")))
        assertEquals(listOf("d"), types(sync.onBufferChanged("abcd")))
    }

    // ---------------- 情况 A：删掉尾部（退格） ----------------

    @Test
    fun `删掉一个字符应发一次退格`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")
        val actions = sync.onBufferChanged("ab")

        assertEquals(listOf("backspace"), keys(actions))
        assertTrue(types(actions).isEmpty())
        assertEquals("ab", sync.sentSnapshot())
    }

    @Test
    fun `一次删掉多个字符应发对应次数的退格`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("abcdef")
        val actions = sync.onBufferChanged("abc")

        assertEquals("应发 3 次退格", listOf("backspace", "backspace", "backspace"), keys(actions))
    }

    @Test
    fun `全部删空应把已发内容全退掉`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")
        val actions = sync.onBufferChanged("")

        assertEquals(3, keys(actions).size)
        assertEquals("", sync.sentSnapshot())
    }

    // ---------------- 情况 C：中间分歧 ----------------

    @Test
    fun `中间修改应先退格再补新内容`() {
        // "abc" → "aXc"：公共前缀是 "a"，需退 2 格（b、c）再打 "Xc"
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")
        val actions = sync.onBufferChanged("aXc")

        assertEquals(listOf("backspace", "backspace"), keys(actions))
        assertEquals(listOf("Xc"), types(actions))
        assertEquals("aXc", sync.sentSnapshot())
    }

    @Test
    fun `全部替换应退掉全部再打新的`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")
        val actions = sync.onBufferChanged("xyz")

        assertEquals(3, keys(actions).size)
        assertEquals(listOf("xyz"), types(actions))
    }

    @Test
    fun `在中途插入应退格到插入点再补`() {
        // "ac" → "abc"：公共前缀 "a"，退 1 格（c），再打 "bc"
        val sync = TextDiffSync()
        sync.onBufferChanged("ac")
        val actions = sync.onBufferChanged("abc")

        assertEquals(1, keys(actions).size)
        assertEquals(listOf("bc"), types(actions))
    }

    // ---------------- 无变化 ----------------

    @Test
    fun `内容没变时不应产生任何指令`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")

        val actions = sync.onBufferChanged("abc")
        assertTrue("不该发出任何指令", actions.isEmpty())
    }

    @Test
    fun `空到空不应产生指令`() {
        val sync = TextDiffSync()
        assertTrue(sync.onBufferChanged("").isEmpty())
    }

    // ---------------- 退格按钮 ----------------

    @Test
    fun `退格按钮应发一次退格并缩短本地镜像`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")

        val actions = sync.onBackspace()
        assertEquals(listOf("backspace"), keys(actions))
        assertEquals("ab", sync.sentSnapshot())
    }

    @Test
    fun `空内容时退格仍应发指令`() {
        // web 的行为：即便本地缓冲为空也发退格（用户可能想删电脑上的字）
        val sync = TextDiffSync()
        val actions = sync.onBackspace()
        assertEquals(listOf("backspace"), keys(actions))
        assertEquals("", sync.sentSnapshot())
    }

    // ---------------- 清空（只清缓冲，不影响电脑） ----------------

    @Test
    fun `清空只清本地镜像不应发任何指令`() {
        // web 注释明确：「清空：只清缓冲，不影响电脑」
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")

        sync.onClear()
        assertEquals("", sync.sentSnapshot())
    }

    @Test
    fun `清空之后再输入应视为全新内容`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")
        sync.onClear()

        val actions = sync.onBufferChanged("xyz")
        assertEquals("应整段打过去，而不是算差量", listOf("xyz"), types(actions))
    }

    // ---------------- 输入法组合保护 ----------------

    @Test
    fun `组合输入期间不应产生任何同步指令`() {
        // 中文选字时若同步，会把拼音字母打到电脑上
        val sync = TextDiffSync()
        sync.onCompositionStart()
        assertTrue(sync.isComposing)

        // 模拟组合过程中的中间态：只更新缓冲，不同步
        sync.updateBufferWithoutSync("ni")
        sync.updateBufferWithoutSync("nihao")
        assertEquals("组合期间不该有任何已发内容", "", sync.sentSnapshot())
    }

    @Test
    fun `组合结束时应一次性同步最终文本`() {
        val sync = TextDiffSync()
        sync.onCompositionStart()
        sync.updateBufferWithoutSync("nihao")

        val actions = sync.onCompositionEnd("你好")
        assertFalse(sync.isComposing)
        assertEquals("应一次性打最终文本，而不是拼音", listOf("你好"), types(actions))
    }

    @Test
    fun `组合结束后的追加应正常增量`() {
        val sync = TextDiffSync()
        sync.onCompositionStart()
        sync.onCompositionEnd("你好")

        val actions = sync.onBufferChanged("你好世界")
        assertEquals(listOf("世界"), types(actions))
    }

    // ---------------- 重置 ----------------

    @Test
    fun `重置应清掉镜像与组合状态`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("abc")
        sync.onCompositionStart()

        sync.reset()
        assertEquals("", sync.sentSnapshot())
        assertFalse(sync.isComposing)
    }

    // ---------------- 多字符（emoji / 中文） ----------------

    @Test
    fun `中文与表情符号应按字符处理`() {
        val sync = TextDiffSync()
        sync.onBufferChanged("你好")
        assertEquals("世界", types(sync.onBufferChanged("你好世界")).first())

        // 单个 emoji 追加
        val sync2 = TextDiffSync()
        sync2.onBufferChanged("a")
        assertEquals("😀", types(sync2.onBufferChanged("a😀")).first())
    }

    @Test
    fun `重复字符的差量应正确`() {
        // "aaa" → "aaaa"：前缀是 3 个 a，应只发 1 个
        val sync = TextDiffSync()
        sync.onBufferChanged("aaa")
        assertEquals(listOf("a"), types(sync.onBufferChanged("aaaa")))

        // "aaaa" → "aaa"：应退 1 格
        assertEquals(listOf("backspace"), keys(sync.onBufferChanged("aaa")))
    }
}
