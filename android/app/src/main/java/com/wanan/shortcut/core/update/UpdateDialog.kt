package com.wanan.shortcut.core.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.BuildConfig
import com.wanan.shortcut.ui.components.InlineError
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 更新对话框。
 *
 * ## 为什么这些状态都要有独立界面
 *
 * 更新是**用户唯一会卡住的操作**（其它功能失败都能重试，更新失败要重下几十 MB）。
 * 所以每一步都必须让用户看得见：
 *
 * | 状态 | 界面行为 |
 * |---|---|
 * | 发现新版 | 显示版本号 + 更新说明（让用户判断值不值得更新） |
 * | 需要重装 | 说明原因（签名变更/版本过低），提示要先卸载 |
 * | 下载中 | 进度条 + 已下载/总大小 + 百分比 |
 * | 下载完成 | 「立即安装」按钮（**不自动弹安装框**，避免打扰） |
 * | 失败 | 明确原因 + 重试 |
 */
@Composable
fun UpdateDialog(
    viewModel: UpdateViewModel,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val state by viewModel.state.collectAsStateWithLifecycle()

    when (val s = state) {
        UpdateUiState.Idle, UpdateUiState.Checking, is UpdateUiState.UpToDate -> Unit

        is UpdateUiState.Available -> AlertDialog(
            onDismissRequest = { viewModel.dismiss(); onDismiss() },
            title = { Text("发现新版本 ${s.manifest.versionName}") },
            text = { ReleaseNotesBlock(s.manifest) },
            confirmButton = {
                Button(onClick = { viewModel.download(context, s.manifest) }) {
                    Text("下载更新")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismiss(); onDismiss() }) {
                    Text("以后再说")
                }
            },
        )

        is UpdateUiState.RequiresFreshInstall -> AlertDialog(
            onDismissRequest = { viewModel.dismiss(); onDismiss() },
            title = { Text("需要重新安装") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text(
                        text = "这个版本无法直接覆盖升级（通常是签名变更或版本跨度过大）。" +
                            "请先卸载旧版本再安装新版本 —— **卸载会清除本机数据**，" +
                            "请先在设置里确认已绑定的电脑信息。",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    ReleaseNotesBlock(s.manifest)
                }
            },
            confirmButton = {
                Button(onClick = { viewModel.download(context, s.manifest) }) {
                    Text("下载新版本")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismiss(); onDismiss() }) {
                    Text("取消")
                }
            },
        )

        is UpdateUiState.Downloading -> AlertDialog(
            // 下载中不允许点外面关闭：否则用户以为取消了，实际还在下
            onDismissRequest = { },
            title = { Text("正在下载 ${s.manifest.versionName}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    LinearProgressIndicator(
                        progress = { s.progress },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            text = "${formatBytes(s.downloaded)} / ${formatBytes(s.total)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = "${(s.progress * 100).toInt()}%",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }

                    // ★ 显示实测速度与剩余时间。
                    // 没有它用户只能凭感觉判断"是不是卡住了"，也无法区分
                    // "真的慢"还是"只是没有进度反馈" —— 这对排查网络问题很关键。
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            text = if (s.bytesPerSecond > 0) {
                                "${formatSpeed(s.bytesPerSecond)}/s"
                            } else {
                                "正在测速…"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = s.remainingSeconds?.let { "剩余约 ${formatDuration(it)}" } ?: "",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    Text(
                        text = s.fileName,
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = { },
        )

        is UpdateUiState.ReadyToInstall -> AlertDialog(
            onDismissRequest = { onDismiss() },
            title = { Text("下载完成") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text("安装包已校验通过，可以安装了。")
                    Text(
                        // 这句话很重要：让用户预期"要点确认"，而不是以为出错了
                        text = "系统会弹出安装确认框，需要你点一下「安装」。",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                Button(onClick = {
                    val ok = viewModel.install(context, s.apkFile)
                    if (!ok) {
                        // 缺少"安装未知应用"权限：跳设置页，而不是反复弹同一个框
                        runCatching { context.startActivity(ApkInstaller.installPermissionIntent(context)) }
                    }
                    onDismiss()
                }) { Text("立即安装") }
            },
            dismissButton = {
                TextButton(onClick = onDismiss) { Text("稍后") }
            },
        )

        is UpdateUiState.Failed -> AlertDialog(
            onDismissRequest = { viewModel.reset(); onDismiss() },
            title = { Text("更新失败") },
            text = { InlineError(message = s.message) },
            confirmButton = {
                TextButton(onClick = { viewModel.reset() }) { Text("重试") }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.reset(); onDismiss() }) { Text("关闭") }
            },
        )
    }
}

/** 更新说明（Markdown 原文直接展示 —— 与桌面端 `release-notes` 同一套内容） */
@Composable
private fun ReleaseNotesBlock(manifest: UpdateManifest) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Text(
            text = "当前版本 ${BuildConfig.VERSION_NAME}　→　新版本 ${manifest.versionName}",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (manifest.size > 0) {
            Text(
                text = "安装包大小 ${formatBytes(manifest.size)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (manifest.releaseNotes.isNotBlank()) {
            androidx.compose.foundation.layout.Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = 240.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Text(
                    text = manifest.releaseNotes.trim(),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

/** 字节数格式化（与文件共享页保持一致的写法） */
private fun formatBytes(n: Long): String = when {
    n <= 0 -> "—"
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> String.format("%.1f KB", n / 1024.0)
    n < 1024L * 1024 * 1024 -> String.format("%.1f MB", n / 1048576.0)
    else -> String.format("%.2f GB", n / 1073741824.0)
}

/** 速度格式化：优先用 KB/s、MB/s，避免出现"1234567 B/s"这种难以直觉判断的数字 */
private fun formatSpeed(bytesPerSecond: Long): String = when {
    bytesPerSecond <= 0 -> "—"
    bytesPerSecond < 1024 -> "$bytesPerSecond B"
    bytesPerSecond < 1024 * 1024 -> String.format("%.0f KB", bytesPerSecond / 1024.0)
    else -> String.format("%.1f MB", bytesPerSecond / 1048576.0)
}

/** 剩余时间的人类可读形式：45秒 / 3分20秒 / 12分钟 */
private fun formatDuration(seconds: Long): String = when {
    seconds <= 0 -> "0 秒"
    seconds < 60 -> "$seconds 秒"
    seconds < 3600 -> {
        val m = seconds / 60
        val s = seconds % 60
        if (s == 0L) "$m 分钟" else "$m 分 $s 秒"
    }
    else -> "${seconds / 3600} 小时"
}
