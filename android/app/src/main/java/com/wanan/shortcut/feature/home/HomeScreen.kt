package com.wanan.shortcut.feature.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.AppContainer
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.framework.ModuleEntry
import com.wanan.shortcut.framework.ModuleRegistry
import com.wanan.shortcut.ui.components.LoadingState
import com.wanan.shortcut.ui.containerViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 首页 ViewModel。
 *
 * 关键设计：**模块列表来自服务端 `module.list`**（契约 §4.1），不是本地硬编码。
 * 服务端加/减模块、临时关闭某板块，客户端零改动即可反映。
 *
 * 拉取失败时降级为本地注册表（见 [ModuleRegistry.resolve]），保证断网也有入口。
 */
class HomeViewModel(
    private val registry: ModuleRegistry,
    private val appVersion: String,
) : ViewModel() {

    private val _entries = MutableStateFlow<List<ModuleEntry>>(emptyList())
    val entries: StateFlow<List<ModuleEntry>> = _entries.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _loading.value = true
            val manifest = registry.fetchManifest().let {
                (it as? com.wanan.shortcut.core.result.ApiResult.Ok)?.data
            }
            // manifest 为 null（网络失败）时 resolve 会降级为本地全量
            _entries.value = registry.resolve(manifest, appVersion)
            _loading.value = false
        }
    }
}

@Composable
fun HomeScreen(
    identity: Identity,
    onOpenModule: (String) -> Unit,
    onOpenSettings: () -> Unit,
    onGoBind: () -> Unit,
    viewModel: HomeViewModel = containerViewModel { c: AppContainer ->
        HomeViewModel(c.moduleRegistry, com.wanan.shortcut.BuildConfig.VERSION_NAME)
    },
) {
    val entries by viewModel.entries.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()

    // 已绑定时刷新（绑定后模块的 bound 态会变）
    LaunchedEffect(identity.bindId) {
        if (identity.isBound) viewModel.refresh()
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("ShortCut", style = MaterialTheme.typography.headlineSmall)
                Text(
                    text = if (identity.isBound) {
                        "已连接 · ${identity.deviceName}"
                    } else {
                        "未连接电脑"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!identity.isBound) {
                Text(
                    text = "去连接",
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable { onGoBind() }.padding(8.dp),
                )
            } else {
                Text(
                    text = "设置",
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable { onOpenSettings() }.padding(8.dp),
                )
            }
        }

        if (loading && entries.isEmpty()) {
            LoadingState(Modifier.padding(top = 40.dp))
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(entries, key = { it.module.id }) { entry ->
                    ModuleCard(entry = entry, onClick = { onOpenModule(entry.module.id) })
                }
            }
        }
    }
}

/**
 * 模块卡片。
 *
 * 图标/标题/描述全部来自 [ModuleEntry]，即"服务端优先、本地兜底"。
 * 版本不满足时不禁用入口，而是标注"需升级"——直接隐藏会让用户以为功能消失了。
 */
@Composable
private fun ModuleCard(entry: ModuleEntry, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = !entry.requiresUpgrade) { onClick() },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(text = entry.icon, fontSize = 26.sp)
            Column(Modifier.weight(1f)) {
                Text(text = entry.label, style = MaterialTheme.typography.titleMedium)
                Text(
                    text = if (entry.requiresUpgrade) "客户端版本过低，请升级后使用" else entry.desc,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (entry.requiresUpgrade) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
    }
}
