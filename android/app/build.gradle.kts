// ShortCut 安卓端 · app 模块构建脚本
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.wanan.shortcut"
    compileSdk = 35

    defaultConfig {
        // 与桌面端 app id 一致；定了不再改（OPPO 推送按包名+签名指纹绑定）
        applicationId = "com.wanan.shortcut"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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

        // 把 -Dsc.live.* 透传给测试进程。
        //
        // 为什么需要：Gradle 的 -D 只作用于 Gradle 守护进程，
        // **不会**进到 fork 出来的测试 JVM，于是 System.getProperty 拿到 null
        // （表现为 LiveServerSmokeTest 一直被跳过，看起来"跑了其实没跑"）。
        unitTests.all {
            listOf("sc.live.bindId", "sc.live.mobileToken").forEach { key ->
                (System.getProperty(key) ?: System.getenv(key.replace('.', '_').uppercase()))
                    ?.let { value -> it.systemProperty(key, value) }
            }
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

    // ---- 测试 ----
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
