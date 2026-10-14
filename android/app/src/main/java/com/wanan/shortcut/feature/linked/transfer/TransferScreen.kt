package com.wanan.shortcut.feature.linked.transfer

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.core.util.DateFormats
import com.wanan.shortcut.ui.components.EmptyState
import com.wanan.shortcut.ui.components.LoadingState
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 文件共享页面（对齐 web `/transfer/`）。
 *
 * web 的布局是：顶栏 → 输入条（选择文件 + 文本框 + 发送）→ 消息列表 → 工具条（共享内容）。
 * 本页保持同样的三段式，只是把"工具条"做成顶部/底部的按钮。
 */
@Composable
fun TransferScreen(viewModel: TransferViewModel = containerViewModel { it.transferViewModel() }) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val listState = rememberLazyListState()

    var draft by remember { mutableStateOf("") }
    var showSharePanel by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<TransferMessage?>(null) }
    // 免存储权限：从系统选择器拿到的 URI 直接读
    var pendingFile by remember { mutableStateOf<PendingFile?>(null) }
    // 本地校验提示（例如"文件超过 1 GB"）——这类拦截不该占用 ViewModel 的状态
    var localNotice by remember { mutableStateOf<String?>(null) }

    // 与 web 一致：进入页面开始 3 秒轮询，离开停止
    DisposableEffect(Unit) {
        viewModel.startPolling()
        onDispose { viewModel.stopPolling() }
    }

    // 新消息到达时滚到底部（web 是 box.scrollTop = box.scrollHeight）
    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.lastIndex)
        }
    }

    // 文件选择器（web 用 <input type=file multiple>）
    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            val meta = resolveFileMeta(context, uri)
            if (meta.size > MAX_FILE_BYTES) {
                pendingFile = null
                localNotice = "单个文件不能超过 1 GB"
            } else if (meta.size <= 0L) {
                pendingFile = null
                localNotice = "读不到文件大小，无法发送（可能是云端占位文件）"
            } else {
                pendingFile = PendingFile(uri, meta.name, meta.mime, meta.size)
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // ---- 发送文件确认条（选择后先确认，避免误发大文件）----
            pendingFile?.let { pf ->
                ScCard(
                    modifier = Modifier.padding(
                        start = Spacing.lg, end = Spacing.lg, top = Spacing.sm,
                    ),
                    contentPadding = Spacing.md,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        Text(
                            text = "要发送这个文件吗？",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = pf.name,
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = formatBytes(pf.size),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            Button(onClick = {
                                viewModel.sendFile(context, pf.uri, pf.name, pf.mime, pf.size)
                                pendingFile = null
                            }) { Text("发送") }
                            TextButton(onClick = { pendingFile = null }) { Text("取消") }
                        }
                    }
                }
            }

            // ---- 上传进度 ----
            state.uploadingName?.let { name ->
                Column(
                    Modifier.fillMaxWidth().padding(
                        start = Spacing.lg, end = Spacing.lg, top = Spacing.sm,
                    ),
                ) {
                    Text(
                        text = "正在上传：$name",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    LinearProgressIndicator(
                        progress = { state.uploadProgress },
                        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
                    )
                }
            }

            // ---- 消息列表 ----
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.loading && state.messages.isEmpty() -> LoadingState(text = "正在读取消息…")

                    state.messages.isEmpty() -> EmptyState(
                        text = "发送文本或文件，手机与电脑之间互通。",
                        title = "还没有消息",
                        icon = "📤",
                    )

                    else -> LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = Spacing.lg, end = Spacing.lg,
                            top = Spacing.sm, bottom = Spacing.md,
                        ),
                        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                    ) {
                        items(state.messages, key = { it.id }) { msg ->
                            MessageBubble(
                                msg = msg,
                                onDelete = { pendingDelete = msg },
                                onDownload = {
                                    viewModel.downloadFile(context, msg.fileId, msg.displayTitle)
                                },
                                onCopy = { copyToClipboard(context, msg.text) },
                            )
                        }
                    }
                }
            }

            // ---- 输入条（对齐 web `.composer`）----
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .padding(Spacing.md),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                OutlinedButton(
                    onClick = { filePicker.launch(arrayOf("*/*")) },
                    enabled = state.uploadingName == null,
                ) { Text("＋") }

                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text("发送文本") },
                    maxLines = 4,
                    modifier = Modifier.weight(1f),
                )

                Button(
                    onClick = {
                        viewModel.sendText(draft)
                        draft = ""
                    },
                    enabled = draft.isNotBlank(),
                ) { Text("↑") }
            }

            // ---- 工具条（对齐 web `.toolsbar`：共享内容）----
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "消息云端保留，删除后两端消失",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = { showSharePanel = true }) { Text("共享内容") }
            }
        }

        // ---- 提示（服务端/网络类）----
        state.notice?.let { notice ->
            LaunchedEffect(notice) {
                kotlinx.coroutines.delay(2600)
                viewModel.consumeNotice()
            }
            Snackbar(
                modifier = Modifier.align(Alignment.BottomCenter).padding(Spacing.md),
                containerColor = if (state.noticeIsError) {
                    MaterialTheme.colorScheme.errorContainer
                } else {
                    MaterialTheme.colorScheme.surfaceContainerHigh
                },
            ) { Text(notice) }
        }

        // ---- 提示（本地校验类，例如文件过大）----
        localNotice?.let { notice ->
            LaunchedEffect(notice) {
                kotlinx.coroutines.delay(2600)
                localNotice = null
            }
            Snackbar(
                modifier = Modifier.align(Alignment.BottomCenter).padding(Spacing.md),
                containerColor = MaterialTheme.colorScheme.errorContainer,
            ) { Text(notice) }
        }
    }

    // ---- 删除确认（web 用 window.confirm）----
    pendingDelete?.let { msg ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除这条消息？") },
            text = {
                Text(msg.displayTitle.take(80), maxLines = 3, overflow = TextOverflow.Ellipsis)
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteMessage(msg.id)
                    pendingDelete = null
                }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("取消") }
            },
        )
    }

    // ---- 共享面板 ----
    if (showSharePanel) {
        SharePanel(
            viewModel = viewModel,
            onDismiss = { showSharePanel = false },
        )
    }
}

