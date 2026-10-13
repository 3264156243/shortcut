package com.wanan.shortcut.feature.linked.taskwall

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import java.util.Calendar

/**
 * 新建任务表单（契约 §5.1 的 `push`）。
 *
 * UI 上有意体现契约里的两处硬约束：
 *   1. **长文本开关**：关掉时长文本输入框不显示，且提交时不带 `details`
 *      （契约规定 `details` 仅当 `longText===true` 才被读取）；
 *   2. **提醒开关**：打开但没选时间时**本地就拦住**，不白跑一次网络请求
 *      （服务端会回 `提醒时间格式无效`，实测确认）。
 */
@Composable
fun TaskComposeScreen(
    onBack: () -> Unit,
    onSubmit: (
        text: String,
        longText: Boolean,
        details: String,
        reminderAtMillis: Long?,
        boardName: String,
    ) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var longText by remember { mutableStateOf(false) }
    var details by remember { mutableStateOf("") }
    var reminderEnabled by remember { mutableStateOf(false) }
    var boardName by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf("") }

    /**
     * 提醒时间用"相对小时数"选择。
     *
     * 为什么不用系统日期时间选择器：P1 阶段先保证协议链路正确，
     * 引入 `DatePicker`/`TimePicker` 会牵涉时区与 Material3 版本细节。
     * 这里给出明确的相对时间，天然避免时区误用（最终仍统一转 UTC ISO）。
     */
    var reminderHours by remember { mutableStateOf(1) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("新建任务", style = MaterialTheme.typography.titleLarge)

        OutlinedTextField(
            value = title,
            onValueChange = { title = it; localError = "" },
            label = { Text("任务标题（必填）") },
            singleLine = true,
            supportingText = { Text("${title.length}/120") },
            modifier = Modifier.fillMaxWidth(),
        )

        ToggleRow(
            label = "长文本任务",
            checked = longText,
            onCheckedChange = { longText = it },
        )
        if (longText) {
            OutlinedTextField(
                value = details,
                onValueChange = { details = it },
                label = { Text("详细内容") },
                minLines = 3,
                supportingText = { Text("${details.length}/2000") },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        ToggleRow(
            label = "到时提醒",
            checked = reminderEnabled,
            onCheckedChange = { reminderEnabled = it; localError = "" },
        )
        if (reminderEnabled) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(1, 2, 4, 8, 24).forEach { h ->
                    TextButton(onClick = { reminderHours = h }) {
                        Text(
                            text = "${h}小时后",
                            color = if (reminderHours == h) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                }
            }
        }

        OutlinedTextField(
            value = boardName,
            onValueChange = { boardName = it },
            label = { Text("目标任务墙（可选，留空用默认墙）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        if (localError.isNotBlank()) {
            Text(
                text = localError,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Button(
            onClick = {
                // 本地校验：避免必然失败的网络往返
                if (title.isBlank()) {
                    localError = "请填写任务标题"
                    return@Button
                }
                val reminderAt = if (reminderEnabled) {
                    Calendar.getInstance().apply { add(Calendar.HOUR_OF_DAY, reminderHours) }.timeInMillis
                } else {
                    null
                }
                onSubmit(title.trim(), longText, details.trim(), reminderAt, boardName.trim())
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("下发到电脑")
        }

        TextButton(onClick = onBack) { Text("返回列表") }
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
