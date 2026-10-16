# Tauri updater 部署说明（shortcut.326415.xyz）

## 服务器端点

`https://shortcut.326415.xyz/updates/latest.json`（tauri.conf.json plugins.updater.endpoints 唯一项）。

## latest.json 格式（Tauri 2 静态 JSON）

```json
{
  "version": "2.4.5",
  "notes": "更新说明",
  "pub_date": "2026-08-18T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<.sig 文件内容原文>",
      "url": "https://shortcut.326415.xyz/updates/ShortCut_2.4.5_x64-setup.exe"
    }
  }
}
```

- `signature`：**.sig 文件的文本内容**（minisign 签名，多行 base64），不是十六进制
- `version` 必须大于客户端当前版本（语义化对比由插件完成）
- 服务器需给 latest.json 与安装包 `Content-Type: application/octet-stream`，允许 CORS（插件原生请求无 CORS 限制）

## 发布流程

1. 版本号三处同步：`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、（前端如需）`package.json`
2. 构建：`cargo tauri build`（或 `cargo build --release` + `tauri build`）；`bundle.createUpdaterArtifacts: true` 会自动产出：
   - `src-tauri/target/release/bundle/nsis/ShortCut_<ver>_x64-setup.exe`
   - `src-tauri/target/release/bundle/nsis/ShortCut_<ver>_x64-setup.exe.sig`
3. 签名环境变量（构建机）：
   - `TAURI_SIGNING_PRIVATE_KEY_PATH=%USERPROFILE%\.tauri\shortcut-updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=`（空，密钥未设密码）
4. 上传 `ShortCut_<ver>_x64-setup.exe` 与 `.sig` 到服务器 updates 目录；更新 `latest.json` 的 version/signature/url
5. 客户端验证链：latest.json.version > 当前版本 → 下载 url → minisign 公钥（已内置于 tauri.conf.json）验签 .sig → 执行安装

## 密钥保管

- 私钥：`%USERPROFILE%\.tauri\shortcut-updater.key`，密码：`shortcut2026`（**首版开发密钥**，正式对外发布前建议换新密钥对并把密码移入密码管理器；换钥需同步更新 tauri.conf.json 的 pubkey）
- 公钥：`%USERPROFILE%\.tauri\shortcut-updater.key.pub`（已嵌入 tauri.conf.json）
- 丢失私钥/密码 = 无法再发布更新，务必备份到安全位置

## 构建命令（实测可用）

```cmd
call vcvars64.bat
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\shortcut-updater.key
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=shortcut2026
cd /d D:\wenjian\js\ShortCut
node_modules\.bin\tauri.cmd build
```

产物：
- `src-tauri/target/release/bundle/nsis/ShortCut_2.4.5_x64-setup.exe`（3.8 MB）
- `src-tauri/target/release/bundle/nsis/ShortCut_2.4.5_x64-setup.exe.sig`（updater 签名）
