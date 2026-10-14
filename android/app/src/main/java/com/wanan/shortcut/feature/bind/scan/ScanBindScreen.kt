package com.wanan.shortcut.feature.bind.scan

import android.Manifest
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.wanan.shortcut.ui.theme.Spacing
import java.util.concurrent.Executors

/**
 * 扫码绑定界面（对齐 web 的「扫码绑定」）。
 *
 * ## 三重兜底（与 web `startScanner()` 的设计一致）
 *
 * web 在摄像头不可用/被拒时会明确引导用户改用：
 *   1. 实时扫摄像头；
 *   2. **从相册选二维码图片**；
 *   3. 手输 6 位绑定码。
 *
 * 安卓端同样三手准备 —— 因为真机上相机权限被拒、或桌面二维码是**截图**的情况很常见。
 *
 * ## 为什么用 ML Kit 打包版 + CameraX
 *
 * - `barcode-scanning`（非 `play-services-mlkit-*`）：模型随 APK 走，
 *   不依赖设备上的 Google Play 服务。目标机型是 OPPO/ColorOS，
 *   走 play-services 版很可能在无 GMS 的设备上不可用。
 * - CameraX 负责预览与帧分析，ML Kit 负责解码。
 */
@Composable
fun ScanBindScreen(
    onClose: () -> Unit,
    onRecognized: (raw: String) -> Unit,
) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED,
        )
    }
    var status by remember { mutableStateOf("将桌面端二维码放入框内") }
    var permissionAsked by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasCameraPermission = granted
        if (!granted) {
            // 与 web 一致：被拒时明确告诉用户还有别的路，而不是只说失败
            status = "摄像头权限被拒绝，可用「从相册选二维码图片」，或返回用手输绑定码"
        }
    }

    // 相册兜底：选一张二维码截图
    val galleryLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        status = "正在识别图片…"
        decodeImageUri(context, uri) { raw ->
            if (raw.isNullOrBlank()) {
                status = "图片中没识别到二维码，换一张或用手输绑定码"
            } else {
                onRecognized(raw)
            }
        }
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission && !permissionAsked) {
            permissionAsked = true
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Column(
        Modifier.fillMaxWidth().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Text(
            text = "扫描桌面端二维码",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = "在电脑端 ShortCut「联动绑定」里显示二维码，用这里扫一下即可连接。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerLowest),
            contentAlignment = Alignment.Center,
        ) {
            if (hasCameraPermission) {
                CameraPreview(
                    onBarcode = { raw ->
                        // 识别成功就立刻回报；调用方负责关闭本界面，
                        // 避免同一码被连续触发多次绑定
                        onRecognized(raw)
                    },
                )
            } else {
                Text(
                    text = "摄像头不可用",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Text(
            text = status,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )

        Button(
            onClick = {
                galleryLauncher.launch(
                    androidx.activity.result.PickVisualMediaRequest(
                        ActivityResultContracts.PickVisualMedia.ImageOnly,
                    ),
                )
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("从相册选二维码图片")
        }

        TextButton(onClick = onClose, modifier = Modifier.fillMaxWidth()) {
            Text("返回手输绑定码")
        }
    }
}

/**
 * CameraX 预览 + ML Kit 实时解码。
 *
 * 用 `AndroidView` 承载 `PreviewView`（CameraX 的原生视图），
 * 这是 CameraX 与 Compose 配合的标准做法 —— CameraX 没有 Compose 版本。
 */
@Composable
private fun CameraPreview(onBarcode: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // 只解码一次：二维码在镜头前会持续被识别，不去重会连发多次绑定请求
    var consumed by remember { mutableStateOf(false) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }

    DisposableEffect(Unit) {
        onDispose {
            scanner.close()
            executor.shutdown()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }

            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()

                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val analysis = ImageAnalysis.Builder()
                    // 只保留最新帧：解码跟不上时丢帧，避免延迟堆积
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                analysis.setAnalyzer(executor) { imageProxy: ImageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage == null || consumed) {
                        imageProxy.close()
                        return@setAnalyzer
                    }
                    val input = InputImage.fromMediaImage(
                        mediaImage,
                        imageProxy.imageInfo.rotationDegrees,
                    )
                    scanner.process(input)
                        .addOnSuccessListener { barcodes ->
                            if (consumed) return@addOnSuccessListener
                            val raw = barcodes.firstNotNullOfOrNull { barcode ->
                                when (barcode.valueType) {
                                    Barcode.TYPE_URL, Barcode.TYPE_TEXT -> barcode.rawValue
                                    else -> barcode.rawValue
                                }
                            }
                            if (!raw.isNullOrBlank()) {
                                consumed = true
                                onBarcode(raw)
                            }
                        }
                        .addOnCompleteListener { imageProxy.close() }
                }

                try {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,   // 后置摄像头扫二维码
                        preview,
                        analysis,
                    )
                } catch (t: Throwable) {
                    // 绑定失败不崩溃：界面仍可走相册/手输兜底
                }
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        },
    )
}

/**
 * 从相册图片里解码二维码（对齐 web 的 `recognizeImageFromFile`）。
 *
 * 用 ML Kit 的 `InputImage.fromFilePath`，它内部会处理 EXIF 旋转，
 * 所以竖拍/横拍的截图都能识别。
 */
private fun decodeImageUri(
    context: Context,
    uri: Uri,
    onResult: (String?) -> Unit,
) {
    val scanner = BarcodeScanning.getClient()
    try {
        val image = InputImage.fromFilePath(context, uri)
        scanner.process(image)
            .addOnSuccessListener { barcodes ->
                onResult(barcodes.firstNotNullOfOrNull { it.rawValue })
            }
            .addOnFailureListener { onResult(null) }
            .addOnCompleteListener { scanner.close() }
    } catch (t: Throwable) {
        // 图片读不出来（格式/权限）也不能崩
        scanner.close()
        onResult(null)
    }
}
