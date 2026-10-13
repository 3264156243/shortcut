package com.wanan.shortcut.feature.bind

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import com.wanan.shortcut.core.error.ErrorAction
import com.wanan.shortcut.core.error.ErrorMapper
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
 * 绑定 ViewModel —— 实现契约 §2.6 `mobile.bind`，这是安卓端**第一个要实现的接口**。
 *
 * 关键点（契约 §3.4，本次已实测确认）：
 *   **必须带 `deviceKey`**。带了它，同一台手机重绑是"原地轮换"（deviceId 不变）；
 *   不带则每次都在设备列表里新增一台"我的手机"，很快占满上限（默认 5）。
 */
class BindViewModel(
    private val apiClient: ApiGateway,
    private val identityProvider: IdentityProvider,
    private val errorMapper: ErrorMapper,
) : ViewModel() {

    private val _state = MutableStateFlow<BindUiState>(BindUiState.Idle)
    val state: StateFlow<BindUiState> = _state.asStateFlow()

    fun bind(codeInput: String, deviceName: String) {
        val code = codeInput.trim().uppercase()   // 契约 §2.2：绑定码大小写不敏感
        if (code.isBlank()) {
            _state.value = BindUiState.Failed("请输入绑定码")
            return
        }
        if (code.length != CODE_LENGTH) {
            _state.value = BindUiState.Failed("绑定码是 6 位")
            return
        }

        _state.value = BindUiState.Submitting
        viewModelScope.launch {
            // deviceKey 由 IdentityProvider 保证已存在（惰性生成 + 持久化）
            val deviceKey = identityProvider.current().deviceKey
                .ifBlank { identityProvider.restore().deviceKey }

            val name = deviceName.trim().ifBlank { DEFAULT_DEVICE_NAME }

            when (val result = apiClient.post(
                action = "mobile.bind",
                params = mapOf(
                    "code" to code,
                    "deviceName" to name,
                    "deviceKey" to deviceKey,   // ★ 契约 §3.4 的头号要求
                ),
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

    private suspend fun handleSuccess(obj: JsonObject) {
        // 契约 §2.6 返回：{success, bindId, code, mobileToken, deviceId, deviceName}
        val bindId = obj.stringOrEmpty("bindId")
        val mobileToken = obj.stringOrEmpty("mobileToken")
        val deviceId = obj.stringOrEmpty("deviceId")
        val deviceName = obj.stringOrEmpty("deviceName").ifBlank { DEFAULT_DEVICE_NAME }

        if (bindId.isBlank() || mobileToken.isBlank()) {
            // success:true 但缺关键字段 —— 视为服务端异常，不要让用户进到一个"看似已绑定但没有凭证"的状态
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

    private companion object {
        const val CODE_LENGTH = 6
        const val DEFAULT_DEVICE_NAME = "我的手机"
    }
}

/** JsonObject 取字符串的安全读法（字段可能是数字或缺失）。 */
internal fun JsonObject.stringOrEmpty(key: String): String =
    if (has(key) && !get(key).isJsonNull) get(key).asString else ""
