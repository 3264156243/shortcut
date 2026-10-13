package com.wanan.shortcut.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.AppContainer
import com.wanan.shortcut.BuildConfig
import com.wanan.shortcut.ShortcutApp
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.net.Protocol
import com.wanan.shortcut.core.prefs.AppPrefs
import com.wanan.shortcut.core.prefs.FontScale
import com.wanan.shortcut.core.prefs.ThemeMode
import com.wanan.shortcut.feature.home.HomeLayoutStyle
import com.wanan.shortcut.ui.components.InfoRow
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.components.SectionHeader
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.Spacing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 设置页 ViewModel（分片式，设计规范 §4）。
 */
class SettingsViewModel(private val container: AppContainer) : ViewModel() {

    private val _prefs = MutableStateFlow(AppPrefs())
    val prefs: StateFlow<AppPrefs> = _prefs.asStateFlow()

    private val _homeStyle = MutableStateFlow(HomeLayoutStyle.DEFAULT)
    val homeStyle: StateFlow<HomeLayoutStyle> = _homeStyle.asStateFlow()

    private val _cleared = MutableStateFlow(false)
    val cleared: StateFlow<Boolean> = _cleared.asStateFlow()

    init {
        viewModelScope.launch {
            _prefs.value = container.appPrefs.current()
            _homeStyle.value = container.homePrefs.currentStyle()
        }
    }

    fun setFontScale(scale: Float) {
        viewModelScope.launch {
            container.appPrefs.setFontScale(scale)
            _prefs.value = container.appPrefs.current()
        }
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch {
            container.appPrefs.setThemeMode(mode)
            _prefs.value = container.appPrefs.current()
        }
    }

    fun setHomeStyle(style: HomeLayoutStyle) {
        viewModelScope.launch {
            container.homePrefs.setStyle(style)
            _homeStyle.value = style
        }
    }

    fun setGridTexture(enabled: Boolean) {
        viewModelScope.launch {
            container.appPrefs.setGridTexture(enabled)
            _prefs.value = container.appPrefs.current()
        }
    }

    fun rename(name: String) {
        viewModelScope.launch { container.identityProvider.updateDeviceName(name.take(30)) }
    }

    /**
     * 解除绑定。
     *
     * ⚠️ 只清本地绑定信息，**保留 deviceKey**（见 IdentityStore.clearBinding 的注释）：
     * 否则用户重新绑定会新增设备条目，反复几次占满上限。
     */
    fun unbind(onDone: () -> Unit) {
        viewModelScope.launch {
            container.identityProvider.clear()
            onDone()
        }
    }

    fun clearLocalData() {
        viewModelScope.launch {
            container.clearLocalModuleData()
            _cleared.value = true
        }
    }
}

@Composable
fun SettingsScreen(
    identity: Identity,
    onUnbound: () -> Unit,
    viewModel: SettingsViewModel = containerViewModel { SettingsViewModel(it) },
) {
    val prefs by viewModel.prefs.collectAsStateWithLifecycle()
    val homeStyle by viewModel.homeStyle.collectAsStateWithLifecycle()
    val cleared by viewModel.cleared.collectAsStateWithLifecycle()
    var showUnbindDialog by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        AppearanceSection(
            prefs = prefs,
            homeStyle = homeStyle,
            onFontScale = viewModel::setFontScale,
            onTheme = viewModel::setThemeMode,
            onHomeStyle = viewModel::setHomeStyle,
            onGridTexture = viewModel::setGridTexture,
        )
        BindingSection(
            identity = identity,
            onRename = viewModel::rename,
            onUnbindRequest = { showUnbindDialog = true },
            onGoBind = onUnbound,
        )
        StorageSection(onClearLocalData = viewModel::clearLocalData, cleared = cleared)
        ModulesSection()
        AboutSection()
    }

    if (showUnbindDialog) {
        AlertDialog(
            onDismissRequest = { showUnbindDialog = false },
            title = { Text("断开连接") },
            text = { Text("断开后需要重新输入绑定码才能连接，确定吗？") },
            confirmButton = {
                TextButton(onClick = {
                    showUnbindDialog = false
                    viewModel.unbind { onUnbound() }
                }) { Text("断开") }
            },
            dismissButton = {
                TextButton(onClick = { showUnbindDialog = false }) { Text("取消") }
            },
        )
    }
}

// ---------------- 各分片 ----------------

