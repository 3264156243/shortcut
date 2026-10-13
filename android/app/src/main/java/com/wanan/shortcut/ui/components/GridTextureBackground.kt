package com.wanan.shortcut.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.wanan.shortcut.ui.theme.isDarkTheme

/**
 * 网格纹理背景 —— 复刻 web 四个移动端页面的观感。
 *
 * web 原实现（`server/sync/web/mobile/index.html`）：
 * ```css
 * body { background:
 *   linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
 *   linear-gradient(90deg, rgba(255,255,255,.02) 1px, transparent 1px),
 *   #24221f;
 *   background-size: 24px 24px; }
 * ```
 * 即：每 24px 画一条**极淡**的横线与竖线，叠加在底色上。
 *
 * ## 为什么用 drawBehind 手绘而不是贴图
 *
 * 贴图会增加包体、且在不同 DPI 下会模糊；`drawBehind` 是矢量绘制，
 * 任意屏幕密度都锐利。代价是每帧重绘一次极少数线条，开销可忽略
 * （因为纹理是静态的，Compose 会缓存绘制指令）。
 *
 * ## 关于透明度
 *
 * 深色下 web 用的是 `.025` / `.02`（几乎看不见但有质感）。
 * 浅色主题必须用**黑色**低透明，否则白线在白底上等于没画。
 */
@Composable
fun GridTextureBackground(
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    cell: Dp = 24.dp,
    content: @Composable BoxScope.() -> Unit,
) {
    val dark = isDarkTheme
    // 深色：白色细线；浅色：黑色细线（数值更小，避免显脏）
    val horizontal = if (dark) Color.White.copy(alpha = 0.025f) else Color.Black.copy(alpha = 0.020f)
    val vertical = if (dark) Color.White.copy(alpha = 0.020f) else Color.Black.copy(alpha = 0.015f)

    Box(
        modifier = modifier
            .fillMaxSize()
            // 关掉纹理时仍然铺底色，否则会透出 Activity 的默认背景
            .background(MaterialTheme.colorScheme.background)
            .then(
                if (!enabled) Modifier else Modifier.drawBehind {
                    val step = cell.toPx()
                    if (step <= 0f) return@drawBehind

                    var x = 0f
                    while (x <= size.width) {
                        drawLine(
                            color = vertical,
                            start = Offset(x, 0f),
                            end = Offset(x, size.height),
                            strokeWidth = 1f,
                        )
                        x += step
                    }
                    var y = 0f
                    while (y <= size.height) {
                        drawLine(
                            color = horizontal,
                            start = Offset(0f, y),
                            end = Offset(size.width, y),
                            strokeWidth = 1f,
                        )
                        y += step
                    }
                },
            ),
        content = content,
    )
}
