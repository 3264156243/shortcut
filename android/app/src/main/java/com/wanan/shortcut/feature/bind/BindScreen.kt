package com.wanan.shortcut.feature.bind

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.ui.components.InlineError
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.IconSizes
import com.wanan.shortcut.ui.theme.Radii
import com.wanan.shortcut.ui.theme.Sizes
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 绑定页（契约 §2.6 `mobile.bind`）。
 *
 * P0 阶段用"手输 6 位绑定码"；相机扫码留到后续（需 CAMERA 权限与扫码库）。
 */
@Composable
fun BindScreen(
    onBound: () -> Unit,
    viewModel: BindViewModel = containerViewModel { it.bindViewModel() },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    var code by remember { mutableStateOf("") }
    var deviceName by remember { mutableStateOf("") }

    LaunchedEffect(state) {
        if (state is BindUiState.Success) onBound()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        // 顶部说明区：图标 + 标题 + 说明，而不是一上来就是输入框
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.lg, bottom = Spacing.sm),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Box(
                modifier = Modifier
                    .size(Sizes.emptyIcon)
                    .clip(RoundedCornerShape(Radii.pill))
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Text(text = "🔗", fontSize = IconSizes.empty)
            }
            Text(
                text = "连接电脑",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "在电脑端 ShortCut 打开「移动互联」，输入下面显示的 6 位绑定码。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { input ->
                        // 只允许 6 位字母数字并统一大写（契约 §2.2：绑定码是 [0-9A-Z]）
                        code = input.filter { it.isLetterOrDigit() }.take(6).uppercase()
                        viewModel.resetError()
                    },
                    label = { Text("6 位绑定码") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedTextField(
                    value = deviceName,
                    onValueChange = { deviceName = it.take(30) },   // 契约 §2.6：截 30 字
                    label = { Text("设备名称（可选）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )

                (state as? BindUiState.Failed)?.let { failed ->
                    InlineError(message = failed.message)
                }

                Button(
                    onClick = { viewModel.bind(code, deviceName) },
                    enabled = state !is BindUiState.Submitting && code.length == 6,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (state is BindUiState.Submitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp).padding(end = Spacing.xs),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp,
                        )
                    }
                    Text(if (state is BindUiState.Submitting) "连接中…" else "绑定")
                }
            }
        }

        Text(
            text = "绑定后本机可用任务墙、文件共享、电脑控制；本机功能（如笔记）不需要绑定也能用。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm),
        )
    }
}
