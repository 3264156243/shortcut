package com.wanan.shortcut.feature.linked.transfer

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wanan.shortcut.core.blob.BlobEngine
import com.wanan.shortcut.core.error.ErrorAction
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream

/**
 * 文件共享界面状态。
 */
data class TransferUiState(
    val messages: List<TransferMessage> = emptyList(),
    val loading: Boolean = true,
    /** 顶部提示（发送成功/失败等），由 UI 消费后清空 */
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    /** 正在上传的文件名（null 表示空闲） */
    val uploadingName: String? = null,
    /** 上传进度 0f..1f */
    val uploadProgress: Float = 0f,
    /** 正在下载的文件名 */
    val downloadingName: String? = null,
)

/** 共享面板状态 */
data class ShareUiState(
    val shares: List<ShareItem> = emptyList(),
    val loading: Boolean = false,
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    /** 创建共享后返回的接收密码（UI 用来突出展示） */
    val lastCreatedCode: String? = null,
)

/**
 * 文件共享 ViewModel。
 *
 * ## 与 web 参考实现对齐的两处行为
 *
 * 1. **3 秒轮询消息列表**（web：`pollTimer = setInterval(loadMessages, 3000)`）。
 *    契约没有推送消息的接口，轮询是唯一手段。
 * 2. **删除后重拉列表**（web 删完就 `loadMessages()`），保证 UI 与服务端一致。
 */
