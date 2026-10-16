# ico/ —— 应用图标源素材

> 用户提供的手绘/设计原图与导出尺寸。**纳入版本管理**（2026-10-17），避免换机或误删后丢失。
> 这里是**源素材**；真正参与构建的图标在 `resources/`（`icon.ico` / `icon.png` / `icon.svg`）。

| 文件 | 说明 |
|---|---|
| `原图.jpg` | 原始设计图（未抠图，含背景） |
| `抠图原图.png` | 抠好背景的透明原图（最高清，改图标时从这里改） |
| `512.ico` | 512×512 导出 |
| `128.ico` | 128×128 导出 |
| `64.ico` | 64×64 导出 |

## 改图标的正确流程

1. 从 `抠图原图.png` 出图（保持透明背景）；
2. 用工具导出 `resources/icon.ico`（多尺寸：16/24/32/48/64/128/256）与 `resources/icon.png`；
3. 桌面端打包用的图标在 `src-tauri/icons/`（Tauri 生成，连同 `icon.icns`、`ios/`、`android/` 等）；
4. 换完后重新构建（`npm run build` → `cargo build --release --features custom-protocol`）并确认托盘/任务栏/安装包图标都变了。
