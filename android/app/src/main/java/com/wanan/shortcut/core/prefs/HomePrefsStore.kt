package com.wanan.shortcut.core.prefs

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.wanan.shortcut.feature.home.HomeLayoutStyle
import kotlinx.coroutines.flow.first

private val Context.homePrefsDataStore by preferencesDataStore(name = "shortcut_home_prefs_v1")

/**
 * 首页偏好（形式等）。
 *
 * 与 [AppPrefsStore]（字号/主题）分开，是因为这个文件的关注点是**首页呈现**，
 * 将来首页还会加"排序方式""每行个数""是否显示描述"等，都会堆在这里。
 */
class HomePrefsStore(private val context: Context) {

    private object Keys {
        val STYLE = stringPreferencesKey("home_layout_style")
    }

    suspend fun currentStyle(): HomeLayoutStyle {
        val name = context.homePrefsDataStore.data.first()[Keys.STYLE]
        return HomeLayoutStyle.fromName(name)
    }

    suspend fun setStyle(style: HomeLayoutStyle) {
        context.homePrefsDataStore.edit { it[Keys.STYLE] = style.name }
    }
}
