package com.wanan.shortcut.feature.linked.control

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.wanan.shortcut.MainActivity
import com.wanan.shortcut.R

/**
 * 电脑控制的前台服务 —— 让连接在 App 退到后台时**保持**。
 *
 * ## 为什么需要它（用户的明确要求）
 *
 * "除非断网或者手动断联，否则长期维持连接状态"。
 *
 * 仅靠 App 在前台时连接是不够的：用户切到别的 App、锁屏、或者去拿东西，
 * 一旦 Activity 被回收，`RelayClient` 的 WS 就会停（因为它跑在进程里），
 * 再回来要重新换票、重新握手 —— 中间那段时间控制就是断的。
 *
 * 前台服务把进程标记为"正在为用户工作"，系统不会随意回收，
 * 同时通知栏能看到"正在连接电脑"，用户心里有数。
 *
 * ## 生命周期（刻意的设计）
 *
 * - **只有用户主动连接成功后才启动**（不主动拉起来占资源）
 * - **只有用户主动断开、或连接不可恢复时才停止**
 * - 服务本身**不持有连接**：连接仍由 [ControlSession]（容器单例）持有，
 *   服务只负责"让进程活下去"。这样即使服务被系统杀掉重启，
 *   连接状态也不会出现两份真相。
 *
 * ## 注意
 *
 * Android 14+ 要求前台服务声明具体类型。
 * 这里用 `connectedDevice` —— 正是"与外部设备保持连接"的语义。
 */
class ControlForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 用户点"断开"：停止服务并移除通知
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        startAsForeground(
            title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE,
            text = intent?.getStringExtra(EXTRA_TEXT) ?: DEFAULT_TEXT,
        )

        // START_STICKY：系统回收后尽量重建，配合 App 侧的重连逻辑
        return START_STICKY
    }

    private fun startAsForeground(title: String, text: String) {
        createChannel()

        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        // "断开连接" 按钮：从通知栏就能手动断开（对应用户要的"手动断联控件"）
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ControlForegroundService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)                 // 不可滑动清除：它代表一个正在进行的状态
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(contentIntent)
            .addAction(0, "断开连接", stopIntent)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ 必须显式声明前台服务类型
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "电脑控制连接",
                // IMPORTANCE_LOW：常驻状态通知，不该发出声音打扰
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "保持与电脑的控制连接"
                setShowBadge(false)
            },
        )
    }

    companion object {
        const val CHANNEL_ID = "control_connection"
        const val NOTIFICATION_ID = 1001

        const val ACTION_STOP = "com.wanan.shortcut.control.STOP"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"

        private const val DEFAULT_TITLE = "电脑控制已连接"
        private const val DEFAULT_TEXT = "保持连接中，可在通知栏断开"

        /** 启动常驻连接（用户连上电脑后调用） */
        fun start(context: Context, title: String = DEFAULT_TITLE, text: String = DEFAULT_TEXT) {
            val intent = Intent(context, ControlForegroundService::class.java).apply {
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_TEXT, text)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /** 停止常驻连接（用户主动断开、或连接已不可用时调用） */
        fun stop(context: Context) {
            context.stopService(Intent(context, ControlForegroundService::class.java))
        }
    }
}
