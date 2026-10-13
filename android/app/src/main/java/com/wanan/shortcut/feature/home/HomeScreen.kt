package com.wanan.shortcut.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.AppContainer
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.prefs.HomePrefsStore
import com.wanan.shortcut.core.result.ApiResult
import com.wanan.shortcut.framework.ModuleDomain
import com.wanan.shortcut.framework.ModuleEntry
import com.wanan.shortcut.framework.ModuleRegistry
import com.wanan.shortcut.framework.ModuleSection
import com.wanan.shortcut.ui.components.LoadingState
import com.wanan.shortcut.ui.components.ScListCard
import com.wanan.shortcut.ui.components.SectionHeader
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.IconSizes
import com.wanan.shortcut.ui.theme.Radii
import com.wanan.shortcut.ui.theme.Sizes
import com.wanan.shortcut.ui.theme.Spacing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 首页状态 */
data class HomeUiState(
    val sections: List<ModuleSection> = emptyList(),
    val loading: Boolean = true,
    val style: HomeLayoutStyle = HomeLayoutStyle.DEFAULT,
)

/**
 * 首页 ViewModel。
 *
 * 模块列表是**三个来源合成**（设计规范 §3.2）：
 * 本地注册表 + 服务端 `module.list`（仅联动板块）+ 用户布局覆盖。
 */
class HomeViewModel(
    private val registry: ModuleRegistry,
    private val layoutStore: com.wanan.shortcut.framework.HomeLayoutStore,
    private val homePrefs: HomePrefsStore,
    private val appVersion: String,
) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _state.value = _state.value.copy(style = homePrefs.currentStyle())
        }
    }

    /**
     * 刷新。
     *
     * @param bound 是否已绑定 —— 决定联动板块是否可进入（置灰与否）
     */
    fun refresh(bound: Boolean) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)

            val layout = layoutStore.load()
            // 已绑定时才拉服务端清单；未绑定直接用本地兜底，省一次请求
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
            _state.value = _state.value.copy(
                sections = registry.group(entries),
                loading = false,
            )
        }
    }

    /** 切换首页形式（设置页可调；本轮默认网格，列表也已实现） */
    fun setStyle(style: HomeLayoutStyle) {
        viewModelScope.launch {
            homePrefs.setStyle(style)
            _state.value = _state.value.copy(style = style)
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
        HomeViewModel(
            registry = c.moduleRegistry,
            layoutStore = c.homeLayoutStore,
            homePrefs = c.homePrefs,
            appVersion = com.wanan.shortcut.BuildConfig.VERSION_NAME,
        )
    },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // 绑定状态变化时重新合成：未绑定→已绑定时，联动板块应从置灰变为可进入
    LaunchedEffect(identity.isBound) {
        viewModel.refresh(identity.isBound)
    }

    Box(Modifier.fillMaxSize()) {
        when {
            state.loading && state.sections.isEmpty() -> LoadingState()

            state.sections.isEmpty() -> com.wanan.shortcut.ui.components.EmptyState(
                text = "还没有可用的功能。",
                title = "空空的",
                icon = "🧩",
            )

            else -> when (state.style) {
                HomeLayoutStyle.GRID -> HomeGrid(
                    sections = state.sections,
                    onOpenModule = onOpenModule,
                    onGoBind = onGoBind,
                )

                HomeLayoutStyle.LIST -> HomeList(
                    sections = state.sections,
                    onOpenModule = onOpenModule,
                    onGoBind = onGoBind,
                )
            }
        }
    }
}

// ---------------- 形式一：图标网格（第一期默认） ----------------

/**
 * 图标网格。
 *
 * 相比上一版的关键改进：**每个格子是有包裹感的卡片**（图标容器 + 名称），
 * 而不是"裸 emoji + 裸文字"直接贴在背景上 —— 后者正是"廉价感"的来源。
 * 同时在名称下方留出一行**状态角标**（未连接/需升级），让置灰原因可读。
 */
