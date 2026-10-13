package com.wanan.shortcut.feature.home

/**
 * 首页布局形式。
 *
 * ## 为什么做成可切换的枚举（而不是直接写死网格）
 *
 * 用户明确要求："**我想都要有，并且后续能不能扩展很多形式，第一期先图标网格**"。
 *
 * 因此首页不把"网格"写死在渲染里，而是：
 *   1. 定义 [HomeLayoutStyle] 枚举；
 *   2. 每种形式一个独立的渲染函数（`ModuleGrid` / `ModuleList`）；
 *   3. 首页按当前偏好分发。
 *
 * 这样将来加"紧凑列表""分组折叠""自定义拖动排序"等形式时，
 * **只加一个枚举值 + 一个渲染函数**，不用重写首页。
 *
 * 本轮实现 [GRID] 与 [LIST] 两种（都做出来，便于对比与切换），
 * 默认 [GRID]（用户指定第一期用网格）。
 */
enum class HomeLayoutStyle(val label: String) {
    /** 图标网格：像应用抽屉，启动快，适合板块多 */
    GRID("图标网格"),

    /** 行式卡片列表：与仓库 web `/mobile/` 一致，副标题能写清功能 */
    LIST("列表"),

    // 预留（有需求时再加）：
    // COMPACT("紧凑列表"),
    // GROUPED("分组折叠"),
    ;

    companion object {
        /** 默认形式：第一期用网格（用户指定） */
        val DEFAULT = GRID

        fun fromName(name: String?): HomeLayoutStyle =
            entries.firstOrNull { it.name == name } ?: DEFAULT
    }
}
