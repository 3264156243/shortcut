// ShortCut 安卓端 · app 模块构建脚本
import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * 发布签名配置。
 *
 * ## 为什么用"存在才启用"而不是写死
 *
 * `keystore.properties` **已 gitignore**（规范 §5 红线：签名材料绝不入库）。
 * 换机器 / 别人 clone 下来时该文件不存在 —— 那时 release 构建不带签名但**不应报错**，
 * 否则连 `assembleDebug` 都跑不了。所以这里做成可选的。
 *
 * ## 为什么签名这件事必须一次做对
 *
 * 签名指纹是"已安装用户能否收到更新"的唯一依据：
 * 换了签名，Android 会**拒绝覆盖安装**，用户只能卸载重装（数据全丢）。
 * 因此正式 keystore 生成后必须离线备份，且此后所有版本都用它签。
 */
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) {
        keystorePropsFile.inputStream().use { load(it) }
    }
}
val hasReleaseSigning = keystoreProps.getProperty("storeFile")?.let { File(it).exists() } == true

android {
    namespace = "com.wanan.shortcut"
    compileSdk = 35

    defaultConfig {
        // 与桌面端 app id 一致；定了不再改（OPPO 推送按包名+签名指纹绑定）
        applicationId = "com.wanan.shortcut"
        minSdk = 24
        targetSdk = 35
        // 版本号是"能否更新"的判据（更新检查按 versionCode 比较），
        // 每次发版**必须**同时递增这两个值。
        versionCode = 5
        versionName = "0.2.3"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = File(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true          // 需要 BuildConfig.VERSION_NAME 做模块版本门禁
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false // 首版不混淆，避免反射/序列化类被裁掉
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true

        // 把 -Dsc.* 透传给测试进程。
        //
        // 为什么需要：Gradle 的 -D 只作用于 Gradle 守护进程，
        // **不会**进到 fork 出来的测试 JVM，于是 System.getProperty 拿到 null
        // （表现为线上测试一直"跳过"，看起来跑了其实没跑）。
        //
        // 用**前缀匹配**而不是逐个列 key：以后加新的线上测试不用再改这里，
        // 也就不会再犯"加了测试却忘了加透传"的错（这个错犯过一次：
        // LiveUpdateManifestTest 加了却没透传 sc.live.update，直接跳过）。
        unitTests.all {
            System.getProperties().stringPropertyNames()
                .filter { it.startsWith("sc.") }
                .forEach { key -> it.systemProperty(key, System.getProperty(key)) }
        }
    }
}

dependencies {
    // ---- Compose ----
    implementation(platform("androidx.compose:compose-bom:2024.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // ---- AndroidX 基础 ----
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.navigation:navigation-compose:2.8.2")

    // ---- 网络（WS 是核心通道，OkHttp 自带 WebSocket）----
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // ---- JSON（协议全是 JSON）----
    implementation("com.google.code.gson:gson:2.11.0")

    // ---- 协程 ----
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // ---- 本地存储：deviceKey / bindId / mobileToken ----
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    // mobileToken 加密存储
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // ---- 二维码扫码（对齐 web 的「扫码绑定」）----
    // 用 ML Kit 的**打包版**（barcode-scanning，非 play-services 版）：
    // 模型随 APK 分发，不依赖设备上的 Google Play 服务 ——
    // 国内 OPPO/ColorOS 设备上 play-services 版可能不可用。
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    // CameraX：相机预览 + 图像分析
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    // 二维码**编码**（生成绑定二维码，对齐 web 已绑定态的 qrcode 渲染）。
    // 只取 zxing 的 core（纯 Java，无 Android 依赖），约 500KB。
    // 不自己手写 QR 编码器：那是 1000+ 行的纠错/掩码算法，不值得也不该自研。
    implementation("com.google.zxing:core:3.5.3")

    // ---- 测试 ----
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
