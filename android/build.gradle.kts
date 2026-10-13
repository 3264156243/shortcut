// ShortCut 安卓端 · 根构建脚本
// 版本组合与本机已验证通过的 KotlinComposeTest 保持一致（AGP 8.7.3 + Kotlin 2.0.21）。
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
