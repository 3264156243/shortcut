package com.wanan.shortcut.core.net

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * OkHttp 单例。
 *
 * 全局只保留一个连接池与线程池：板块多了以后，每个板块各建 client 会导致
 * 连接数/线程数无上限增长，且超时策略不一致。
 */
object HttpEngine {

    /** 普通 JSON 接口：服务端响应很快，超时给短一些，避免 UI 长时间转圈。 */
    val api: OkHttpClient by lazy {
        base().newBuilder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    /**
     * 文件接口：上传分片/下载可能是大文件（单文件上限 1 GB，契约 §6.2），
     * 读写超时必须放宽，否则大文件必然中断。
     */
    val file: OkHttpClient by lazy {
        base().newBuilder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .build()
    }

    /** 实时通道：WebSocket 长连接，读超时设为 0（不超时），靠心跳判活。 */
    val relay: OkHttpClient by lazy {
        base().newBuilder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)   // WS 长连接不设读超时
            .pingInterval(0, TimeUnit.SECONDS)       // 心跳自己实现（协议层 30s ping，见契约 §7.6）
            .build()
    }

    private fun base(): OkHttpClient = OkHttpClient.Builder()
        .retryOnConnectionFailure(true)
        .build()
}
