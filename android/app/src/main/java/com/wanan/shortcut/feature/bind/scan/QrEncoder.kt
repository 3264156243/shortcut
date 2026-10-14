package com.wanan.shortcut.feature.bind.scan

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * 二维码生成。
 *
 * ## 用途（对齐 web 已绑定态）
 *
 * web `/bind/` 在已绑定时会渲染一张"桌面绑定链接"二维码
 * （`https://shortcut.326415.xyz/mobile/?bind=<bindId>`），
 * 让**另一台手机**扫码即可接入同一台电脑。安卓端提供同等能力。
 *
 * ## 为什么用 zxing 而不自己写
 *
 * 二维码编码涉及 Reed-Solomon 纠错、掩码评估、格式信息等，
 * 是 1000+ 行的确定性算法。自研既无收益又必然引入 bug，
 * 所以引 `com.google.zxing:core`（纯 Java，无 Android 依赖）。
 *
 * 生成失败（例如文本超长超出二维码容量）返回 null，由调用方降级为显示链接文本 —— 不崩溃。
 */
object QrEncoder {

    /** 二维码最大可容纳的字符数（版本 40 / 纠错 L 级，约 2900 字节）。留足余量。 */
    private const val MAX_CHARS = 2000

    /**
     * 把文本编码成正方形位图。
     *
     * @param sizePx 输出边长（像素）。二维码是方形的，取宽高一致。
     * @return 成功返回位图；失败返回 null（调用方应降级处理）
     */
    fun encodeToBitmap(text: String, sizePx: Int = 512): Bitmap? {
        if (text.isBlank() || text.length > MAX_CHARS) return null

        return try {
            val hints = mapOf(
                EncodeHintType.CHARACTER_SET to "UTF-8",
                // 纠错等级 M：印刷/屏幕显示场景下容错足够，且不像 H 那样牺牲容量
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
                // 白边（静区）：扫码器识别需要，取 1 个模块宽即可（外层还会加 padding）
                EncodeHintType.MARGIN to 1,
            )

            val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
            val width = matrix.width
            val height = matrix.height

            val pixels = IntArray(width * height)
            for (y in 0 until height) {
                val offset = y * width
                for (x in 0 until width) {
                    pixels[offset + x] = if (matrix[x, y]) Color.BLACK else Color.WHITE
                }
            }

            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply {
                setPixels(pixels, 0, width, 0, 0, width, height)
            }
        } catch (t: Throwable) {
            // zxing 在内容超容量时抛 WriterException；不区分异常类型，统一降级
            null
        }
    }
}
