package com.wanan.shortcut.core.prefs

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.prefsDataStore by preferencesDataStore(name = "shortcut_prefs_v1")

/** 主题模式（用户可在设置页选择）。 */
enum class ThemeMode {
    SYSTEM, LIGHT, DARK;

    companion object {
        fun fromName(name: String?): ThemeMode =
            entries.firstOrNull { it.name == name } ?: SYSTEM
    }
}

/** 界面偏好快照。 */
data class AppPrefs(
    /** 字体缩放倍率 */
    val fontScale: Float = FontScale.DEFAULT,
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    /**
     * 是否显示网格纹理背景（复刻 web 的 24px 网格）。
     *
     * 做成开关而不是写死：手机屏幕小、像素密度高，这层纹理在小屏上可能显脏。
     * 用户在真机上翻一下就能定，比在文档里争论强。
     */
    val gridTexture: Boolean = DEFAULT_GRID_TEXTURE,
) {
    companion object {
        /**
         * 默认开：与 web 保持一致（web 四个移动端页面都有这层纹理）。
         * 若实机观感不好，把这里改成 false 即可全局关闭。
         */
        const val DEFAULT_GRID_TEXTURE = true
    }
}

/** 字号档位。 */
object FontScale {
    const val MIN = 0.85f
    const val MAX = 1.30f
    const val DEFAULT = 1.0f

    val PRESETS = listOf(0.85f, 0.925f, 1.0f, 1.075f, 1.15f, 1.30f)
}

/**
 * 界面偏好存储（字号、主题）。
 *
 * 放在 `core/prefs` 而不是某个板块里，因为它是**跨板块的**：
 * 首页、设置页、每个板块页面都要读它。这正是框架该管的事。
 */
class AppPrefsStore(private val context: Context) {

    private object Keys {
        val FONT_SCALE = floatPreferencesKey("font_scale")
        val THEME = stringPreferencesKey("theme_mode")
        val GRID_TEXTURE = booleanPreferencesKey("grid_texture")
    }

    val flow: Flow<AppPrefs> = context.prefsDataStore.data.map { prefs ->
        AppPrefs(
            fontScale = (prefs[Keys.FONT_SCALE] ?: FontScale.DEFAULT)
                .coerceIn(FontScale.MIN, FontScale.MAX),
            themeMode = ThemeMode.fromName(prefs[Keys.THEME]),
            gridTexture = prefs[Keys.GRID_TEXTURE] ?: AppPrefs.DEFAULT_GRID_TEXTURE,
        )
    }

    suspend fun current(): AppPrefs = flow.first()

    suspend fun setFontScale(scale: Float) {
        context.prefsDataStore.edit {
            it[Keys.FONT_SCALE] = scale.coerceIn(FontScale.MIN, FontScale.MAX)
        }
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.prefsDataStore.edit { it[Keys.THEME] = mode.name }
    }

    suspend fun setGridTexture(enabled: Boolean) {
        context.prefsDataStore.edit { it[Keys.GRID_TEXTURE] = enabled }
    }
}
