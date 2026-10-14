package com.wanan.shortcut.feature.bind

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import com.wanan.shortcut.core.error.ErrorAction
import com.wanan.shortcut.core.error.ErrorMapper
import com.wanan.shortcut.core.identity.Identity
import com.wanan.shortcut.core.identity.IdentityProvider
import com.wanan.shortcut.core.net.ApiGateway
import com.wanan.shortcut.core.result.ApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 绑定页状态。
 *
 * 用密封类而非"多个 boolean"（isLoading/isError/isSuccess 那种写法），
 * 这样"正在绑定"和"绑定失败"不可能同时为真，UI 也无法渲染出矛盾状态。
 */
sealed interface BindUiState {
    data object Idle : BindUiState
    data object Submitting : BindUiState
    data class Failed(val message: String) : BindUiState
    data object Success : BindUiState
}

/**
 * 绑定 ViewModel —— 实现契约 §2.6 `mobile.bind`。
 *
 * ## 支持四种绑定入口（对齐 web `bind/index.html`）
 *
 * | 入口 | 传什么 | web 对应 |
 * |---|---|---|
 * | 手输 6 位绑定码 | `code` | `doBind()` |
 * | **扫码得到绑定链接** | `bindId`（`?bind=`） | `connectWithScannedValue()` 第一分支 |
 * | 扫码得到裸 6 位码 / `?code=` | `code` | 同函数第二分支 |
 * | **`?bind=` 直链进入** | `bindId` 自动绑定 | `init()` 里的自动绑定 |
 *
 * 契约 §2.6：`bindId` 与 `code` 二选一，**`bindId` 优先且跳过 code 校验**。
 *
 * ## 关键点（契约 §3.4，已实测确认）
 *
 * **必须带 `deviceKey`**。带了它，同一台手机重绑是"原地轮换"（deviceId 不变）；
 * 不带则每次都在设备列表里新增一台"我的手机"，很快占满上限（默认 5）。
 */
class BindViewModel(
    private val apiClient: ApiGateway,
    private val identityProvider: IdentityProvider,
    private val errorMapper: ErrorMapper,
) : ViewModel() {

    private val _state = MutableStateFlow<BindUiState>(BindUiState.Idle)
    val state: StateFlow<BindUiState> = _state.asStateFlow()

    /** 当前身份（绑定页要显示"已绑定"信息与二维码） */
    val identity: StateFlow<Identity> = identityProvider.state

    /**
     * 绑定（web 的 `doBind` + `connectWithScannedValue` 合并逻辑）。
     *
     * @param codeInput 6 位码；大小写不敏感（契约 §2.2）
     * @param deviceName 设备名，空则服务端用「我的手机」
     * @param bindIdFromScan 扫码/直链得到的 bindId。
     *        契约 §2.6：有有效 bindId 时**优先用它并跳过 code 校验**。
     */
    fun bind(
        codeInput: String,
        deviceName: String,
        bindIdFromScan: String? = null,
    ) {
        val code = codeInput.trim().uppercase()

        // 契约 §2.6：bindId 优先。只有拿不到 bindId 时才必须校验 6 位码。
        if (bindIdFromScan.isNullOrBlank()) {
            if (code.isBlank()) {
                _state.value = BindUiState.Failed("请输入绑定码")
                return
            }
            if (code.length != CODE_LENGTH) {
                _state.value = BindUiState.Failed("绑定码是 6 位")
                return
            }
        }

        _state.value = BindUiState.Submitting
        viewModelScope.launch {
            // deviceKey 由 IdentityProvider 保证已存在（惰性生成 + 持久化）
            val deviceKey = identityProvider.current().deviceKey
                .ifBlank { identityProvider.restore().deviceKey }

            val name = deviceName.trim().ifBlank { DEFAULT_DEVICE_NAME }

            val params = mutableMapOf<String, Any?>(
                "deviceName" to name,
                "deviceKey" to deviceKey,   // ★ 契约 §3.4 的头号要求
            )
            if (!bindIdFromScan.isNullOrBlank()) {
                // 有 bindId 时不发 code：服务端会跳过 code 校验，
                // 保持请求形状与 web 的 bindId 分支一致。
                params["bindId"] = bindIdFromScan
            } else {
                params["code"] = code
            }

            when (val result = apiClient.post(
                action = "mobile.bind",
                params = params,
                requireIdentity = false,        // 绑定前当然没有身份
            )) {
                is ApiResult.Ok -> handleSuccess(result.data)
                is ApiResult.BusinessFail -> handleBusinessFail(result.message)
                is ApiResult.TransportFail -> _state.value =
                    BindUiState.Failed("网络不可用，请检查网络后重试")
                ApiResult.Unauthorized -> _state.value =
                    BindUiState.Failed("绑定失败，请重试")
            }
        }
    }

    /**
     * 直接用一个 bindId 绑定（`?bind=` 直链 / 扫码得到的绑定链接）。
     *
     * web `init()` 在检测到 `?bind=` 且当前未绑定时会**自动绑定**，这里保持同样行为。
     */
    fun bindWithBindId(bindId: String, deviceName: String = DEFAULT_DEVICE_NAME) {
        if (bindId.isBlank()) return
        bind(codeInput = "", deviceName = deviceName, bindIdFromScan = bindId)
    }

    private suspend fun handleSuccess(obj: JsonObject) {
        // 契约 §2.6 返回：{success, bindId, code, mobileToken, deviceId, deviceName}
        val bindId = obj.stringOrEmpty("bindId")
        val mobileToken = obj.stringOrEmpty("mobileToken")
        val deviceId = obj.stringOrEmpty("deviceId")
        val deviceName = obj.stringOrEmpty("deviceName").ifBlank { DEFAULT_DEVICE_NAME }

        if (bindId.isBlank() || mobileToken.isBlank()) {
            // success:true 但缺关键字段 —— 不要让用户进到"看似已绑定但没有凭证"的状态
            _state.value = BindUiState.Failed("绑定失败：服务端返回不完整")
            return
        }

        identityProvider.saveBinding(
            bindId = bindId,
            mobileToken = mobileToken,
            deviceId = deviceId,
            deviceName = deviceName,
        )
        _state.value = BindUiState.Success
    }

    private fun handleBusinessFail(message: String) {
        _state.value = when (errorMapper.map(message)) {
            ErrorAction.RATE_LIMITED -> BindUiState.Failed("操作太快了，请稍后再试")
            ErrorAction.INVALID_INPUT -> BindUiState.Failed("绑定码无效，请检查后重试")
            else -> BindUiState.Failed(
                // 原样展示服务端文案：例如"已达上限…请先在电脑端移除不用的设备"，
                // 里面含用户可执行的操作指引，改写会丢信息（契约 §2.6）
                message.ifBlank { "绑定失败，请稍后再试" }
            )
        }
    }

    fun resetError() {
        if (_state.value is BindUiState.Failed) _state.value = BindUiState.Idle
    }

    /** 更换绑定（web 的「更换绑定」按钮）：只清本地身份，保留 deviceKey。 */
    fun unbind() {
        viewModelScope.launch {
            identityProvider.clear()
            _state.value = BindUiState.Idle
        }
    }

    private companion object {
        const val CODE_LENGTH = 6
        const val DEFAULT_DEVICE_NAME = "我的手机"
    }
}

/** JsonObject 取字符串的安全读法（字段可能是数字或缺失）。 */
internal fun JsonObject.stringOrEmpty(key: String): String =
    if (has(key) && !get(key).isJsonNull) get(key).asString else ""
