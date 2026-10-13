package com.wanan.shortcut.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.wanan.shortcut.AppContainer
import com.wanan.shortcut.appContainer

/**
 * ViewModel 工厂桥接。
 *
 * 目的：让板块写 `viewModel<XxxViewModel>()` 时**不需要**知道 DI 容器细节，
 * 也不需要自己写 Factory。新增 ViewModel 时只在这里加一个分支
 * （这是"加板块只改一个文件"的唯一例外，属于框架自身职责，故集中在框架层）。
 */
object VmFactory {

    @Composable
    fun container(): AppContainer = LocalContext.current.appContainer

    /** 用 [AppContainer] 构造一个 [ViewModelProvider.Factory]。 */
    fun of(container: AppContainer, create: (AppContainer) -> ViewModel): ViewModelProvider.Factory =
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                create(container) as T
        }
}

/** 便捷入口：在 Composable 里拿到"用容器构造的" ViewModel。 */
@Composable
inline fun <reified VM : ViewModel> containerViewModel(
    noinline create: (AppContainer) -> VM,
): VM = viewModel(factory = VmFactory.of(VmFactory.container(), create))
