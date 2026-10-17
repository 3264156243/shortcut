package com.wanan.shortcut

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 输入法组合状态（`TextFieldValue.composition`）的判据测试。
 *
 * ## 为什么这段必须单独测
 *
 * "打字没同步"这个问题我改过一次：从启发式猜，改成用 `composition` 精确判断。
 * 但如果**判据本身写反了**（比如把"非 collapsed"当成"没在组合"），
 * 表现同样是"打字没反应" —— 而且看起来代码是对的。
 *
 * 所以这里把 `TextFieldValue` 在三种真实状态下的 `composition` 值固化下来：
 *
 * | 状态 | composition | 应当同步吗 |
 * |---|---|---|
 * | 纯英文输入完 | `null` | ✅ 同步 |
 * | 拼音选字中（如输入 `nihao` 未选字） | 非 null，非 collapsed | ❌ 不同步 |
 * | 选字完成（"你好"已上屏） | `null`（或 collapsed） | ✅ 同步 |
 *
 * 这份测试的价值在于：它**不依赖真机**也能固定"什么情况下该同步"，
 * 而真机上只需要确认输入法确实产生了这些状态即可。
 */
class ComposingStateTest {

    /** 与 InputPadSection 里完全一致的判据 */
    private fun isComposing(value: TextFieldValue): Boolean =
        value.composition?.let { !it.collapsed } ?: false

    @Test
    fun `英文输入完成时 composition 为 null 应判为不在组合`() {
        val value = TextFieldValue(text = "hello")
        assertNull("纯文本没有组合区间", value.composition)
        assertFalse("★ 不在组合 → 必须同步，否则英文也打不出去", isComposing(value))
    }

    @Test
    fun `拼音输入中 composition 非空应判为在组合`() {
        // 模拟输入法正在组合 "nihao"（尚未选字上屏）
        val value = TextFieldValue(
            text = "nihao",
            composition = TextRange(0, 5),
        )
        assertNotNull("组合区间应存在", value.composition)
        assertTrue("★ 在组合 → 不同步，否则会把拼音打到电脑上", isComposing(value))
    }

    @Test
    fun `选字完成 composition 回到 null 应判为不在组合`() {
        val value = TextFieldValue(
            text = "你好",
            composition = null,
        )
        assertFalse("★ 选字完成 → 必须同步中文", isComposing(value))
    }

    @Test
    fun `collapsed 的 composition 应判为不在组合`() {
        // 光标位置（start == end）不是"正在组合的范围"
        val value = TextFieldValue(
            text = "abc",
            composition = TextRange(1, 1),
        )
        assertTrue("前提：这是 collapsed", value.composition!!.collapsed)
        assertFalse("collapsed 不算在组合", isComposing(value))
    }

    @Test
    fun `模拟一次完整的中文输入过程`() {
        // 这是用户真实会经历的序列：拼音 → 选字 → 上屏
        val steps = listOf(
            // 1) 打拼音，输入法显示组合区
            TextFieldValue(text = "ni", composition = TextRange(0, 2)) to true,
            TextFieldValue(text = "nihao", composition = TextRange(0, 5)) to true,
            // 2) 选字上屏，组合区消失
            TextFieldValue(text = "你好", composition = null) to false,
        )

        steps.forEachIndexed { i, (value, shouldCompose) ->
            assertEquals(
                "第 ${i + 1} 步（text=${value.text}）的组合判定应为 $shouldCompose",
                shouldCompose,
                isComposing(value),
            )
        }
    }

    @Test
    fun `空输入不应被判为组合`() {
        assertFalse(isComposing(TextFieldValue("")))
    }
}
