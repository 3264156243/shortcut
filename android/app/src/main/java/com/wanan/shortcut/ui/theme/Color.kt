package com.wanan.shortcut.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * 颜色令牌。
 *
 * ## 取色来源（不是我自己配的）
 *
 * 对 `server/sync/web/` 下四个移动端页面的全部色值做频次统计后得出主色：
 * 暖白 `#f6efe5`、底色 `#26231f`、砖红强调 `#9f493a`、卡片面 `#33302c`、次级文字 `#aaa198`。
 *
 * ⚠️ 此前的版本用了自创的冷蓝 `#4C8DFF` + 冷黑 `#0E1116`，
 * 与 ShortCut 既有视觉（暖褐 + 砖红）完全不同 —— 这是"看起来不像这个软件"的直接原因。
 *
 * ## 为什么映射到 M3 语义色位，而不是定义一堆 ScColor 常量到处用
 *
 * 直接用常量会绕开 Material 3 的深浅色机制（组件内部都按 colorScheme 取色，
 * 例如 Card 的默认底色是 `surfaceContainerLow`）。
 * 把品牌色**填进语义槽位**之后，所有 M3 组件自动获得一致的观感，
 * 切换深浅色也只需换一套 scheme。
 */

// ---- 品牌原始色（只在本文件出现；其它任何地方必须通过 MaterialTheme.colorScheme 取色）----

/** 页面底色（web 用 #24221f / #26231f，取后者） */
private val WarmBg = Color(0xFF26231F)

/** 主文字：暖白 */
private val WarmInk = Color(0xFFF6EFE5)

/** 顶栏 / 输入条面 */
private val WarmSurface = Color(0xFF2C2925)

/** 卡片面 */
private val WarmCard = Color(0xFF33302C)

/** 次级面 / 次级按钮 / 输入框底 */
private val WarmCardHigh = Color(0xFF3A3631)

/** 分组底 / 更浅一档的容器 */
private val WarmSurfaceVariant = Color(0xFF36322D)

/** 次级文字 */
private val WarmMuted = Color(0xFFAAA198)

/** 更弱的说明文字 */
private val WarmMutedDim = Color(0xFF8F877E)

/** 强调色：砖红（web 全站主按钮） */
private val Brick = Color(0xFF9F493A)

/** 危险/错误：暖红（web `.danger` 文字色 #e5a19a） */
private val WarmDanger = Color(0xFFE5A19A)

/** 危险按钮底（web `.danger` 背景 #3a2b29） */
private val WarmDangerContainer = Color(0xFF3A2B29)

/** 成功/在线：暖绿（web `.chip.colored` / 状态点） */
private val WarmOk = Color(0xFF8AC49F)

/** 在线圆点的绿（web `.status.connected .status-dot`） */
private val OnlineDot = Color(0xFF63B582)

/** 描边：web 全站统一是白色低透明，不是实色 */
private val OutlineSoft = Color(0x1FFFFFFF)      // rgba(255,255,255,.12)
private val OutlineSofter = Color(0x17FFFFFF)    // rgba(255,255,255,.09)

/**
 * 深色配色（本轮打磨重点）。
 *
 * 注意 [darkColorScheme] 的 `surfaceContainer*` 系列是 M3 的"色调层级"，
 * 用它做卡片/浮层的层次感，比堆 elevation 阴影更适合深色主题
 * （深色下阴影几乎看不见，还会让面发灰）。
 */
val ShortCutDarkColors = darkColorScheme(
    // 主操作：砖红
    primary = Brick,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF4A2B25),
    onPrimaryContainer = Color(0xFFF3D9D4),

    // 次要操作：暖灰面
    secondary = WarmCardHigh,
    onSecondary = WarmInk,
    secondaryContainer = WarmCard,
    onSecondaryContainer = WarmInk,

    // 成功/在线一类信息
    tertiary = WarmOk,
    onTertiary = Color(0xFF17281D),

    background = WarmBg,
    onBackground = WarmInk,

    surface = WarmSurface,
    onSurface = WarmInk,

    // 色调层级：由低到高，用于分别表达"页面底 → 卡片 → 抬起的元素"
    surfaceContainerLowest = Color(0xFF1E1C19),
    surfaceContainerLow = WarmSurface,
    surfaceContainer = WarmCard,
    surfaceContainerHigh = WarmCardHigh,
    surfaceContainerHighest = Color(0xFF423E38),

    surfaceVariant = WarmSurfaceVariant,
    onSurfaceVariant = WarmMuted,

    // 描边：web 的卡片描边就是这个观感
    outline = OutlineSoft,
    outlineVariant = OutlineSofter,

    error = WarmDanger,
    onError = Color(0xFF3A1D19),
    errorContainer = WarmDangerContainer,
    onErrorContainer = WarmDanger,

    scrim = Color(0xCC000000),
)

/**
 * 浅色配色。
 *
 * 本轮**不是打磨重点**（web 也只有深色为主），但必须可用、不刺眼：
 * 沿用桌面端 `[data-theme="light"]` 的思路（浅灰底 + 深字 + 暖橙强调）。
 */
val ShortCutLightColors = lightColorScheme(
    primary = Color(0xFF8C3E32),          // 砖红在浅底上要压深一点才够对比
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF6DFDA),
    onPrimaryContainer = Color(0xFF3A1D19),

    secondary = Color(0xFFEDE9E3),
    onSecondary = Color(0xFF2B2823),
    secondaryContainer = Color(0xFFF3F0EB),
    onSecondaryContainer = Color(0xFF2B2823),

    tertiary = Color(0xFF2F6B45),
    onTertiary = Color.White,

    background = Color(0xFFF7F6F4),
    onBackground = Color(0xFF23211E),

    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF23211E),

    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFAF9F7),
    surfaceContainer = Color(0xFFF3F1ED),
    surfaceContainerHigh = Color(0xFFEDEAE5),
    surfaceContainerHighest = Color(0xFFE6E2DC),

    surfaceVariant = Color(0xFFF0EDE8),
    onSurfaceVariant = Color(0xFF5F5A52),

    outline = Color(0x1F000000),
    outlineVariant = Color(0x14000000),

    error = Color(0xFFA23932),
    onError = Color.White,
    errorContainer = Color(0xFFF7E3E0),
    onErrorContainer = Color(0xFF7A2A24),
)

/** 在线/离线状态点用的颜色（web 里是绿点带光晕 / 灰点）。 */
object StatusColors {
    val online = OnlineDot
    val offline = WarmMutedDim
}