class TransferViewModel(
    private val repository: TransferRepository,
    private val errorMapper: ErrorMapper,
) : ViewModel() {

    private val _state = MutableStateFlow(TransferUiState())
    val state: StateFlow<TransferUiState> = _state.asStateFlow()

    private val _shareState = MutableStateFlow(ShareUiState())
    val shareState: StateFlow<ShareUiState> = _shareState.asStateFlow()

    private var pollJob: Job? = null

    init {
        refresh()
    }

    /** 开始轮询（界面可见时调用）。web 是 3 秒。 */
    fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                delay(POLL_INTERVAL_MS)
                loadMessages(silent = true)
            }
        }
    }

    /** 停止轮询（界面离开时调用，避免后台白耗电与流量） */
    fun stopPolling() {
        pollJob?.cancel()
        pollJob = null
    }

    override fun onCleared() {
        stopPolling()
        super.onCleared()
    }

    /** 手动/首次拉取 */
    fun refresh() {
        loadMessages(silent = false)
    }

    private fun loadMessages(silent: Boolean) {
        viewModelScope.launch {
            if (!silent) _state.value = _state.value.copy(loading = true)

            when (val r = repository.messages()) {
                is ApiResult.Ok -> _state.value = _state.value.copy(
                    messages = r.data.messages,
                    loading = false,
                )
                is ApiResult.BusinessFail -> if (!silent) {
                    _state.value = _state.value.copy(
                        loading = false,
                        notice = describe(r.message),
                        noticeIsError = true,
                    )
                }
                is ApiResult.TransportFail -> if (!silent) {
                    // 轮询失败不打扰用户（网络抖动很常见）；手动刷新才提示
                    _state.value = _state.value.copy(
                        loading = false,
                        notice = "网络不可用，请检查网络",
                        noticeIsError = true,
                    )
                }
                ApiResult.Unauthorized -> _state.value = _state.value.copy(loading = false)
            }
        }
    }

    /** 发送文本 */
    fun sendText(text: String) {
        val v = text.trim()
        if (v.isEmpty()) return

        viewModelScope.launch {
            when (val r = repository.sendText(v)) {
                is ApiResult.Ok -> {
                    _state.value = _state.value.copy(notice = null)
                    loadMessages(silent = true)
                }
                is ApiResult.BusinessFail -> notice(describe(r.message), isError = true)
                is ApiResult.TransportFail -> notice("发送失败，请检查网络", isError = true)
                ApiResult.Unauthorized -> notice("请先连接电脑", isError = true)
            }
        }
    }

    /**
     * 上传并发送文件（契约 §6.1 全流程）。
     *
     * @param uri 从系统文件选择器拿到的 URI
     */
    fun sendFile(
        context: Context,
        uri: Uri,
        displayName: String,
        mime: String,
        size: Long,
    ) {
        viewModelScope.launch {
            _state.value = _state.value.copy(
                uploadingName = displayName,
                uploadProgress = 0f,
                notice = null,
            )

            val result = repository.blobs.uploadUri(
                context = context,
                uri = uri,
                displayName = displayName,
                mime = mime,
                size = size,
                onProgress = { sent, total ->
                    val ratio = if (total > 0) sent.toFloat() / total.toFloat() else 0f
                    _state.value = _state.value.copy(uploadProgress = ratio.coerceIn(0f, 1f))
                },
            )

            _state.value = _state.value.copy(uploadingName = null, uploadProgress = 0f)

            when (result) {
                is ApiResult.Ok -> {
                    notice("已发送：${result.data.name}")
                    loadMessages(silent = true)
                }
                is ApiResult.BusinessFail -> notice(describe(result.message), isError = true)
                is ApiResult.TransportFail -> notice("上传失败，请检查网络", isError = true)
                ApiResult.Unauthorized -> notice("请先连接电脑", isError = true)
            }
        }
    }

    /**
     * 删除一条消息（契约 §6.7）。
     *
     * ⚠️ `deleted:false` 仍是 `success:true` —— 但那不算失败，
     * 所以只有真正的失败（业务失败/传输失败）才提示。
     */
    fun deleteMessage(messageId: String) {
        viewModelScope.launch {
            when (val r = repository.delete(messageId)) {
                is ApiResult.Ok -> loadMessages(silent = true)
                is ApiResult.BusinessFail -> notice(describe(r.message), isError = true)
                is ApiResult.TransportFail -> notice("删除失败，请检查网络", isError = true)
                ApiResult.Unauthorized -> notice("请先连接电脑", isError = true)
            }
        }
    }

    /**
     * 下载文件到应用外部文件目录（`Downloads` 子目录）。
     *
     * 用 [BlobEngine] 的流式下载（契约 §6.6），单文件可达 1 GB，不能读进内存。
     *
     * @param downloadToken 非空表示"凭共享令牌下载"（别人共享给我的文件）
     */
    fun downloadFile(
        context: Context,
        fileId: String,
        fileName: String,
        downloadToken: String? = null,
    ) {
        viewModelScope.launch {
            _state.value = _state.value.copy(downloadingName = fileName, notice = null)

            val target = File(downloadDir(context), sanitizeFileName(fileName))
            val result = try {
                FileOutputStream(target).use { out ->
                    repository.blobs.download(
                        fileId = fileId,
                        sink = out,
                        downloadToken = downloadToken,
                    )
                }
            } catch (t: Throwable) {
                _state.value = _state.value.copy(downloadingName = null)
                notice("无法写入文件：${t.message ?: "未知错误"}", isError = true)
                return@launch
            }

            _state.value = _state.value.copy(downloadingName = null)

            when (result) {
                is ApiResult.Ok -> {
                    val data = result.data
                    if (!data.verified) {
                        // 校验和不符：文件已落盘但内容可疑 —— 明确告知，不要静默
                        notice("下载完成但校验和不符，文件可能已损坏", isError = true)
                    } else {
                        notice("已下载到 ${target.name}")
                    }
                }
                is ApiResult.BusinessFail -> notice(describe(result.message), isError = true)
                is ApiResult.TransportFail -> notice("下载失败，请检查网络", isError = true)
                ApiResult.Unauthorized -> notice("连接已失效，请重新绑定", isError = true)
            }
        }
    }

    // ---------------- 共享 ----------------

    fun loadShares() {
        viewModelScope.launch {
            _shareState.value = _shareState.value.copy(loading = true)
            when (val r = repository.shares()) {
                is ApiResult.Ok -> _shareState.value = _shareState.value.copy(
                    shares = r.data.shares,
                    loading = false,
                )
                is ApiResult.BusinessFail -> _shareState.value = _shareState.value.copy(
                    loading = false, notice = describe(r.message), noticeIsError = true,
                )
                is ApiResult.TransportFail -> _shareState.value = _shareState.value.copy(
                    loading = false, notice = "读取共享失败，请检查网络", noticeIsError = true,
                )
                ApiResult.Unauthorized -> _shareState.value = _shareState.value.copy(loading = false)
            }
        }
    }

    /** 创建文本共享 */
    fun shareText(text: String, code: String, hours: Double) {
        val v = text.trim()
        if (v.isEmpty()) {
            _shareState.value = _shareState.value.copy(notice = "请输入要共享的文本", noticeIsError = true)
            return
        }
        viewModelScope.launch {
            when (val r = repository.shareText(v, code, hours)) {
                is ApiResult.Ok -> {
                    _shareState.value = _shareState.value.copy(
                        notice = "共享成功", noticeIsError = false,
                        lastCreatedCode = r.data.code,
                    )
                    loadShares()
                }
                is ApiResult.BusinessFail -> _shareState.value = _shareState.value.copy(
                    notice = describe(r.message), noticeIsError = true,
                )
                is ApiResult.TransportFail -> _shareState.value = _shareState.value.copy(
                    notice = "共享失败，请检查网络", noticeIsError = true,
                )
                ApiResult.Unauthorized -> _shareState.value = _shareState.value.copy(
                    notice = "请先连接电脑", noticeIsError = true,
                )
            }
        }
    }

    /**
     * 上传文件并直接创建共享（web 的 `shareFile`）。
     *
     * 两步：先走完整上传拿到文件消息，再用它的 messageId 创建共享。
     */
    fun shareFile(
        context: Context,
        uri: Uri,
        displayName: String,
        mime: String,
        size: Long,
        code: String,
        hours: Double,
    ) {
        viewModelScope.launch {
            _shareState.value = _shareState.value.copy(
                notice = "正在上传文件…", noticeIsError = false, lastCreatedCode = null,
            )

            val uploaded = repository.blobs.uploadUri(
                context = context,
                uri = uri,
                displayName = displayName,
                mime = mime,
                size = size,
            )

            when (uploaded) {
                is ApiResult.Ok -> {
                    val messageId = uploaded.data.message.let { m ->
                        if (m.has("id") && !m.get("id").isJsonNull) m.get("id").asString else ""
                    }
                    if (messageId.isBlank()) {
                        _shareState.value = _shareState.value.copy(
                            notice = "文件上传后未取得标识", noticeIsError = true,
                        )
                        return@launch
                    }
                    when (val r = repository.shareFile(messageId, code, hours)) {
                        is ApiResult.Ok -> {
                            _shareState.value = _shareState.value.copy(
                                notice = "文件已共享", noticeIsError = false,
                                lastCreatedCode = r.data.code,
                            )
                            loadShares()
                        }
                        is ApiResult.BusinessFail -> _shareState.value = _shareState.value.copy(
                            notice = describe(r.message), noticeIsError = true,
                        )
                        is ApiResult.TransportFail -> _shareState.value = _shareState.value.copy(
                            notice = "共享失败，请检查网络", noticeIsError = true,
                        )
                        ApiResult.Unauthorized -> _shareState.value = _shareState.value.copy(
                            notice = "请先连接电脑", noticeIsError = true,
                        )
                    }
                }
                is ApiResult.BusinessFail -> _shareState.value = _shareState.value.copy(
                    notice = describe(uploaded.message), noticeIsError = true,
                )
                is ApiResult.TransportFail -> _shareState.value = _shareState.value.copy(
                    notice = "上传失败，请检查网络", noticeIsError = true,
                )
                ApiResult.Unauthorized -> _shareState.value = _shareState.value.copy(
                    notice = "请先连接电脑", noticeIsError = true,
                )
            }
        }
    }

    fun deleteShare(id: String) {
        viewModelScope.launch {
            when (val r = repository.shareDelete(id)) {
                is ApiResult.Ok -> loadShares()
                is ApiResult.BusinessFail -> _shareState.value = _shareState.value.copy(
                    notice = describe(r.message), noticeIsError = true,
                )
                is ApiResult.TransportFail -> _shareState.value = _shareState.value.copy(
                    notice = "删除失败，请检查网络", noticeIsError = true,
                )
                ApiResult.Unauthorized -> Unit
            }
        }
    }

    /**
     * 领取共享（**无需身份**，契约 §6.7）。
     *
     * 文本类：复制到手机剪贴板（由 UI 层做，VM 只回传内容）。
     * 文件类：拿到一次性 `downloadToken` 后下载。
     */
    fun claim(
        context: Context,
        code: String,
        onTextClaimed: (String) -> Unit,
    ) {
        val c = code.trim().uppercase()
        if (c.length != 6) {
            _shareState.value = _shareState.value.copy(notice = "请输入 6 位接收密码", noticeIsError = true)
            return
        }

        viewModelScope.launch {
            _shareState.value = _shareState.value.copy(notice = "正在领取…", noticeIsError = false)

            when (val r = repository.claim(c)) {
                is ApiResult.Ok -> {
                    val msg = r.data.message
                    when {
                        msg == null -> _shareState.value = _shareState.value.copy(
                            notice = "领取成功", noticeIsError = false,
                        )

                        msg.isFile && msg.fileId.isNotBlank() -> {
                            if (r.data.downloadToken.isBlank()) {
                                // 契约 §6.7：文件共享被领取过会没有令牌
                                _shareState.value = _shareState.value.copy(
                                    notice = "共享文件已被领取，请让共享者重新共享",
                                    noticeIsError = true,
                                )
                            } else {
                                _shareState.value = _shareState.value.copy(
                                    notice = "已开始下载：${msg.displayTitle}",
                                    noticeIsError = false,
                                )
                                downloadFile(
                                    context = context,
                                    fileId = msg.fileId,
                                    fileName = msg.name.ifBlank { "shared_file" },
                                    downloadToken = r.data.downloadToken,
                                )
                            }
                        }

                        msg.text.isNotBlank() -> {
                            onTextClaimed(msg.text)
                            _shareState.value = _shareState.value.copy(
                                notice = "共享文本已复制到剪贴板", noticeIsError = false,
                            )
                        }

                        else -> _shareState.value = _shareState.value.copy(
                            notice = "领取成功", noticeIsError = false,
                        )
                    }
                }
                is ApiResult.BusinessFail -> _shareState.value = _shareState.value.copy(
                    notice = describe(r.message), noticeIsError = true,
                )
                is ApiResult.TransportFail -> _shareState.value = _shareState.value.copy(
                    notice = "领取失败，请检查网络", noticeIsError = true,
                )
                ApiResult.Unauthorized -> _shareState.value = _shareState.value.copy(
                    notice = "领取失败", noticeIsError = true,
                )
            }
        }
    }

    /** 清掉一次性提示（UI 消费后调用） */
    fun consumeNotice() {
        if (_state.value.notice != null) _state.value = _state.value.copy(notice = null)
    }

    fun consumeShareNotice() {
        if (_shareState.value.notice != null) _shareState.value = _shareState.value.copy(notice = null)
    }

    private fun notice(text: String, isError: Boolean = false) {
        _state.value = _state.value.copy(notice = text, noticeIsError = isError)
    }

    /** 复用框架的 ErrorMapper 把服务端文案翻成用户能读懂的提示 */
    private fun describe(message: String): String = when (errorMapper.map(message)) {
        ErrorAction.RATE_LIMITED -> "操作太快了，请稍后再试"
        ErrorAction.REBIND -> "连接已失效，请重新绑定"
        ErrorAction.INVALID_INPUT -> message.ifBlank { "输入有误" }
        else -> message.ifBlank { "操作失败，请稍后再试" }
    }

    private fun downloadDir(context: Context): File {
        // 应用专属外部目录，免存储权限；用户在文件管理器里可见
        val dir = File(context.getExternalFilesDir(null) ?: context.filesDir, "downloads")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /** 文件名清洗：避免 `../` 之类穿越路径（文件名来自对端，属不可信输入） */
    private fun sanitizeFileName(name: String): String {
        val cleaned = name.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_").trim()
        return cleaned.ifBlank { "download_${System.currentTimeMillis()}" }.take(120)
    }

    private companion object {
        /** 与 web 的 `setInterval(loadMessages, 3000)` 一致 */
        const val POLL_INTERVAL_MS = 3000L
    }
}
