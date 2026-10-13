package com.wanan.shortcut.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import com.wanan.shortcut.core.prefs.AppPrefs
import com.wanan.shortcut.core.prefs.FontScale
import com.wanan.shortcut.core.prefs.ThemeMode

/**
 * ShortCut 主题。
 *
 * 三件事：
 *   1. 颜色（深/浅，见 [ShortCutDarkColors]）
 *   2. 字体（M3 字阶，见 [ShortCutTypography]）
 *   3. **字号缩放**（用户在设置页可调）—— 通过覆盖 `LocalDensity.fontScale`，
 *      整棵树一起缩放，不需要每个页面各自处理
 */
private val ShortCutShapes = Shapes(
    extraSmall = RoundedCornerShape(Radii.sm),
    small = RoundedCornerShape(Radii.sm),
    medium = RoundedCornerShape(Radii.md),
    large = RoundedCornerShape(Radii.lg),
    extraLarge = RoundedCornerShape(Radii.lg),
)

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

    val base = LocalDensity.current
    val scaled = Density(
        density = base.density,
        fontScale = base.fontScale * prefs.fontScale.coerceIn(FontScale.MIN, FontScale.MAX),
    )

    CompositionLocalProvider(LocalDensity provides scaled) {
        MaterialTheme(
            colorScheme = if (dark) ShortCutDarkColors else ShortCutLightColors,
            typography = ShortCutTypography,
            shapes = ShortCutShapes,
            content = content,
        )
    }
}

/** 当前是否深色主题（个别组件需要据此微调，例如网格纹理的透明度）。 */
val isDarkTheme: Boolean
    @Composable get() = MaterialTheme.colorScheme.background.luminance() < 0.5f

private fun androidx.compose.ui.graphics.Color.luminance(): Float =
    0.2126f * red + 0.7152f * green + 0.0722f * blue
