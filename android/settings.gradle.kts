pluginManagement {
    repositories {
        // 本机 services.gradle.org 不可达，插件优先走阿里云镜像
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    // PREFER_SETTINGS：本文件是依赖源的唯一真源，保证换机器/CI 一致
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        google()
        mavenCentral()
    }
}

rootProject.name = "ShortCut"
include(":app")
