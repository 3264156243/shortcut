package com.wanan.shortcut.feature.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.AppContainer
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.framework.HomeLayout
import com.wanan.shortcut.framework.HomeLayoutStore
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleEntry
import com.wanan.shortcut.framework.ModuleRegistry
import com.wanan.shortcut.framework.ModuleSection
import com.wanan.shortcut.ui.components.LoadingState
import com.wanan.shortcut.ui.containerViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 首页 ViewModel。
 *
 * 关键：模块列表是**三个来源合成**的结果（设计文档 §3.2）——
 * 本地注册表 + 服务端 `module.list`（仅联动板块）+ 用户布局覆盖。
 * 服务端加减模块、用户自定义排序，客户端渲染代码都不用改。
 */
class HomeViewModel(
    private val registry: ModuleRegistry,
    private val layoutStore: HomeLayoutStore,
    private val appVersion: String,
) : ViewModel() {

    private val _sections = MutableStateFlow<List<ModuleSection>>(emptyList())
    val sections: StateFlow<List<ModuleSection>> = _sections.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    /**
     * 刷新。
     *
     * @param bound 当前是否已绑定 —— 决定联动板块是否可进入（置灰与否）
     */
    fun refresh(bound: Boolean) {
        viewModelScope.launch {
            _loading.value = true

            // 布局覆盖层：当前恒为默认值，将来换成持久化实现即可
            val layout: HomeLayout = layoutStore.load()

            // 已绑定才需要拉服务端清单；未绑定时直接用本地兜底，省一次请求。
            // （服务端对未鉴权的 module.list 不报错，只是 bound:false。）
            val manifest = if (bound) {
                (registry.fetchManifest() as? ApiResult.Ok)?.data
            } else {
                null
            }

            val entries = registry.resolve(
                manifest = manifest,
                currentAppVersion = appVersion,
                layout = layout,
                bound = bound,
            )
            _sections.value = registry.group(entries)
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
        HomeViewModel(c.moduleRegistry, c.homeLayoutStore, com.wanan.shortcut.BuildConfig.VERSION_NAME)
    },
) {
    val sections by viewModel.sections.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()

    // 绑定状态变化时重新合成首页：未绑定→已绑定时，联动板块应从置灰变为可进入
    LaunchedEffect(identity.isBound) {
        viewModel.refresh(identity.isBound)
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Header(
            identity = identity,
            onOpenSettings = onOpenSettings,
            onGoBind = onGoBind,
        )

        if (loading && sections.isEmpty()) {
            LoadingState(Modifier.padding(top = 40.dp))
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                modifier = Modifier.fillMaxSize().padding(top = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                sections.forEach { section ->
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        SectionTitle(section.title)
                    }
                    items(section.entries, key = { it.module.spec.id }) { entry ->
                        ModuleTile(
                            entry = entry,
                            onClick = {
                                when {
                                    // 版本不够：已在磁贴上标注"需升级"，点击不进入
                                    entry.requiresUpgrade -> Unit

                                    // 联动板块未绑定 → 引导去绑定
                                    // （用户要求：显示但置灰，不隐藏，让人知道有这功能）
                                    entry.domain == ModuleDomain.LINKED && !entry.available ->
                                        onGoBind()

                                    else -> onOpenModule(entry.module.spec.id)
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Header(identity: Identity, onOpenSettings: () -> Unit, onGoBind: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text("ShortCut", style = MaterialTheme.typography.headlineSmall)
            Text(
                text = if (identity.isBound) "已连接 · ${identity.deviceName}" else "未连接电脑",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (!identity.isBound) {
                Text(
                    text = "去连接",
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable { onGoBind() }.padding(8.dp),
                )
            }
            Text(
                text = "设置",
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable { onOpenSettings() }.padding(8.dp),
            )
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
    )
}

/**
 * 单个板块图标（首页的主体形态 —— 用户要求"整体像一个导航页"）。
 *
 * 三种视觉状态：
 *   - 正常：可进入
 *   - **置灰**：联动板块未绑定 → 仍可点击，但点了是去绑定
 *     （不做成 disabled，否则用户不知道为什么点不动）
 *   - 需升级：版本不满足，副标题给出原因，点击不进入
 */
@Composable
private fun ModuleTile(entry: ModuleEntry, onClick: () -> Unit) {
    val dimmed = (entry.domain == ModuleDomain.LINKED && !entry.available) || entry.requiresUpgrade

    Card(
        modifier = Modifier.fillMaxWidth().clickable { onClick() },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp, horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // 用 alpha 表达"不可用"，而不是把图标藏起来
            Text(
                text = entry.icon,
                fontSize = 30.sp,
                modifier = Modifier.alpha(if (dimmed) 0.35f else 1f),
            )
            Text(
                text = entry.label,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.alpha(if (dimmed) 0.5f else 1f),
            )
            if (entry.requiresUpgrade) {
                Text(
                    text = "需升级",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                )
            } else if (entry.domain == ModuleDomain.LINKED && !entry.available) {
                Text(
                    text = "未连接",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