@Composable
private fun HomeGrid(
    sections: List<ModuleSection>,
    onOpenModule: (String) -> Unit,
    onGoBind: () -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = Spacing.lg,
            end = Spacing.lg,
            top = Spacing.sm,
            bottom = Spacing.xxl,
        ),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        sections.forEach { section ->
            item(span = { GridItemSpan(maxLineSpan) }, key = "h_${section.title}") {
                SectionHeader(
                    title = section.title,
                    trailing = "${section.entries.size}",
                )
            }
            items(section.entries, key = { it.module.spec.id }) { entry ->
                GridTile(entry = entry, onClick = { handleEntryClick(entry, onOpenModule, onGoBind) })
            }
        }
    }
}

@Composable
private fun GridTile(entry: ModuleEntry, onClick: () -> Unit) {
    val dimmed = isDimmed(entry)

    Column(
        modifier = Modifier
            .clip(MaterialTheme.shapes.medium)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = onClick)
            .padding(vertical = Spacing.md, horizontal = Spacing.sm)
            .alpha(if (dimmed) 0.55f else 1f),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        // 图标容器：让 emoji 有"落地感"，而不是浮在卡片上
        Box(
            modifier = Modifier
                .size(Sizes.gridIcon)
                .clip(RoundedCornerShape(Radii.sm))
                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = entry.icon, fontSize = IconSizes.grid)
        }

        Text(
            text = entry.label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )

        // 状态角标：让"为什么点不进去"可见
        val badge = badgeOf(entry)
        if (badge != null) {
            Text(
                text = badge,
                style = MaterialTheme.typography.labelSmall,
                color = if (entry.requiresUpgrade) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                maxLines = 1,
            )
        }
    }
}

// ---------------- 形式二：行式卡片列表（对齐 web /mobile/） ----------------

@Composable
private fun HomeList(
    sections: List<ModuleSection>,
    onOpenModule: (String) -> Unit,
    onGoBind: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = Spacing.lg,
            end = Spacing.lg,
            top = Spacing.sm,
            bottom = Spacing.xxl,
        ),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        sections.forEach { section ->
            item(key = "h_${section.title}") {
                SectionHeader(title = section.title, trailing = "${section.entries.size}")
            }
            items(section.entries, key = { it.module.spec.id }) { entry ->
                ScListCard(
                    icon = entry.icon,
                    title = entry.label,
                    subtitle = badgeOf(entry) ?: entry.desc,
                    dimmed = isDimmed(entry),
                    onClick = { handleEntryClick(entry, onOpenModule, onGoBind) },
                )
            }
        }
    }
}

// ---------------- 共用逻辑 ----------------

/** 置灰 = 联动板块未绑定，或版本不满足 */
private fun isDimmed(entry: ModuleEntry): Boolean =
    (entry.domain == ModuleDomain.LINKED && !entry.available) || entry.requiresUpgrade

/** 状态角标文案；无状态时返回 null（不占位） */
private fun badgeOf(entry: ModuleEntry): String? = when {
    entry.requiresUpgrade -> "需升级"
    entry.domain == ModuleDomain.LINKED && !entry.available -> "未连接"
    else -> null
}

/**
 * 点击行为。
 *
 * ⚠️ 联动板块未绑定时**不是禁用，而是引导去绑定** ——
 * 用户要求"显示但置灰，让人知道有这些功能"，做成 disabled 会让人不知道为什么点不动。
 */
private fun handleEntryClick(
    entry: ModuleEntry,
    onOpenModule: (String) -> Unit,
    onGoBind: () -> Unit,
) {
    when {
        entry.requiresUpgrade -> Unit   // 已标"需升级"，点击不进入
        entry.domain == ModuleDomain.LINKED && !entry.available -> onGoBind()
        else -> onOpenModule(entry.module.spec.id)
    }
}

// 注：原先这里有一个 HomeStatusStrip（首页内容区顶部的"连接状态 + 管理"条）。
// 已删除，原因：
//   1. 用户反馈"首页上方不需要加那个管理"；
//   2. 它与顶部栏的连接状态重复，且"去绑定/管理"入口已在底部标签栏的「设置」里；
//   3. 未绑定用户仍可通过置灰的联动板块（点击 → 去连接）进入绑定页。
// 连接状态现在只保留在顶部栏（只读，不可点）。
