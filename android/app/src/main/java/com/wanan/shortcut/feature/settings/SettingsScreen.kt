package com.wanan.shortcut.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.AppContainer
import com.wanan.shortcut.BuildConfig
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.net.Protocol
import com.wanan.shortcut.ui.containerViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

/**
 * 设置页 ViewModel。
 *
 * 这里体现"框架统一管权限/身份"：设置页不做业务，只做三件事——
 * 改本机名、解除绑定、展示版本与协议版本。
 */
class SettingsViewModel(private val container: AppContainer) : ViewModel() {

    fun rename(name: String) {
        viewModelScope.launch { container.identityProvider.updateDeviceName(name.take(30)) }
    }

    /**
     * 解除绑定。
     *
     * ⚠️ 只清本地绑定信息，**保留 deviceKey**（见 IdentityStore.clearBinding 的注释）：
     * 保留它，用户重新绑定才是"原地轮换"而不会新增设备条目。
     */
    fun unbind(onDone: () -> Unit) {
        viewModelScope.launch {
            container.identityProvider.clear()
            onDone()
        }
    }
}

@Composable
fun SettingsScreen(
    identity: Identity,
    onUnbound: () -> Unit,
    viewModel: SettingsViewModel = containerViewModel { SettingsViewModel(it) },
) {
    var showUnbindDialog by remember { mutableStateOf(false) }
    var nameDraft by remember(identity.deviceName) { mutableStateOf(identity.deviceName) }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("设置", style = MaterialTheme.typography.headlineSmall)

        SectionTitle("连接与设备")
        OutlinedTextField(
            value = nameDraft,
            onValueChange = { nameDraft = it.take(30) },
            label = { Text("本机名称") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        TextButton(onClick = { viewModel.rename(nameDraft) }) { Text("保存名称") }

        InfoRow("绑定 ID", identity.bindId.ifBlank { "未绑定" })
        InfoRow("设备 ID", identity.deviceId.ifBlank { "—" })

        TextButton(onClick = { showUnbindDialog = true }) {
            Text("断开连接", color = MaterialTheme.colorScheme.error)
        }

        HorizontalDivider(Modifier.padding(vertical = 12.dp))

        SectionTitle("关于")
        InfoRow("版本", BuildConfig.VERSION_NAME)
        // 契约 §1.2：服务端不校验协议版本，兼容由客户端自己判断。
        // 这里只是展示，不做阻断（服务端不拒绝旧客户端，客户端也不该自锁）。
        InfoRow("协议版本", Protocol.VERSION.toString())
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

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 18.dp, bottom = 8.dp),
    )
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
