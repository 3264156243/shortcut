package com.wanan.shortcut.feature.linked.taskwall

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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.ui.components.InlineError
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.theme.Spacing
import java.util.Calendar

/**
 * 新建任务表单（契约 §5.1 的 `push`）。
 *
 * UI 上体现契约的两处硬约束：
 *   1. **长文本开关**：关掉时不带 `details`（契约规定仅当 `longText===true` 才被读取）；
 *   2. **提醒开关**：打开但没选时间时**本地拦住**，不白跑一次网络请求
 *      （服务端会回 `提醒时间格式无效`）。
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
     * 不用系统日期时间选择器：先保证协议链路正确，且相对时间天然避免时区误用
     * （最终仍统一转 UTC ISO，见 DateFormats.toIsoUtc）。
     */
    var reminderHours by remember { mutableStateOf(1) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it; localError = "" },
                    label = { Text("任务标题") },
                    singleLine = true,
                    supportingText = { Text("${title.length}/120") },
                    modifier = Modifier.fillMaxWidth(),
                )

                SwitchRow(
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
            }
        }

        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                SwitchRow(
                    label = "到时提醒",
                    checked = reminderEnabled,
                    onCheckedChange = { reminderEnabled = it; localError = "" },
                )

                if (reminderEnabled) {
                    // 相对时间做成胶囊选项，比裸下拉更好按
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        listOf(1, 2, 4, 8, 24).forEach { h ->
                            val selected = reminderHours == h
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(MaterialTheme.shapes.small)
                                    .background(
                                        if (selected) MaterialTheme.colorScheme.primaryContainer
                                        else MaterialTheme.colorScheme.surfaceContainerHigh,
                                    )
                                    .clickable { reminderHours = h }
                                    .padding(vertical = Spacing.sm),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "${h}h",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (selected) {
                                        MaterialTheme.colorScheme.onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }

        ScCard {
            OutlinedTextField(
                value = boardName,
                onValueChange = { boardName = it },
                label = { Text("目标任务墙（可选）") },
                supportingText = { Text("留空则用默认墙") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (localError.isNotBlank()) {
            InlineError(message = localError)
        }

        Button(
            onClick = {
                if (title.isBlank()) {
                    localError = "请填写任务标题"
                    return@Button
                }
                val reminderAt = if (reminderEnabled) {
                    Calendar.getInstance()
                        .apply { add(Calendar.HOUR_OF_DAY, reminderHours) }
                        .timeInMillis
                } else {
                    null
                }
                onSubmit(title.trim(), longText, details.trim(), reminderAt, boardName.trim())
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("钉到电脑任务墙")
        }

        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("取消")
        }
    }
}

/** 开关行：左标签右开关。 */
@Composable
private fun SwitchRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
