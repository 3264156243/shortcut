package com.wanan.shortcut.feature.bind

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wanan.shortcut.core.net.Endpoints
import com.wanan.shortcut.feature.bind.scan.ScanBindScreen
import com.wanan.shortcut.feature.bind.scan.ScanPayloadParser
import com.wanan.shortcut.ui.components.InfoRow
import com.wanan.shortcut.ui.components.InlineError
import com.wanan.shortcut.ui.components.ScCard
import com.wanan.shortcut.ui.components.SectionHeader
import com.wanan.shortcut.ui.components.StatusDot
import com.wanan.shortcut.ui.containerViewModel
import com.wanan.shortcut.ui.theme.IconSizes
import com.wanan.shortcut.ui.theme.Radii
import com.wanan.shortcut.ui.theme.Sizes
import com.wanan.shortcut.ui.theme.Spacing

/**
 * 绑定页（对齐 web `/bind/` 的三重入口）。
 *
 * ## 与 web 的能力对照
 *
 * | web 入口 | 本页 |
 * |---|---|
 * | 6 位绑定码 + 「绑定码连接」 | ✅ 手输 |
 * | **「扫码绑定」按钮 → 摄像头 / 相册** | ✅ 用 ML Kit + CameraX |
 * | **`?bind=` 直链进入时自动绑定** | ✅ 见 [initialBindId] |
 * | 已绑定态：设备信息 + **二维码（可被别的手机扫）** + 「更换绑定」 | ✅ |
 *
 * ## 我之前漏掉的
 *
 * 最初只做了手输绑定码，漏了 web 的扫码入口 —— 用户直接指出了这点。
 * 现在按 web 的行为逐条补齐。
 *
 * @param initialBindId 从外部链接/二维码进入时带进来的 bindId（对应 web 的 `?bind=`）。
 *        非空且当前未绑定时会**自动绑定**（与 web `init()` 一致）。
 */
@Composable
fun BindScreen(
    onBound: () -> Unit,
    initialBindId: String? = null,
    viewModel: BindViewModel = containerViewModel { it.bindViewModel() },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val identity by viewModel.identity.collectAsStateWithLifecycle()

    var code by remember { mutableStateOf("") }
    var deviceName by remember { mutableStateOf("") }
    var showScanner by remember { mutableStateOf(false) }
    var showUnbindConfirm by remember { mutableStateOf(false) }
    var autoBindTried by remember { mutableStateOf(false) }

    LaunchedEffect(state) {
        if (state is BindUiState.Success) onBound()
    }

    // 契约 §2.6 的 bindId 优先路径：带 bindId 进来就直接绑定（web init() 的行为）
    LaunchedEffect(initialBindId, identity.isBound) {
        if (!initialBindId.isNullOrBlank() && !identity.isBound && !autoBindTried) {
            autoBindTried = true
            viewModel.bindWithBindId(initialBindId)
        }
    }

    // 扫码界面：识别成功即关闭并走绑定（bindId 优先，否则当 6 位码）
    if (showScanner) {
        ScanBindScreen(
            onClose = { showScanner = false },
            onRecognized = { raw ->
                showScanner = false
                val parsed = ScanPayloadParser.parse(raw)
                when {
                    // 二维码是桌面端绑定链接 → 用 bindId（契约 §2.6：优先且跳过 code 校验）
                    !parsed.bindId.isNullOrBlank() -> {
                        code = ""
                        viewModel.bind(codeInput = "", deviceName = deviceName, bindIdFromScan = parsed.bindId)
                    }
                    // 二维码里是 6 位码
                    !parsed.code.isNullOrBlank() -> {
                        code = parsed.code
                        viewModel.bind(codeInput = parsed.code, deviceName = deviceName)
                    }
                    // 认出来了但不是有效二维码
                    else -> Unit
                }
            },
        )
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (identity.isBound) {
            BoundSection(
                bindId = identity.bindId,
                deviceId = identity.deviceId,
                deviceName = identity.deviceName,
                onUnbind = { showUnbindConfirm = true },
            )
        } else {
            UnboundSection(
                code = code,
                deviceName = deviceName,
                submitting = state is BindUiState.Submitting,
                failMessage = (state as? BindUiState.Failed)?.message,
                onCodeChange = { input ->
                    // 只允许 6 位字母数字并统一大写（契约 §2.2：绑定码是 [0-9A-Z]）
                    code = input.filter { it.isLetterOrDigit() }.take(6).uppercase()
                    viewModel.resetError()
                },
                onDeviceNameChange = { deviceName = it.take(30) },
                onBind = { viewModel.bind(code, deviceName) },
                onScan = { showScanner = true },
            )
        }
    }

    if (showUnbindConfirm) {
        AlertDialog(
            onDismissRequest = { showUnbindConfirm = false },
            title = { Text("更换绑定") },
            text = { Text("更换后需要重新连接电脑，确定吗？") },
            confirmButton = {
                TextButton(onClick = {
                    showUnbindConfirm = false
                    viewModel.unbind()
                }) { Text("更换") }
            },
            dismissButton = {
                TextButton(onClick = { showUnbindConfirm = false }) { Text("取消") }
            },
        )
    }
}