// ---------------- 消息气泡 ----------------

/**
 * 一条消息（对齐 web 的 `.row.mine` / `.bubble` / `.meta`）。
 *
 * 自己的消息靠右、砖红底；对方的靠左、深底 —— 与 web 的观感一致。
 */
@Composable
private fun MessageBubble(
    msg: TransferMessage,
    onDelete: () -> Unit,
    onDownload: () -> Unit,
    onCopy: () -> Unit,
) {
    val mine = msg.isMine
    val bubbleColor = if (mine) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.surfaceContainerHigh
    }
    val textColor = if (mine) {
        MaterialTheme.colorScheme.onPrimary
    } else {
        MaterialTheme.colorScheme.onSurface
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 300.dp),
            horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
        ) {
            Box(
                Modifier
                    .clip(
                        RoundedCornerShape(
                            topStart = 12.dp, topEnd = 12.dp,
                            bottomStart = if (mine) 12.dp else 4.dp,
                            bottomEnd = if (mine) 4.dp else 12.dp,
                        ),
                    )
                    .background(bubbleColor)
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            ) {
                if (msg.isFile) {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        ) {
                            Text("▣", style = MaterialTheme.typography.titleMedium, color = textColor)
                            Column(Modifier.weight(1f)) {
                                Text(
                                    text = msg.name.ifBlank { "文件" },
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = textColor,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = formatBytes(msg.size),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = textColor.copy(alpha = 0.7f),
                                )
                            }
                        }
                        TextButton(onClick = onDownload) { Text("下载") }
                    }
                } else {
                    Text(
                        text = msg.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = textColor,
                    )
                }
            }

            // 元信息行（时间 + 复制/删除）
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                modifier = Modifier.padding(top = Spacing.xs),
            ) {
                Text(
                    text = DateFormats.formatForDisplay(msg.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (!msg.isFile) {
                    Text(
                        text = "复制",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickableText(onCopy),
                    )
                }
                Text(
                    text = "删除",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.clickableText(onDelete),
                )
            }
        }
    }
}

// ---------------- 工具 ----------------

/** 选择器返回的 URI 的元信息 */
private data class PendingFile(
    val uri: Uri,
    val name: String,
    val mime: String,
    val size: Long,
)

private data class FileMeta(val name: String, val mime: String, val size: Long)

/**
 * 从 `content://` URI 取文件名/大小。
 *
 * 不用 `File(uri.path)` —— content URI 不是文件路径，那样取不到。
 * 必须查 `OpenableColumns`（Android 的标准做法）。
 */
private fun resolveFileMeta(context: Context, uri: Uri): FileMeta {
    var name = "file"
    var size = 0L
    try {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (cursor.moveToFirst()) {
                if (nameIdx >= 0) cursor.getString(nameIdx)?.let { if (it.isNotBlank()) name = it }
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
            }
        }
    } catch (_: Throwable) {
        // 查不到就退回默认值；后续上传时若 size 为 0 会被拦下并提示
    }
    val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
    return FileMeta(name = name, mime = mime, size = size)
}

private fun copyToClipboard(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    cm.setPrimaryClip(ClipData.newPlainText("ShortCut", text))
}

/** 给文本加点击（避免为一行小字引入 Button 的额外边距） */
private fun Modifier.clickableText(onClick: () -> Unit): Modifier =
    this.clickable(onClick = onClick)

/** 字节数格式化（对齐 web 的 `fmtByte`） */
internal fun formatBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> String.format("%.1f KB", n / 1024.0)
    n < 1024L * 1024 * 1024 -> String.format("%.1f MB", n / 1048576.0)
    else -> String.format("%.2f GB", n / 1073741824.0)
}

/** 契约 §6.2：单文件上限 1 GB */
private const val MAX_FILE_BYTES = 1024L * 1024 * 1024
