# M6 内存基线：Tauri 2 vs Electron（2026-08-18 实测）

测量工具：`scripts/measure-memory.ps1`（12 次采样 × 10s 取均值/峰值）+ WebView2 子进程补测。
两版均为刚启动、同一台开发机（Windows 11 x64）、同一份 %APPDATA%\ShortCut 配置。

## 实测数据

| 指标 | Electron 2.4.4 | Tauri 2.4.5 | 差异 |
|---|---|---|---|
| 宿主进程数 | 5（Chromium 多进程） | 1 + WebView2 子进程 5 | — |
| 宿主 WorkingSet 均值 | 520.1 MB | 37.2 MB | — |
| WebView2 子进程 WS | （含在 520 内） | 328.3 MB | — |
| **总 WorkingSet** | **520.1 MB** | **365.5 MB** | **-154.6 MB（-30%）** |
| 总 Private（独占） | 406.4 MB | 163.3 MB | **-243.1 MB（-60%）** |
| 可执行文件体积 | 221.6 MB（win-unpacked exe） | 13.0 MB（shortcut-tauri.exe） | -94% |

- Tauri 宿主进程 12 次采样波动极小（37.1–37.2MB），稳定无增长
- WebView2 5 子进程 = browser/network/gpu/renderer×2（主窗+岛窗共享一个 WebView2 环境）

## 结论

- Tauri 版独占内存（Private）下降 60%，WorkingSet 下降 30%，安装体积下降 94%
- Electron 版 520MB 主要为 Chromium 每窗口完整运行时；Tauri 共享系统 WebView2 是根因
- 后续 24h 长跑观测沿用 measure-memory.ps1（用户确认长期留机时再挂）

## 复现

```powershell
# Electron 版（⚠️ 2026-10-17 已退役：`release/win-unpacked/` 已删除。
# 想复现这一列，先从云端 /updates/ShortCut-2.4.5-Setup.exe 装一次 Electron 版）
Start-Process 'D:\wenjian\js\ShortCut\release\win-unpacked\ShortCut.exe'
.\scripts\measure-memory.ps1 -Name electron
taskkill /F /IM ShortCut.exe

# Tauri 版
Start-Process 'D:\wenjian\js\ShortCut\src-tauri\target\release\shortcut-tauri.exe'
.\scripts\measure-memory.ps1 -Name tauri
# WebView2 子进程补测
Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" | ? { $_.CommandLine -match 'shortcut-tauri' }
```
