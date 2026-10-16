# ShortCut 架构演进路线图（ROADMAP）

> 决策日期：2026-09-22 · 分支：codex/v2-development
> 本文是架构级决策的权威记录，后续迁移/推送实施照此执行，变更需更新本文。

## 一、决策记录

### D1：桌面壳迁移 Electron → Tauri 2（已决策，长期必经）

**动机**：Electron 体积（win-unpacked ~200MB）与内存基线（自带 Chromium 多进程）不可根治；Tauri 2 复用系统 WebView2，包体 3-10MB、运行内存低 50-70%，前端 React 层 ~95% 可复用。

**策略**：功能闭环 → 内存摸底 → 迁移准备 → 一次性迁移。**不在功能迭代期双线作战**。

**启动条件**（满足即可开工）：
- 控制板块等在研功能全部闭环稳定
- 内存基线数据记录完毕（见阶段 1）
- 预留 2-3 周完整窗口

### D2：移动端推送 = 前台 WS 实时 + OPPO Push 离线兜底 + 白名单保活引导（已决策）

**动机**：用户持有 OPPO 开发者账号（未上架应用每日测试推送额度，个人使用足够）；目标设备以 OPPO/ColorOS 为主。

**架构定位（关键，控制复杂度）**：
- 手机在线/前台 → 走现有 WS relay 长连接（实时性最好，已有）
- App 被杀/离线 → OPPO Push 通知栏消息兜底（我们的场景：任务推送/快传到达/剪贴板提醒，均为通知栏消息，不依赖透传）
- 增强 → 白名单保活引导页（用户手动设置电池白名单/自启动）

**已知边界（诚实记录）**：
- OPPO Push 仅覆盖 ColorOS 系设备（OPPO/一加/realme）；非 OPPO 设备回退"前台 WS + PWA 提醒"路径
- 白名单保活依赖用户手动设置，应用层做"检测 ROM → 跳转设置页引导"，不做进程级强保活（新 ColorOS 上基本无效，不投入）
- OPPO 未上架应用为测试推送模式（每日限量）；若未来商用需过审换正式通道

## 二、阶段 0：功能闭环期（现在）

- [ ] 控制板块收尾：云端输入问题（手机端半死连接修复）待用户复测确认；偶发断连观察
- [ ] 移动端 Web：PWA manifest + 站内提醒兜底（红点/标题计数），零成本过渡
- [ ] 现有板块稳定性回归（任务墙/快传/剪贴板/翻译）

## 三、阶段 1：内存摸底与优化（功能闭环后立即做，~1 周）

**目标**：拿到可对比的基线数据 + 修掉应用层泄漏。无论是否迁移都必须做——迁移后要用同口径数据对比验证收益。

1. **主进程采样**：每 30s `app.getAppMetrics()` 按进程类型（main/renderer/gpu/utility）聚合写日志
2. **渲染层上报**：各窗口 `performance.memory`（JS heap used/total/limit）定期汇总到主进程日志
3. **调试入口**：设置页或隐藏快捷键显示各进程实时内存 + 手动 GC 按钮
4. **嫌疑清单逐项排查**：
   - window/document 监听器未清理（组件卸载时 removeEventListener）
   - setInterval/setTimeout 未清理（尤其 SC球、统计轮询）
   - 翻译历史 / 统计数据 / 快传记录的无限累积（zustand store 常驻）
   - 文件快传 File/Blob 引用滞留
   - 语音输入 MediaStream / AudioContext 未释放
   - SC球 rAF 循环、透明窗口重绘
5. **验收**：连续 24h 稳态运行内存曲线（无单调增长），记录为 Electron 基线
6. **顺手瘦身**：打包排除多余 locales（~-20MB）、排除 sourcemap、板块 React.lazy 懒加载

## 四、阶段 2：Tauri 2 迁移（启动条件满足后，2-3 周窗口）

### 迁移映射表

| Electron 现状 | Tauri 2 对应 | 工作量 |
|---|---|---|
| React 前端 + zustand | **原样保留** | 仅桥接层改实现 |
| `window.electronAPI`（preload） | 单一桥接模块 → `@tauri-apps/api` invoke | 中 |
| main.ts 窗口管理 / 托盘 | Rust `tauri::WebviewWindow` / `tauri::tray` | 中 |
| 全局快捷键 | tauri-plugin-global-shortcut | 小 |
| IPC handlers | `#[tauri::command]` | 中 |
| 自动更新 | tauri-plugin-updater | 小 |
| sj 注入服务（node sidecar spawn） | **原样保留**（shell sidecar） | 极小 |
| PowerShell SendInput 注入 | **原样保留**（进程注入与壳无关） | 零 |
| HardwareMonitor.exe | **原样保留**（sidecar） | 零 |
| 剪贴板 / 文件对话框 / 开机自启 | tauri-plugin-clipboard-manager / dialog / autostart | 小 |
| 透明+点击穿透窗口（SC球） | `transparent` + `set_ignore_cursor_events` | 小（需验证） |

### 迁移步骤
1. 脚手架 + 最小壳（主窗口/托盘/全局热键/开机自启）
2. 桥接模块 invoke 版实现（前端零改动切换）
3. 板块逐个点亮 + 回归（按依赖顺序：快捷面板 → 翻译 → 统计 → 任务墙 → 快传 → 语音 → 控制）
4. sidecar 三件套接入验证（sj / HardwareMonitor / PowerShell 注入）
5. 安装包（NSIS）+ updater 通道替换
6. 用阶段 1 同口径跑 24h 内存对比，出收益报告

### 迁移前置工程（阶段 0/1 期间零成本顺手做）
- [ ] 渲染层对 `window.electronAPI` 的调用全部收敛到单一桥接模块（禁止组件直接调用）
- [ ] 主进程模块职责清单化（docs/archive/HANDOVER.md 补充一节）

## 五、移动推送实施计划（与桌面阶段并行推进）

- **P0（现在）**：PWA manifest + 站内提醒轮询兜底
- **P1（~1 周）**：Capacitor 壳（远程加载 shortcut.326415.xyz/mobile/，前端零改动）+ relay WS 前台实时（已有）+ APK 官网自分发
- **P2（核心）**：OPPO Push 接入
  - 客户端：Capacitor 自定义插件桥接 OPush SDK（初始化 → regId 上报，挂到现有 bind 体系：一个绑定多设备 token）
  - 服务端：PHP push 网关（OPPO REST API：auth_token 鉴权 + 单推接口），桌面事件 → 云端 → 推送
  - 场景清单：任务墙任务推送、文件快传到达、剪贴板同步提醒
- **P3（增强）**：保活引导页（检测厂商/ROM → 图文引导电池白名单/自启动设置）；可选前台服务常驻通知

## 六、风险登记

| 风险 | 影响 | 对策 |
|---|---|---|
| Tauri 2 原生细节坑（托盘菜单/透明窗/热键冲突） | 迁移期延长 | 步骤 1 先做最小壳验证四件套，坑早暴露 |
| WebView2 老版本渲染差异 | 个别用户 UI 异常 | 打包探测 wv2 版本，低于阈值引导安装 |
| OPPO Push 测试额度限制 | 频繁测试受限 | 个人使用场景内可控；推送内容做去重/节流 |
| 白名单引导被用户忽略 | 推送触达下降 | 首次启动引导 + 设置页常驻入口 |
| 迁移期间 Electron 线 bug 修复不同步 | 双分支漂移 | 迁移期冻结 Electron 新功能，只修致命 bug，且改动同步摘樱桃 |
