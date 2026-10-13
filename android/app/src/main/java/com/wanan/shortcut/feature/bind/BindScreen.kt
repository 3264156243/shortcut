package com.wanan.shortcut.feature.bind

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.ui.containerViewModel

/**
 * 绑定页。
 *
 * P0 阶段用"手输 6 位绑定码"；相机扫码留到 P1（需要 CAMERA 权限与扫码库，
 * 不该拖慢框架搭建）。
 */
@Composable
fun BindScreen(
    onBound: () -> Unit,
    viewModel: BindViewModel = containerViewModel { it.bindViewModel() },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    var code by remember { mutableStateOf("") }
    var deviceName by remember { mutableStateOf("") }

    // 绑定成功后通知导航层切到首页
    androidx.compose.runtime.LaunchedEffect(state) {
        if (state is BindUiState.Success) onBound()
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "连接电脑",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = "在电脑端 ShortCut 打开「移动互联」，输入下方 6 位绑定码",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp, bottom = 28.dp),
        )

        OutlinedTextField(
            value = code,
            onValueChange = { input ->
                // 只允许 6 位字母数字，且统一大写（契约 §2.2：绑定码是 [0-9A-Z]）
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
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        )

        // 错误提示：
        // ⚠️ 刻意不用 ErrorState（那个是 fillMaxSize 的整页态），
        // 这里要保留输入框让用户直接改，所以是内联提示。
        val failed = state as? BindUiState.Failed
        if (failed != null) {
            Text(
                text = failed.message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            )
        }

        Button(
            onClick = { viewModel.bind(code, deviceName) },
            enabled = state !is BindUiState.Submitting && code.length == 6,
            modifier = Modifier.fillMaxWidth().padding(top = 20.dp),
        ) {
            if (state is BindUiState.Submitting) {
                CircularProgressIndicator(
                    modifier = Modifier.padding(end = 10.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp,
                )
            }
            Text(if (state is BindUiState.Submitting) "连接中…" else "绑定")
        }
    }
}
