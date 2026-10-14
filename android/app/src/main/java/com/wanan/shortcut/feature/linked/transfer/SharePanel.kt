package com.wanan.shortcut.feature.linked.transfer

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.core.util.DateFormats
import com.wanan.shortcut.ui.components.InlineError
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.components.SectionHeader
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 共享面板（对齐 web `/transfer/` 的「共享内容」弹窗）。
 *
 * web 的弹窗分三段：
 *   1. **创建共享**（接收密码 / 共享时长 / 文本 / 上传文件共享）
 *   2. **领取共享**（输入 6 位接收密码）
 *   3. **我的共享**（列表 + 删除）
 *
 * 这里用 `AlertDialog` 承载（web 是底部上滑的 sheet）。
 */
@Composable
fun SharePanel(
    viewModel: TransferViewModel,
    onDismiss: () -> Unit,
) {
    val shareState by viewModel.shareState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var shareCode by remember { mutableStateOf("") }
    var shareText by remember { mutableStateOf("") }
    var hours by remember { mutableIntStateOf(24) }
    var claimCode by remember { mutableStateOf("") }
    var pendingDeleteShare by remember { mutableStateOf<ShareItem?>(null) }

    // 打开面板时加载"我的共享"（web 的 openShare() 会 loadShares()）
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.loadShares() }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            val meta = resolvePickerMeta(context, uri)
            viewModel.shareFile(
                context = context,
                uri = uri,
                displayName = meta.name,
                mime = meta.mime,
                size = meta.size,
                code = shareCode.trim().uppercase(),
                hours = hours.toDouble(),
            )
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("共享内容") },
        text = {
            Column(
                Modifier
                    .heightIn(max = 460.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                // ============ 1. 创建共享 ============
                SectionHeader(title = "创建共享")

                OutlinedTextField(
                    value = shareCode,
                    onValueChange = { input ->
                        // web：只允许字母数字并大写、最多 6 位
                        shareCode = input.filter { it.isLetterOrDigit() }.take(6).uppercase()
                    },
                    label = { Text("接收密码（留空自动生成）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                // 共享时长（web 是 1/6/24 三档的下拉）
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Text(
                        text = "共享时长",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        listOf(1, 6, 24).forEach { h ->
                            val selected = hours == h
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(MaterialTheme.shapes.small)
                                    .background(
                                        if (selected) MaterialTheme.colorScheme.primaryContainer
                                        else MaterialTheme.colorScheme.surfaceContainerHigh,
                                    )
                                    .clickable { hours = h }
                                    .padding(vertical = Spacing.sm),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "${h}小时",
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

                OutlinedTextField(
                    value = shareText,
                    onValueChange = { shareText = it },
                    label = { Text("要共享的文本") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )

                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    OutlinedButton(
                        onClick = { filePicker.launch(arrayOf("*/*")) },
                        modifier = Modifier.weight(1f),
                    ) { Text("上传文件共享") }
                    Button(
                        onClick = {
                            viewModel.shareText(shareText, shareCode.trim().uppercase(), hours.toDouble())
                            shareText = ""
                            shareCode = ""
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text("共享文本") }
                }

                // 创建成功后突出展示接收密码（web 是 toast('共享成功，接收密码 ' + d.code)）
                shareState.lastCreatedCode?.let { code ->
                    ScCard(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        contentPadding = Spacing.md,
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                            Text(
                                text = "接收密码（发给对方即可领取）",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                            ) {
                                Text(
                                    text = code,
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 4.sp,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                                TextButton(onClick = { copyToClipboard(context, code) }) {
                                    Text("复制")
                                }
                            }
                        }
                    }
                }

                shareState.notice?.let { n ->
                    if (shareState.noticeIsError) {
                        InlineError(message = n)
                    } else {
                        Text(
                            text = n,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }

                HorizontalDivider()

                // ============ 2. 领取共享 ============
                SectionHeader(title = "领取共享")

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    OutlinedTextField(
                        value = claimCode,
                        onValueChange = { input ->
                            claimCode = input.filter { it.isLetterOrDigit() }.take(6).uppercase()
                        },
                        label = { Text("6 位接收密码") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    Button(
                        onClick = {
                            viewModel.claim(context, claimCode) { text ->
                                copyToClipboard(context, text)
                            }
                            claimCode = ""
                        },
                        enabled = claimCode.length == 6,
                    ) { Text("领取") }
                }

                HorizontalDivider()

                // ============ 3. 我的共享 ============
                SectionHeader(title = "我的共享", trailing = "${shareState.shares.size}")

                if (shareState.loading) {
                    Text(
                        text = "读取中…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else if (shareState.shares.isEmpty()) {
                    Text(
                        text = "暂无共享",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    shareState.shares.forEach { share ->
                        ShareRow(
                            share = share,
                            onDelete = { pendingDeleteShare = share },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )

    // 删除共享确认（web 用 window.confirm）
    pendingDeleteShare?.let { share ->
        AlertDialog(
            onDismissRequest = { pendingDeleteShare = null },
            title = { Text("删除这条共享？") },
            text = { Text(share.displayTitle.take(80), maxLines = 3, overflow = TextOverflow.Ellipsis) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteShare(share.id)
                    pendingDeleteShare = null
                }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { pendingDeleteShare = null }) { Text("取消") }
            },
        )
    }
}

/** 一条共享（对齐 web 的 `.share-item`：类型标签 + 标题/密码/到期 + 删除） */
@Composable
private fun ShareRow(share: ShareItem, onDelete: () -> Unit) {
    ScCard(contentPadding = Spacing.md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            // 类型标签（web：文件=绿、文本=棕）
            Box(
                Modifier
                    .clip(MaterialTheme.shapes.extraSmall)
                    .background(
                        if (share.isFile) MaterialTheme.colorScheme.tertiary
                        else MaterialTheme.colorScheme.surfaceContainerHighest,
                    )
                    .padding(horizontal = Spacing.sm, vertical = 2.dp),
            ) {
                Text(
                    text = if (share.isFile) "文件" else "文本",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (share.isFile) {
                        MaterialTheme.colorScheme.onTertiary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }

            Column(Modifier.weight(1f)) {
                Text(
                    text = share.displayTitle,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "密码 ${share.code} · 至 ${DateFormats.formatForDisplay(share.expiresAt)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            TextButton(onClick = onDelete) {
                Text("删除", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

// ---------------- 工具（与 TransferScreen 共用同一套私有实现会重复，这里各自保留最小份） ----------------

private data class PickerMeta(val name: String, val mime: String, val size: Long)

private fun resolvePickerMeta(context: Context, uri: Uri): PickerMeta {
    var name = "file"
    var size = 0L
    try {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIdx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            val sizeIdx = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
            if (cursor.moveToFirst()) {
                if (nameIdx >= 0) cursor.getString(nameIdx)?.let { if (it.isNotBlank()) name = it }
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
            }
        }
    } catch (_: Throwable) {
        // 忽略：取不到就用默认值，上传时会再校验
    }
    val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
    return PickerMeta(name = name, mime = mime, size = size)
}

private fun copyToClipboard(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    cm.setPrimaryClip(ClipData.newPlainText("ShortCut", text))
}
