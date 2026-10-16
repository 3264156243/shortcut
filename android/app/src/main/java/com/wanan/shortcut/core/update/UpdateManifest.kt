package com.wanan.shortcut.core.update

import com.google.gson.annotations.SerializedName

/**
 * 服务端下发的版本清单（`updates/android/latest.json`）。
 *
 * ## 字段设计的取舍：为什么**以 versionCode 为准**，而不是 versionName
 *
 * 桌面端用 `version` 字符串比较（`latest.yml`）。安卓端**不能照抄**：
 * 字符串比较会出错（`"0.10.0"` 按字典序小于 `"0.9.0"`），
 * 而且 Android 系统本身就是按 `versionCode` 判断"能不能覆盖安装"。
 *
 * 所以这里 `versionCode` 是**唯一判据**，`versionName` 只用于显示。
 */
data class UpdateManifest(
    /** 递增整数，**更新的唯一判据** */
    @SerializedName("versionCode") val versionCode: Int = 0,
    /** 展示用版本名，如 `0.2.0` */
    @SerializedName("versionName") val versionName: String = "",
    /** APK 直链（https） */
    @SerializedName("apkUrl") val apkUrl: String = "",
    /** APK 的 sha256（小写 hex）。下载后校验，防止装到损坏/被替换的包 */
    @SerializedName("sha256") val sha256: String = "",
    /** 字节数，用于显示大小与进度 */
    @SerializedName("size") val size: Long = 0L,
    /** 更新说明（Markdown，由 `release-notes/` 生成，与桌面端同一套习惯） */
    @SerializedName("releaseNotes") val releaseNotes: String = "",
    /** 发布时间（ISO-8601） */
    @SerializedName("releaseDate") val releaseDate: String = "",
    /**
     * 允许升级的最低 versionCode 下限。
     *
     * 用途：若某次改动**破坏性**（例如换了签名、或数据结构不兼容），
     * 可把旧版本标为"必须重装"而不是"升级"。
     * 为 0 表示不做限制。
     */
    @SerializedName("minSupportedVersionCode") val minSupportedVersionCode: Int = 0,
) {
    /** 该清单是否可用（缺关键字段就不能拿去下载） */
    val isUsable: Boolean
        get() = versionCode > 0 && apkUrl.isNotBlank() && sha256.isNotBlank()

    /**
     * 相对 [currentVersionCode] 是否有更新。
     *
     * 判据只有一条：**versionCode 严格更大**。
     * 相等或更小都视为"已是最新"（服务端回滚版本时不该提示用户"降级"）。
     */
    fun isNewerThan(currentVersionCode: Int): Boolean = versionCode > currentVersionCode

    /**
     * 是否已低到"只能重装"。
     *
     * 仅当本机 versionCode **低于**服务端要求的下限时为 true。
     */
    fun requiresFreshInstall(currentVersionCode: Int): Boolean =
        minSupportedVersionCode > 0 && currentVersionCode < minSupportedVersionCode
}