// ---------------- 未绑定 ----------------

@Composable
private fun UnboundSection(
    code: String,
    deviceName: String,
    submitting: Boolean,
    failMessage: String?,
    onCodeChange: (String) -> Unit,
    onDeviceNameChange: (String) -> Unit,
    onBind: () -> Unit,
    onScan: () -> Unit,
) {
    // 顶部说明：图标 + 标题 + 说明（对齐 web `.card h1/p`）
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
            text = "连接你的电脑",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = "在电脑端 ShortCut「设置 → 联动绑定」查看 6 位绑定码或二维码。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }

    ScCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            OutlinedTextField(
                value = code,
                onValueChange = onCodeChange,
                label = { Text("6 位绑定码") },
                placeholder = { Text("ABC123") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Next,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = deviceName,
                onValueChange = onDeviceNameChange,
                label = { Text("设备名称（可选）") },
                placeholder = { Text("我的手机") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )

            failMessage?.let { InlineError(message = it) }

            // 两个入口并排 —— 与 web 的 `.grid2`（绑定码连接 / 扫码绑定）一致
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Button(
                    onClick = onBind,
                    enabled = !submitting && code.length == 6,
                    modifier = Modifier.weight(1f),
                ) {
                    if (submitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp).padding(end = Spacing.xs),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp,
                        )
                    }
                    Text(if (submitting) "连接中…" else "绑定码连接")
                }

                OutlinedButton(
                    onClick = onScan,
                    enabled = !submitting,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("扫码绑定")
                }
            }
        }
    }

    Text(
        text = "绑定后可用任务墙、文件共享、电脑控制；本机功能（如笔记）不需要绑定也能用。",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm),
    )
}

// ---------------- 已绑定 ----------------

@Composable
private fun BoundSection(
    bindId: String,
    deviceId: String,
    deviceName: String,
    onUnbind: () -> Unit,
) {
    SectionHeader(title = "当前绑定")

    ScCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                Box(
                    modifier = Modifier
                        .size(Sizes.listIcon)
                        .clip(RoundedCornerShape(Radii.sm))
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = "📱", fontSize = IconSizes.list)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        text = deviceName.ifBlank { "我的手机" },
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        StatusDot(online = true)
                        Text(
                            text = "已连接",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            InfoRow("绑定 ID", bindId)
            if (deviceId.isNotBlank()) InfoRow("设备 ID", deviceId)
        }
    }

    // 二维码：web 在已绑定态会渲染"桌面绑定链接"的二维码，
    // 便于**其它手机**扫码直接接入同一台电脑（对应 web `renderQR(bindUrl)`）。
    SectionHeader(title = "让其它手机加入")
    ScCard {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            val bindUrl = remember(bindId) { "${Endpoints.CLOUD_BASE}/mobile/?bind=$bindId" }
            QrCodeImage(text = bindUrl)

            Text(
                text = "用另一台手机的 ShortCut 扫这个二维码，即可连接到同一台电脑。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Text(
                text = bindUrl,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }

    OutlinedButton(
        onClick = onUnbind,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text("更换绑定", color = MaterialTheme.colorScheme.error)
    }
}

/**
 * 二维码渲染。
 *
 * ## 为什么自己写编码器而不是引第三方库
 *
 * 需求只有一个：把一段 URL 编成二维码。
 * 引一个 QR 库（如 zxing）会多一个依赖与体积；
 * 而二维码编码算法是确定性的、可自测的，实现在
 * [com.wanan.shortcut.feature.bind.scan.QrEncoder] 里，并有单测覆盖。
 *
 * 生成失败（极端长文本）时降级为只显示链接文本，不崩溃。
 */
@Composable
private fun QrCodeImage(text: String) {
    val bitmap: Bitmap? = remember(text) {
        com.wanan.shortcut.feature.bind.scan.QrEncoder.encodeToBitmap(text, sizePx = 512)
    }

    if (bitmap == null) {
        Text(
            text = "（二维码生成失败，可直接复制上方链接）",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.error,
        )
        return
    }

    Box(
        modifier = Modifier
            .size(200.dp)
            .clip(RoundedCornerShape(Radii.sm))
            .background(androidx.compose.ui.graphics.Color.White)
            .padding(Spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = "绑定二维码",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