/** 外观：字号、主题、首页形式、网格纹理。 */
@Composable
private fun AppearanceSection(
    prefs: AppPrefs,
    homeStyle: HomeLayoutStyle,
    onFontScale: (Float) -> Unit,
    onTheme: (ThemeMode) -> Unit,
    onHomeStyle: (HomeLayoutStyle) -> Unit,
    onGridTexture: (Boolean) -> Unit,
) {
    SectionHeader(title = SettingsSectionId.APPEARANCE.title)
    ScCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            // 字号
            SettingBlock(label = "文字大小") {
                SegmentedRow(
                    options = FontScale.PRESETS.map { scale ->
                        val name = when {
                            scale < 0.95f -> "小"
                            scale < 1.0f -> "较小"
                            scale == 1.0f -> "标准"
                            scale <= 1.1f -> "较大"
                            scale < 1.25f -> "大"
                            else -> "特大"
                        }
                        name to (kotlin.math.abs(scale - prefs.fontScale) < 0.001f)
                    },
                    onClick = { index -> onFontScale(FontScale.PRESETS[index]) },
                )
            }

            // 主题
            SettingBlock(label = "主题") {
                SegmentedRow(
                    options = ThemeMode.entries.map { mode ->
                        val label = when (mode) {
                            ThemeMode.SYSTEM -> "跟随系统"
                            ThemeMode.LIGHT -> "浅色"
                            ThemeMode.DARK -> "深色"
                        }
                        label to (prefs.themeMode == mode)
                    },
                    onClick = { index -> onTheme(ThemeMode.entries[index]) },
                )
            }

            // 首页形式（用户要求"后续能扩展很多形式"——这里先给两种可切换）
            SettingBlock(label = "首页板块形式") {
                SegmentedRow(
                    options = HomeLayoutStyle.entries.map { style ->
                        style.label to (homeStyle == style)
                    },
                    onClick = { index -> onHomeStyle(HomeLayoutStyle.entries[index]) },
                )
            }

            // 网格纹理背景：与 web 一致的那层 24px 细网格。
            // 做成开关是因为手机屏幕小，可能显脏 —— 真机上翻一下就知道。
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "网格纹理背景",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "与电脑端网页一致的细网格底纹",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                androidx.compose.material3.Switch(
                    checked = prefs.gridTexture,
                    onCheckedChange = onGridTexture,
                )
            }
        }
    }
}

/** 连接与设备（用户说的"绑定码"管理）。 */
@Composable
private fun BindingSection(
    identity: Identity,
    onRename: (String) -> Unit,
    onUnbindRequest: () -> Unit,
    onGoBind: () -> Unit,
) {
    var nameDraft by remember(identity.deviceName) { mutableStateOf(identity.deviceName) }

    SectionHeader(title = SettingsSectionId.BINDING.title)
    ScCard {
        if (!identity.isBound) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(
                    text = "尚未连接电脑",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "连接后可使用任务墙、文件共享、电脑控制等联动功能。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = onGoBind) { Text("去连接") }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                OutlinedTextField(
                    value = nameDraft,
                    onValueChange = { nameDraft = it.take(30) },
                    label = { Text("本机名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Button(onClick = { onRename(nameDraft) }) { Text("保存名称") }
                    TextButton(onClick = onUnbindRequest) {
                        Text("断开连接", color = MaterialTheme.colorScheme.error)
                    }
                }

                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(MaterialTheme.shapes.small)
                        .background(MaterialTheme.colorScheme.surfaceContainerLow)
                        .padding(Spacing.md),
                ) {
                    Column {
                        InfoRow("绑定码 ID", identity.bindId)
                        InfoRow("设备 ID", identity.deviceId.ifBlank { "—" })
                    }
                }
            }
        }
    }
}

/** 存储：缓存管理与占用。 */
@Composable
private fun StorageSection(onClearLocalData: () -> Unit, cleared: Boolean) {
    SectionHeader(title = SettingsSectionId.STORAGE.title)
    ScCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(
                text = "本机数据包括笔记等本机功能的内容，清除后无法恢复。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                TextButton(onClick = onClearLocalData) {
                    Text("清除本机数据", color = MaterialTheme.colorScheme.error)
                }
                if (cleared) {
                    Text(
                        text = "已清除",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

/**
 * 板块设置分片：遍历注册表，让**每个板块自己贡献**设置项。
 * 加一个带设置项的板块时本文件不用改。
 */
@Composable
private fun ModulesSection() {
    val container = (LocalContext.current.applicationContext as ShortcutApp).container
    val modules = remember { container.moduleRegistry.all() }

    SectionHeader(title = SettingsSectionId.MODULES.title)
    ScCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            modules.forEach { module -> module.SettingsSection() }
            Text(
                text = "各板块的设置项由板块自己提供（当前板块均未提供额外设置项）。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** 关于：版本、协议版本、包名。 */
@Composable
private fun AboutSection() {
    SectionHeader(title = SettingsSectionId.ABOUT.title)
    ScCard {
        Column {
            InfoRow("版本", BuildConfig.VERSION_NAME)
            // 契约 §1.2：服务端不校验协议版本，兼容由客户端自己判断；这里只展示不阻断
            InfoRow("协议版本", Protocol.VERSION.toString())
            InfoRow("包名", BuildConfig.APPLICATION_ID)
        }
    }
}

// ---------------- 通用小件 ----------------

/**
 * 设置块：上面一个标签，下面一组可选项。
 *
 * 抽出来是因为"字号/主题/首页形式"三者结构完全一样 —— 不抽就会复制三遍间距与样式。
 */
@Composable
private fun SettingBlock(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        content()
    }
}

/**
 * 分段选择行（复刻 web 的 `.type-switch` 思路）。
 *
 * 选中项用 primaryContainer 底 + 描边，未选中项用透明底 —— 比"只改文字颜色"明确得多。
 */
@Composable
private fun SegmentedRow(
    options: List<Pair<String, Boolean>>,
    onClick: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        options.forEachIndexed { index, (label, selected) ->
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(MaterialTheme.shapes.small)
                    .background(
                        if (selected) MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surfaceContainerHigh,
                    )
                    .clickable { onClick(index) }
                    .padding(vertical = Spacing.sm),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (selected) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    maxLines = 1,
                )
            }
        }
    }
}
