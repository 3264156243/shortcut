package com.wanan.shortcut.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * 主题。
 *
 * 颜色与 `res/values/colors.xml` 保持一致（启动窗口与 Compose 首帧不闪色）。
 * 首版只有中文、以深色为主（与桌面端 SC 球的深色观感统一）。
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
    error = Color(0xFFCF222E),
)

@Composable
fun ShortCutTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
