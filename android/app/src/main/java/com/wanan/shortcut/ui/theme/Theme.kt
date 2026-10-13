package com.wanan.shortcut.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import com.wanan.shortcut.core.prefs.AppPrefs
import com.wanan.shortcut.core.prefs.FontScale
import com.wanan.shortcut.core.prefs.ThemeMode

/**
 * 主题。
 *
 * 两件事：
 *   1. 颜色方案（深/浅色；用户在设置页可选，默认跟随系统）
 *   2. **字号缩放**（用户点名要的设置项）—— 通过覆盖 `LocalDensity.fontScale` 实现，
 *      这样所有 Compose 文本一起缩放，不需要每个页面各自读设置
 */
private val ScBlue = Color(0xFF4C8DFF)
private val ScBackground = Color(0xFF0E1116)
private val ScSurface = Color(0xFF161B22)
private val ScOnBackground = Color(0xFFE6EDF3)

private val DarkColors = darkColorScheme(
    primary = ScBlue,
    onPrimary = Color.White,
    background = ScBackground,
    onBackground = ScOnBackground,
    surface = ScSurface,
    onSurface = ScOnBackground,
    surfaceVariant = Color(0xFF1F2630),
    onSurfaceVariant = Color(0xFF9BA7B4),
    error = Color(0xFFFF6B6B),
)

private val LightColors = lightColorScheme(
    primary = ScBlue,
    background = Color(0xFFF6F8FA),
    surface = Color.White,
    onBackground = Color(0xFF1F2328),
    onSurface = Color(0xFF1F2328),
    surfaceVariant = Color(0xFFEDEFF2),
    onSurfaceVariant = Color(0xFF5A6572),
    error = Color(0xFFCF222E),
)

/**
 * 应用主题。
 *
 * @param prefs 界面偏好（字号、主题模式）。由 `MainActivity` 从容器读取后传入，
 *              这样主题层不依赖 DI，便于预览与测试。
 */
@Composable
fun ShortCutTheme(
    prefs: AppPrefs = AppPrefs(),
    content: @Composable () -> Unit,
) {
    val dark = when (prefs.themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }

    // 字号缩放：覆盖 LocalDensity，使整个界面的文字一起缩放。
    // 不逐个页面传参，是因为"字号"是全局偏好，不该让每个页面自己处理。
    val base = LocalDensity.current
    val scaled = Density(
        density = base.density,
        fontScale = base.fontScale * prefs.fontScale.coerceIn(FontScale.MIN, FontScale.MAX),
    )

    CompositionLocalProvider(LocalDensity provides scaled) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            content = content,
        )
    }
}
