package com.wanan.shortcut.feature.settings

/**
 * 设置分片契约（设计文档 §4）。
 *
 * 为什么拆成"分片"而不是一个巨型 `SettingsScreen`：
 * 用户明确说"很多东西不想要一下子定死，可以长期扩展完善"，
 * 而设置项正是最容易无限膨胀的地方。
 *
 * 拆成独立分片后：
 *   - 加一个设置分类 = 加一个文件 + 注册一行，不动其它分片
 *   - 板块可以贡献自己的设置（见 [com.wanan.shortcut.framework.ShortcutModule.SettingsSection]）
 *   - 每个分片可以独立决定"要不要在未绑定时显示/禁用"
 */
enum class SettingsSectionId(val title: String) {
    APPEARANCE("外观"),        // 字号、主题
    BINDING("连接与设备"),      // 绑定码、设备名、解绑
    STORAGE("存储"),           // 缓存管理、占用
    MODULES("板块设置"),        // 由各板块贡献
    ABOUT("关于"),             // 版本、协议版本、许可

    // 预留（有需求时再加，加一个枚举值即可）：
    // NOTIFICATION("消息通知"),   // 配合将来的推送
    // PRIVACY("隐私"),
    // ADVANCED("高级"),
}

/**
 * 一个设置分片的元信息。
 *
 * [visibleWhenUnbound] 的意义：绑定相关分片在未绑定时要给出不同文案
 * （不是隐藏，而是显示"未连接"），所以这里表达成"是否需要在未绑定时也显示"。
 */
data class SettingsSectionMeta(
    val id: SettingsSectionId,
    val title: String,
    val visibleWhenUnbound: Boolean = true,
)
