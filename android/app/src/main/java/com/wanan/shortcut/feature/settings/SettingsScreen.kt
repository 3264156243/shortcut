package com.wanan.shortcut.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
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
import com.wanan.shortcut.ui.containerViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 设置页 ViewModel（分片式，设计文档 §4）。
 *
 * 设置项按分片拆分，不写成一个巨型页面 —— 用户明确要求"可以长期扩展完善"。
 */
class SettingsViewModel(private val container: AppContainer) : ViewModel() {

    private val _prefs = MutableStateFlow(AppPrefs())
    val prefs: StateFlow<AppPrefs> = _prefs.asStateFlow()

    private val _cleared = MutableStateFlow(false)
    val cleared: StateFlow<Boolean> = _cleared.asStateFlow()

    init {
        viewModelScope.launch { _prefs.value = container.appPrefs.current() }
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

    fun rename(name: String) {
        viewModelScope.launch { container.identityProvider.updateDeviceName(name.take(30)) }
    }

    /**
     * 解除绑定。
     *
     * ⚠️ 只清本地绑定信息，**保留 deviceKey**（见 IdentityStore.clearBinding 的注释）：
     * 保留它，用户重新绑定才是"原地轮换"，不会在桌面设备列表里新增条目。
     */
    fun unbind(onDone: () -> Unit) {
        viewModelScope.launch {
            container.identityProvider.clear()
            onDone()
        }
    }

    /** 清除本机板块数据（存储分片）。 */
    fun clearLocalData() {
        viewModelScope.launch {
            container.clearLocalModuleData()
            _cleared.value = true
        }
    }
}

/**
 * 设置页。
 *
 * 分片顺序与 [SettingsSectionId] 一致；每个分片是一个独立 Composable，
 * 加分类时只加一个 `SettingsXxxSection()` 并在这里加一行 —— 不动其它分片。
 */
@Composable
fun SettingsScreen(
    identity: Identity,
    onUnbound: () -> Unit,
    viewModel: SettingsViewModel = containerViewModel { SettingsViewModel(it) },
) {
    val prefs by viewModel.prefs.collectAsStateWithLifecycle()
    val cleared by viewModel.cleared.collectAsStateWithLifecycle()
    var showUnbindDialog by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("设置", style = MaterialTheme.typography.headlineSmall)

        AppearanceSection(
            prefs = prefs,
            onFontScale = viewModel::setFontScale,
            onTheme = viewModel::setThemeMode,
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

/** 外观：字号、主题（用户明确点名的两项）。 */
@Composable
private fun AppearanceSection(
    prefs: AppPrefs,
    onFontScale: (Float) -> Unit,
    onTheme: (ThemeMode) -> Unit,
) {
    val labels = listOf("小", "较小", "标准", "较大", "大", "特大")

    SectionCard(SettingsSectionId.APPEARANCE.title) {
        Text("文字大小", style = MaterialTheme.typography.bodyMedium)
        Row(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            FontScale.PRESETS.forEachIndexed { index, scale ->
                val selected = kotlin.math.abs(scale - prefs.fontScale) < 0.001f
                Text(
                    text = labels.getOrElse(index) { "标准" },
                    color = if (selected) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.clickable { onFontScale(scale) }.padding(6.dp),
                )
            }
        }

        Text(
            text = "主题",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 12.dp),
        )
        Row(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ThemeMode.entries.forEach { mode ->
                val label = when (mode) {
                    ThemeMode.SYSTEM -> "跟随系统"
                    ThemeMode.LIGHT -> "浅色"
                    ThemeMode.DARK -> "深色"
                }
                Text(
                    text = label,
                    color = if (prefs.themeMode == mode) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.clickable { onTheme(mode) }.padding(6.dp),
                )
            }
        }
    }
}

/**
 * 连接与设备（用户说的"绑定码"管理）。
 *
 * 未绑定时显示"去连接"，而不是把整个分片藏起来 —— 用户得知道这里有东西。
 */
@Composable
private fun BindingSection(
    identity: Identity,
    onRename: (String) -> Unit,
    onUnbindRequest: () -> Unit,
    onGoBind: () -> Unit,
) {
    var nameDraft by remember(identity.deviceName) { mutableStateOf(identity.deviceName) }

    SectionCard(SettingsSectionId.BINDING.title) {
        if (!identity.isBound) {
            Text(
                text = "尚未连接电脑",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = onGoBind) { Text("去连接（输入绑定码）") }
        } else {
            OutlinedTextField(
                value = nameDraft,
                onValueChange = { nameDraft = it.take(30) },
                label = { Text("本机名称") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            TextButton(onClick = { onRename(nameDraft) }) { Text("保存名称") }

            InfoRow("绑定码 ID", identity.bindId)
            InfoRow("设备 ID", identity.deviceId.ifBlank { "—" })

            TextButton(onClick = onUnbindRequest) {
                Text("断开连接", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/** 存储：缓存管理与占用（用户点名要的）。 */
@Composable
private fun StorageSection(onClearLocalData: () -> Unit, cleared: Boolean) {
    SectionCard(SettingsSectionId.STORAGE.title) {
        Text(
            text = "本机数据包括笔记等本机功能的内容，清除后无法恢复。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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

/**
 * 板块设置分片。
 *
 * 这里遍历注册表，让**每个板块自己贡献**设置项（`SettingsSection()`）。
 * 加一个带设置项的板块时，**本文件不用改** —— 这就是分片设计的价值。
 */
@Composable
private fun ModulesSection() {
    val container = (LocalContext.current.applicationContext as ShortcutApp).container
    val modules = remember { container.moduleRegistry.all() }

    SectionCard(SettingsSectionId.MODULES.title) {
        modules.forEach { module ->
            // 板块自己决定是否渲染内容；默认实现为空 → 不占空间
            module.SettingsSection()
        }
        Text(
            text = "各板块的设置项由板块自己提供（当前板块均未提供额外设置项）。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** 关于：版本、协议版本、包名。 */
@Composable
private fun AboutSection() {
    SectionCard(SettingsSectionId.ABOUT.title) {
        InfoRow("版本", BuildConfig.VERSION_NAME)
        // 契约 §1.2：服务端不校验协议版本，兼容由客户端自己判断。
        // 这里只展示，不做阻断。
        InfoRow("协议版本", Protocol.VERSION.toString())
        InfoRow("包名", BuildConfig.APPLICATION_ID)
    }
}

// ---------------- 通用小件 ----------------

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            content()
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}
