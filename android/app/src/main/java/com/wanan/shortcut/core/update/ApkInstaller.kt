package com.wanan.shortcut.core.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * 安装引导：把下载好的 APK 交给系统安装器。
 *
 * ## Android 14+ 的硬约束（这是"热更新"做不到的根因）
 *
 * | 版本 | 行为 |
 * |---|---|
 * | Android 14 | 安装来源 App 不能再"一次授权永久有效"，**每次安装都要用户再确认** |
 * | Android 15 | **静默安装全面封杀**：非用户主动点击触发的安装会被拦 |
 *
 * 也就是说：**我们能做的是"把安装对话框送到用户面前"，点确认这一步必须用户自己做。**
 * 任何声称"完全无感"的方案在 Android 14+ 都不成立。
 *
 * ## 为什么需要 FileProvider
 *
 * Android 7+ 禁止把 `file://` URI 暴露给其它 App（否则抛 `FileUriExposedException`）。
 * 必须用 `FileProvider.getUriForFile()` 生成 `content://` URI，
 * 并在 Manifest 里声明 provider 与可用的路径。
 */
object ApkInstaller {

    /**
     * 触发安装。
     *
     * @return true 表示已把安装界面交给系统；false 表示缺少"安装未知应用"权限，
     *         调用方应引导用户去设置页授予（[installPermissionIntent]）
     */
    fun install(context: Context, apkFile: File): Boolean {
        if (!apkFile.exists()) return false

        // Android 8.0+ 需要显式检查"是否允许安装未知来源应用"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !canInstall(context)) {
            return false
        }

        val uri: Uri = try {
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apkFile,
            )
        } catch (t: Throwable) {
            // FileProvider 未正确配置时会抛（IllegalArgumentException）
            return false
        }

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            // 必须加这两个 flag：否则系统安装器读不到 content:// URI
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        return try {
            context.startActivity(intent)
            true
        } catch (t: Throwable) {
            // 设备可能没有安装器（极少数定制 ROM）
            false
        }
    }

    /** 当前是否已允许本 App 安装未知来源应用。 */
    fun canInstall(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }

    /**
     * 跳到"允许安装未知应用"的系统设置页。
     *
     * 用户拒绝后不要反复弹同一个对话框 —— 应该给一个明确的"去设置"入口。
     */
    fun installPermissionIntent(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
}
