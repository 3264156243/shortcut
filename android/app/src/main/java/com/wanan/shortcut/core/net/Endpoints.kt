package com.wanan.shortcut.core.net

/**
 * 所有网络地址的唯一真源。
 *
 * 规定：**任何其它文件都不允许出现字符串字面量的域名/路径**。
 * 换测试环境、加新接口，只改这里；也让"明文只用于局域网"这条约束可被审查。
 */
object Endpoints {

    /** 云端主域名（契约 §1.1：云域名只有一个） */
    const val CLOUD_BASE = "https://shortcut.326415.xyz"

    /** 所有 JSON 接口（仅 POST） */
    const val API = "$CLOUD_BASE/sync/api.php"

    /** 文件分片上传 / 下载（真实 HTTP 状态码） */
    const val FILE = "$CLOUD_BASE/sync/file.php"

    /** 实时通道（WebSocket） */
    const val RELAY_WS = "wss://shortcut.326415.xyz/relay-ws"

    /** 移动 Web 共享 SDK（作为参考实现可读，非规范） */
    const val SDK_REFERENCE = "$CLOUD_BASE/sync/sdk.php"

    /**
     * 安卓端版本清单（**静态文件，不是 sync API**）。
     *
     * 与桌面端的更新目录**平级**：
     * ```
     * https://shortcut.326415.xyz/updates/
     * ├── latest.yml              ← 桌面端（electron-updater）
     * ├── ShortCut-x.x.x-Setup.exe
     * └── android/                ← 安卓端
     *     ├── latest.json          ← 本常量
     *     └── ShortCut-x.x.x.apk
     * ```
     *
     * 字段设计借鉴桌面端 `latest.yml`（版本/大小/sha256/更新说明），
     * 但判据换成 `versionCode`（见 `core/update/UpdateManifest`）。
     */
    const val ANDROID_UPDATE_MANIFEST = "$CLOUD_BASE/updates/android/latest.json"

    /** 安卓端 APK 的下载目录（清单里的 apkUrl 也指向这个目录） */
    const val ANDROID_UPDATE_DIR = "$CLOUD_BASE/updates/android"

    /**
     * 局域网直连基地址。
     *
     * ⚠️ 契约 §8.5-2：**不要缓存 IP**，每次「一键直连」都要重新经云端 WS 问 `/api/lan-entry`。
     * 这里只提供拼接方法，不提供缓存字段——从类型上防止有人缓存。
     */
    fun lanBase(ip: String, port: Int): String = "http://$ip:$port"
}
