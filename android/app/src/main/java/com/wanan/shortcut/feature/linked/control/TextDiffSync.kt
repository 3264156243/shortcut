package com.wanan.shortcut.feature.linked.control

/**
 * 差量同步要执行的一个动作。
 */
sealed interface SyncAction {
    /** 把 [text] 打到电脑光标处（`/api/type`） */
    data class TypeText(val text: String) : SyncAction

    /** 按一个键（`/api/key`），主要用于退格 */
    data class PressKey(val key: String) : SyncAction
}

/**
 * 差量文本同步器 —— 逐字对齐 web 的 `syncFromBuffer()`。
 *
 * ## 它在解决什么问题
 *
 * 手机输入区与电脑光标之间，**不能每次输入都把整段文本重发**：
 * 那样既慢，又会在电脑上重复输入（因为电脑端是"追加"语义）。
 * 正确做法是只发**差量**。
 *
 * ## 算法（与 web 一致）
 *
 * 取 `buffer`（现在的输入区）与 `sent`（电脑上已有的内容）的最长公共前缀 `i`：
 *
 * | 情况 | 动作 |
 * |---|---|
 * | `buffer == sent` | 无事可做 |
 * | `buffer` 是 `sent` 的前缀且更短（用户删了尾部） | 退格 `sent.length - buffer.length` 次 |
 * | `sent` 是 `buffer` 的前缀且更长（用户追加） | `type` 新增部分 |
 * | 前缀后有分歧（中间改了） | 先退格 `sent.length - i` 次，再 `type` `buffer[i..]` |
 *
 * ## 为什么把它独立成类
 *
 * 这段是**纯逻辑**，不碰 Android、不碰网络，因此可以完整覆盖单元测试
 * （见 `ControlDiffSyncTest`）。而它恰恰是最容易写错的部分 ——
 * 差量算错会表现为"电脑上的字莫名多出几个或少掉几个"，很难靠肉眼定位。
 */
class TextDiffSync {

    /** 电脑端当前已有的内容（本地镜像） */
    private var sent: String = ""

    /** 输入法正在组合输入（中文选字中）——此时**不能**同步，否则会把拼音打到电脑上 */
    var isComposing: Boolean = false
        private set

    fun onCompositionStart() {
        isComposing = true
    }

    /** 组合结束：**用最终文本同步一次**（web 在 compositionend 里调 syncFromBuffer） */
    fun onCompositionEnd(buffer: String): List<SyncAction> {
        isComposing = false
        return onBufferChanged(buffer)
    }

    /** 当前"电脑上已有的内容"（供 UI 显示 `已同步 N`，以及测试断言） */
    fun sentSnapshot(): String = sent

    /**
     * 输入法组合中更新缓冲：**只记本地，不发指令**。
     *
     * 之所以要记：组合结束后 [onCompositionEnd] 会拿到完整文本再算差量，
     * 不需要中间态。但 UI 的 buffer 是它自己的状态，这里不做缓存也没问题 ——
     * 保留这个方法是为了语义清晰（明确表达"组合中不同步"）。
     */
    fun updateBufferWithoutSync(@Suppress("UNUSED_PARAMETER") buffer: String) {
        // 有意为空：组合期间不同步。
    }

    /**
     * 缓冲变化 → 产出要执行的动作序列。
     *
     * 返回空列表表示"无需任何动作"。
     */
    fun onBufferChanged(buffer: String): List<SyncAction> {
        if (buffer == sent) return emptyList()

        // 找最长公共前缀
        var i = 0
        val min = minOf(buffer.length, sent.length)
        while (i < min && buffer[i] == sent[i]) i++

        // 情况 A：用户删掉了尾部（buffer 是 sent 的前缀）
        if (i == buffer.length && buffer.length < sent.length && sent.startsWith(buffer)) {
            val n = sent.length - buffer.length
            sent = buffer
            return List(n) { SyncAction.PressKey("backspace") }
        }

        // 情况 B：用户只在尾部追加（sent 是 buffer 的前缀）
        if (i == sent.length && buffer.length > sent.length) {
            val appended = buffer.substring(sent.length)
            sent = buffer
            return listOf(SyncAction.TypeText(appended))
        }

        // 情况 C：中间有分歧 —— 先退格到公共前缀，再打新内容
        val backspaces = sent.length - i
        val inserted = buffer.substring(i)
        sent = buffer

        return buildList {
            repeat(backspaces) { add(SyncAction.PressKey("backspace")) }
            if (inserted.isNotEmpty()) add(SyncAction.TypeText(inserted))
        }
    }

    /**
     * 退格按钮。
     *
     * ⚠️ 与 web 的 `btnBs` 行为一致，但要注意 web 那段代码有个细节：
     * 它**先发退格**，然后仅在 `kb.value === sent`（UI 缓冲与已发内容一致）时
     * 才同步缩短本地缓冲；否则只缩 `sent`。
     * 这里由 [onBackspace] 统一处理：直接对 `sent` 退一格并返回一次退格指令。
     */
    fun onBackspace(): List<SyncAction> {
        if (sent.isEmpty()) return listOf(SyncAction.PressKey("backspace"))
        sent = sent.dropLast(1)
        return listOf(SyncAction.PressKey("backspace"))
    }

    /**
     * 清空：**只清本地缓冲，不影响电脑**。
     *
     * 这是 web 明确标注的行为（其注释原文是"清空：只清缓冲，不影响电脑"）——
     * 用户可能只是想重新输入，而不是要清掉电脑上已经打好的字。
     * 所以这里把 `sent` 也置空，表示"从现在起不再追踪之前的差异"。
     */
    fun onClear() {
        sent = ""
    }

    /** 重置（例如切换通道/重连后） */
    fun reset() {
        sent = ""
        isComposing = false
    }
}
