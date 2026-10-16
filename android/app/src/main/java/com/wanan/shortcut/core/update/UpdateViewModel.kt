package com.wanan.shortcut.core.update

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wanan.shortcut.BuildConfig
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

/**
 * 更新流程状态。
 *
 * 用密封类而非多个 boolean：避免"正在下载"与"下载失败"同时为真这类矛盾状态。
 */
sealed interface UpdateUiState {

    /** 空闲（还没检查过） */
    data object Idle : UpdateUiState

    /** 正在检查版本 */
    data object Checking : UpdateUiState

    /** 已是最新 */
    data class UpToDate(val currentVersionName: String) : UpdateUiState

    /** 发现新版本，等待用户决定 */
    data class Available(val manifest: UpdateManifest) : UpdateUiState

    /** 服务端要求"重装"而非"升级"（版本过低/签名变更等） */
    data class RequiresFreshInstall(val manifest: UpdateManifest) : UpdateUiState

    /** 正在下载 */
    data class Downloading(
        val manifest: UpdateManifest,
        val downloaded: Long,
        val total: Long,
        val fileName: String,
    ) : UpdateUiState {
        /** 0f..1f；总大小未知时返回 0f */
        val progress: Float get() = if (total > 0) (downloaded.toFloat() / total).coerceIn(0f, 1f) else 0f
    }

    /**
     * 下载完成，等待用户点"安装"。
     *
     * 刻意**不自动**拉起安装界面：用户可能正在做别的事，
     * 突然弹出安装框是打扰（web 端也没有这种打扰）。
     */
    data class ReadyToInstall(val manifest: UpdateManifest, val apkFile: File) : UpdateUiState

    /** 检查失败（网络等）。[silent] 为 true 表示这是启动时的静默检查，不该打扰用户。 */
    data class Failed(val message: String, val silent: Boolean = false) : UpdateUiState
}

/**
 * 更新 ViewModel。
 *
 * ## 两个入口
 *
 * - **启动时静默检查**：拉了清单但只在"有新版本"时才提示；
 *   网络失败**不打扰**（用户可能只是想用 App，不是来更新的）。
 * - **设置页手动检查**：任何结果都给反馈（包括"已是最新"与失败原因），
 *   因为用户明确点了按钮，没反应会让人以为坏了。
 */
class UpdateViewModel(
    private val client: UpdateClient = UpdateClient(),
) : ViewModel() {

    private val _state = MutableStateFlow<UpdateUiState>(UpdateUiState.Idle)
    val state: StateFlow<UpdateUiState> = _state.asStateFlow()

    /**
     * 检查更新。
     *
     * @param silent true = 启动时静默检查（失败静默、无更新静默）
     */
    fun check(silent: Boolean) {
        if (_state.value is UpdateUiState.Checking) return
        if (_state.value is UpdateUiState.Downloading) return

        viewModelScope.launch {
            if (!silent) _state.value = UpdateUiState.Checking

            when (val r = client.fetchManifest()) {
                is ApiResult.Ok -> {
                    val manifest = r.data
                    val current = BuildConfig.VERSION_CODE

                    _state.value = when {
                        // 版本过低（服务端要求重装）优先于"有更新"判断
                        manifest.requiresFreshInstall(current) ->
                            UpdateUiState.RequiresFreshInstall(manifest)

                        manifest.isNewerThan(current) -> UpdateUiState.Available(manifest)

                        // 无更新：手动检查时明确告知，静默检查时什么都不做
                        silent -> UpdateUiState.Idle

                        else -> UpdateUiState.UpToDate(BuildConfig.VERSION_NAME)
                    }
                }

                is ApiResult.BusinessFail -> {
                    _state.value = if (silent) {
                        // 静默检查失败不显示（服务端暂时没配置清单也算这类）
                        UpdateUiState.Idle
                    } else {
                        UpdateUiState.Failed(r.message)
                    }
                }

                is ApiResult.TransportFail -> {
                    _state.value = if (silent) {
                        UpdateUiState.Idle
                    } else {
                        UpdateUiState.Failed("网络不可用，请检查网络后重试")
                    }
                }

                ApiResult.Unauthorized -> {
                    // 更新检查不需要身份，走到这里说明响应异常
                    _state.value = if (silent) UpdateUiState.Idle
                    else UpdateUiState.Failed("检查更新失败")
                }
            }
        }
    }

    /** 下载新版本 APK */
    fun download(context: Context, manifest: UpdateManifest) {
        if (_state.value is UpdateUiState.Downloading) return

        val fileName = manifest.apkUrl.substringAfterLast('/').ifBlank { "shortcut-update.apk" }
        val target = apkFile(context, fileName)

        viewModelScope.launch {
            _state.value = UpdateUiState.Downloading(
                manifest = manifest,
                downloaded = 0,
                total = manifest.size,
                fileName = fileName,
            )

            val result = client.download(manifest, target) { downloaded, total ->
                // 回调在 IO 线程；StateFlow 是线程安全的，直接更新
                _state.value = UpdateUiState.Downloading(
                    manifest = manifest,
                    downloaded = downloaded,
                    total = if (total > 0) total else manifest.size,
                    fileName = fileName,
                )
            }

            _state.value = when (result) {
                is ApiResult.Ok -> UpdateUiState.ReadyToInstall(manifest, result.data)
                is ApiResult.BusinessFail -> UpdateUiState.Failed(result.message)
                is ApiResult.TransportFail -> UpdateUiState.Failed("下载失败，请检查网络后重试")
                ApiResult.Unauthorized -> UpdateUiState.Failed("下载失败")
            }
        }
    }

    /**
     * 把已下载的 APK 交给系统安装器。
     *
     * @return true = 安装界面已弹出；false = 缺少"安装未知应用"权限（调用方应引导去设置）
     */
    fun install(context: Context, apkFile: File): Boolean =
        ApkInstaller.install(context, apkFile)

    /** 用户点了"以后再说"：回到 Idle，避免反复弹窗 */
    fun dismiss() {
        if (_state.value is UpdateUiState.Available ||
            _state.value is UpdateUiState.RequiresFreshInstall
        ) {
            _state.value = UpdateUiState.Idle
        }
    }

    /** 下载失败后重试：需要重新拿到清单（[UpdateUiState] 里没存 manifest 时） */
    fun reset() {
        _state.value = UpdateUiState.Idle
    }

    /** 消费一次性的失败提示（UI 显示过就清掉） */
    fun consumeFailure() {
        if (_state.value is UpdateUiState.Failed) _state.value = UpdateUiState.Idle
    }

    /**
     * APK 落盘位置。
     *
     * 用 `getExternalFilesDir`（应用专属外部目录，**免存储权限**），
     * 与 `file_paths.xml` 里声明的 `updates/` 对应。
     * 外部目录不可用时回落到内部 `filesDir`。
     */
    private fun apkFile(context: Context, fileName: String): File {
        val base = context.getExternalFilesDir(null) ?: context.filesDir
        val dir = File(base, "updates")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, fileName)
    }
}
