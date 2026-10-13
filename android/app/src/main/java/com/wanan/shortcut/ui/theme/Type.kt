package com.wanan.shortcut.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * 字体令牌（Material 3 字阶）。
 *
 * ## 为什么收口到 M3 字阶
 *
 * 此前代码里直接写 `fontSize = 30.sp`（首页 emoji）、`headlineSmall`、`titleLarge` 混用，
 * 没有字阶概念。M3 的字阶自带**字号 + 行高 + 字重**三者的协调关系，
 * 只用字号会出现"字大了但行距没跟上"的局促感 —— 这是廉价感的常见来源。
 *
 * 字号对照（web 实际用的 px → M3 槽位）：
 * | web | M3 槽位 |
 * |---|---|
 * | h1 18–22px | `titleLarge` 22sp |
 * | 卡片标题 16px | `titleMedium` 16sp |
 * | 正文 14px | `bodyMedium` 14sp |
 * | 说明 12px | `bodySmall` 12sp |
 * | 胶囊 11px | `labelSmall` 11sp |
 */
private val Default = Typography()

/**
 * ShortCut 字体。
 *
 * 目前**只覆盖字重**，字号/行高沿用 M3 默认 —— 因为 M3 默认值已经很协调，
 * 乱改字号会破坏配套的行高。
 *
 * 中文字体不指定 `FontFamily`：交给系统（ColorOS 上会用系统中文体，
 * 强行指定字体文件会增加包体且未必更好看）。
 */
val ShortCutTypography = Typography(
    // 页面主标题：加粗一点，让它"立得住"
    titleLarge = Default.titleLarge.copy(fontWeight = FontWeight.SemiBold),

    // 卡片/列表主标题：这是用户看得最多的层级
    titleMedium = Default.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    titleSmall = Default.titleSmall.copy(fontWeight = FontWeight.SemiBold),

    // 正文：默认字重，避免整屏都粗
    bodyLarge = Default.bodyLarge,
    bodyMedium = Default.bodyMedium,
    bodySmall = Default.bodySmall,

    // 分组标题/胶囊文字：中等偏粗，用于"分区感"
    labelLarge = Default.labelLarge.copy(fontWeight = FontWeight.SemiBold),
    labelMedium = Default.labelMedium,
    labelSmall = Default.labelSmall,

    // 按钮文字
    // （M3 的按钮用 labelLarge，已在上面覆盖）
)

/**
 * 图标尺寸令牌。
 *
 * ⚠️ 单独定义的原因：emoji 图标此前用 `fontSize = 30.sp` 表达，
 * 那是"借用文字字号"，语义上不对，也不好统一调整。
 */
object IconSizes {
    /** 首页网格图标 */
    val grid = 26.sp

    /** 列表项图标 */
    val list = 22.sp

    /** 顶部栏图标 */
    val topBar = 20.sp

    /** 空态插图 */
    val empty = 40.sp
}

/** 供需要显式行高的少量场景使用（例如便签式文本） */
val RelaxedLineHeight: TextStyle = Default.bodyMedium.copy(lineHeight = 22.sp)
