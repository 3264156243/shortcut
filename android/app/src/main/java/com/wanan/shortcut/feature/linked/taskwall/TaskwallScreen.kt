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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.ui.components.InlineError
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.components.StatusChip
import com.wanan.shortcut.ui.components.StatusDot
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.Spacing
import java.util.Calendar

/**
 * 任务墙（手机端）—— **「新增任务」表单页**。
 *
 * ## 与 web 参考实现对齐（`server/sync/web/taskwall/index.html`）
 *
 * | 元素 | web 做法 | 本页做法 |
 * |---|---|---|
 * | 任务标题 | `input#title`（max 120） | `OutlinedTextField` + 字数 |
 * | 长文本 | 开关，开启才显示详情（max 2000） | 同 |
 * | 待办提醒 | 开关，开启才显示时间 | 同 |
 * | **目标任务墙** | **`select#boardName`（来自 board.list）** | **下拉选择（可刷新）** |
 * | 提交 | 「钉到桌面任务墙」 | 同 |
 * | 墙列表读取失败/为空 | **明确提示 + 回退默认墙 + 可重试** | 同 |
 *
 * ## 刻意**没有**的东西
 *
 * 没有"任务列表"、没有"勾选完成" —— 因为队列是"等桌面接收"的，
 * 且勾选会调 `ack` 把任务删掉、导致桌面永远收不到（详见 TaskwallRepository.ack）。
 */
@Composable
fun TaskwallScreen(
    viewModel: TaskwallViewModel = containerViewModel { it.taskwallViewModel() },
    onToast: (String) -> Unit = {},
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    var title by remember { mutableStateOf("") }
    var longText by remember { mutableStateOf(false) }
    var details by remember { mutableStateOf("") }
    var reminderEnabled by remember { mutableStateOf(false) }
    var reminderHours by remember { mutableIntStateOf(1) }
    var localError by remember { mutableStateOf("") }
    var boardName by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    val ready = state as? TaskwallUiState.Ready

    // 墙列表到达后，若还没选过则默认选第一面（web 是同名下拉的默认行为）
    if (ready != null && boardName.isBlank() && ready.boards.isNotEmpty()) {
        boardName = ready.boards.first()
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        // 顶部状态条（对应 web 的 bind-summary：当前桌面 + 排队数）
        ScCard(contentPadding = Spacing.md) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                StatusDot(online = ready != null)
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "钉到电脑任务墙",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = buildString {
                            append("电脑会在下次接收时自动取走")
                            ready?.queuedCount?.let { n ->
                                append(if (n > 0) "　·　还有 $n 条等它接收" else "　·　没有待接收")
                            }
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        // ---- 任务标题 ----
        ScCard {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it; localError = "" },
                label = { Text("任务标题") },
                placeholder = { Text("要完成什么？") },
                singleLine = true,
                supportingText = { Text("${title.length}/120") },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // ---- 类型开关（web 的 type-switches）----
        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                SwitchRow(
                    label = "长文本",
                    checked = longText,
                    onCheckedChange = { longText = it },
                )
                if (longText) {
                    OutlinedTextField(
                        value = details,
                        onValueChange = { details = it },
                        label = { Text("详细内容（可选）") },
                        placeholder = { Text("补充说明、清单或备注") },
                        minLines = 3,
                        supportingText = { Text("${details.length}/2000") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                SwitchRow(
                    label = "待办提醒",
                    checked = reminderEnabled,
                    onCheckedChange = { reminderEnabled = it; localError = "" },
                )
                if (reminderEnabled) {
                    // 相对时间：先保证协议链路正确（最终统一转 UTC ISO）
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

        // ---- 目标任务墙（web 是 select，从 board.list 取值）----
        ScCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "目标任务墙",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextButton(onClick = viewModel::refreshBoards) {
                        Text(if (ready?.boardsLoading == true) "读取中…" else "刷新")
                    }
                }

                BoardSelector(
                    boards = ready?.boards.orEmpty(),
                    selected = boardName,
                    onSelect = { boardName = it },
                )

                // 墙列表为空的提示：必须显式告知，否则用户以为桌面只有一面墙
                ready?.boardsHint?.let { hint ->
                    Text(
                        text = hint,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
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
                if (reminderEnabled && reminderHours <= 0) {
                    localError = "请选择提醒时间"
                    return@Button
                }
                submitting = true
                val reminderAt = if (reminderEnabled) {
                    Calendar.getInstance()
                        .apply { add(Calendar.HOUR_OF_DAY, reminderHours) }
                        .timeInMillis
                } else {
                    null
                }
                viewModel.push(
                    text = title.trim(),
                    longText = longText,
                    details = details.trim(),
                    reminderAtEpochMillis = reminderAt,
                    boardName = boardName,
                ) { outcome ->
                    submitting = false
                    when (outcome) {
                        // 契约 §5.1：已排队不是失败，文案必须区分，否则用户以为发丢了
                        PushOutcome.Delivered -> {
                            onToast("已钉到电脑任务墙（电脑在线，已收到）")
                            title = ""; details = ""
                            longText = false; reminderEnabled = false
                        }
                        PushOutcome.Queued -> {
                            onToast("已钉到云端，等电脑开机后自动接收")
                            title = ""; details = ""
                            longText = false; reminderEnabled = false
                        }
                        is PushOutcome.Failed -> localError = outcome.message
                    }
                }
            },
            enabled = !submitting && ready != null,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (submitting) "正在提交…" else "钉到电脑任务墙")
        }

        Text(
            text = "任务内容仅临时存在 ShortCut 服务器，电脑端接收后会从云端取走。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm),
        )
    }
}

/**
 * 目标任务墙选择器（对齐 web 的 `<select id="boardName">`）。
 *
 * 用一个可展开的下拉而不是自由文本输入：
 * 墙名**必须与桌面端已有的墙一致**，手输容易打错字 ——
 * 而打错的结果是桌面端**新建一面墙**、任务落在当前不可见的新墙上
 * （《任务墙板块待办》T1 记录的正是这个问题）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BoardSelector(
    boards: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val options = boards.ifEmpty { listOf("正在读取…") }

    ExposedDropdownMenuBox(
        expanded = expanded && boards.isNotEmpty(),
        onExpandedChange = { if (boards.isNotEmpty()) expanded = !expanded },
    ) {
        OutlinedTextField(
            value = selected.ifBlank { options.first() },
            onValueChange = {},
            readOnly = true,
            label = { Text("任务墙") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(androidx.compose.material3.MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded && boards.isNotEmpty(), onDismissRequest = { expanded = false }) {
            boards.forEach { name ->
                DropdownMenuItem(
                    text = { Text(name) },
                    onClick = { onSelect(name); expanded = false },
                )
            }
        }
    }
}

/** 开关行：左标签右开关（对齐 web `.type-switch` 的语义）。 */
@Composable
private fun SwitchRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
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
