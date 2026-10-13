package com.wanan.shortcut.ui.theme

import androidx.compose.ui.unit.dp

/**
 * 尺寸令牌（8dp 栅格）。
 *
 * 为什么必须收口：此前代码里出现过 `14.dp`、`18.dp`、`13.dp` 混用，
 * 间距不成体系是"看起来廉价"的主要来源之一（不是颜色问题，是韵律问题）。
 *
 * 规则：**所有间距必须是 4 的倍数**，且优先从下面取值，不写裸数字。
 * 验收时会 `grep` 检查是否存在非 4 倍数的 dp 字面量（见设计规范 §7）。
 */
object Spacing {
    /** 4dp：紧贴元素之间（图标与文字） */
    val xs = 4.dp

    /** 8dp：同组元素之间 */
    val sm = 8.dp

    /** 12dp：卡片内边距（web `.card` 用 14px，取 12 更贴 8 栅格） */
    val md = 12.dp

    /** 16dp：页面左右边距（web `.shell` 用 14–18px） */
    val lg = 16.dp

    /** 20dp：卡片内边距（宽松档，web `.card` 24px 与 14px 之间取中） */
    val xl = 20.dp

    /** 24dp：区块之间 */
    val xxl = 24.dp

    /** 32dp：大留白（空态、居中引导） */
    val huge = 32.dp
}

/** 组件尺寸令牌。 */
object Sizes {
    /** 触摸目标最小尺寸（Android 无障碍硬要求；此前返回按钮过小就是踩了这条） */
    val minTouchTarget = 48.dp

    /** 顶部栏高度 */
    val topBar = 56.dp

    /** 底部标签栏高度（M3 NavigationBar 规范 80dp） */
    val navigationBar = 80.dp

    /** 列表项左侧图标方块（web `.nav-ico` 是 46px/11px 圆角） */
    val listIcon = 46.dp

    /** 列表项最小高度 */
    val listRow = 64.dp

    /** 首页网格图标容器 */
    val gridIcon = 52.dp

    /** 空态图标 */
    val emptyIcon = 56.dp

    /** 状态圆点 */
    val statusDot = 8.dp

    /** 状态圆点的在线光晕外环 */
    val statusDotHalo = 4.dp
}

/** 圆角令牌（对齐 web：卡片 10–12px、按钮 8–10px、胶囊 999px）。 */
object Radii {
    /** 小控件（图标按钮、输入框） */
    val sm = 8.dp

    /** 卡片 */
    val md = 12.dp

    /** 大卡片 / 底部抽屉顶角 */
    val lg = 16.dp

    /** 胶囊（标签、状态 chip） */
    val pill = 999.dp
}

/**
 * 描边宽度。
 *
 * 深色主题里我们**用描边而非阴影**做层次（web 也是这么做的）：
 * 深色下阴影几乎不可见，反而会让卡面发灰。
 */
object Strokes {
    val hairline = 1.dp
    val emphasis = 2.dp
}
