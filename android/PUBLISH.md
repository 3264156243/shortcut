# 安卓端发布（生成 latest.json + 上传）

> 本脚本放在 `android/` 而**不是** `scripts/` —— 按《协同开发规范》§3，
> `scripts/**` 归桌面侧，安卓侧不能动。放在自己目录里同样可用，且不越界。

## 前置：签名

发布版**必须**用正式 keystore 签名。首次使用请：

```powershell
# 1) 生成 keystore（只需一次；已生成过就跳过）
#    放在仓库外，例如 D:\wenjian\keystore\shortcut-release.jks
keytool -genkeypair -keystore D:\wenjian\keystore\shortcut-release.jks `
  -alias shortcut -keyalg RSA -keysize 2048 -validity 36500 `
  -storepass <密码> -keypass <密码> `
  -dname "CN=ShortCut, OU=Mobile, O=wanan, C=CN"

# 2) 把 android/keystore.properties.example 复制成 android/keystore.properties 并填好
#    （该文件已 gitignore，绝不入库）
```

> ⚠️ **keystore 丢了 = 再也无法给已安装用户推送更新**（签名不一致，系统拒绝覆盖安装）。
> 请离线多处备份，并在仓库里只记录 SHA-256 指纹。

## 发布流程

```powershell
# 1) 改 android/app/build.gradle.kts 里的 versionCode（+1）与 versionName
# 2) 写更新说明：android/release-notes/<versionName>.md
# 3) 一条命令完成：构建 → 校验 → 生成清单 → 上传
powershell -ExecutionPolicy Bypass -File android/publish.ps1
```

脚本会自动：

| 步骤 | 说明 |
|---|---|
| 构建 | `gradlew assembleRelease`（用 keystore.properties 自动签名） |
| 校验签名 | `apksigner verify` 确认已签名 |
| 校验版本 | 比对 `BuildConfig.VERSION_CODE` 与清单一致，防止"改了版本号没生效" |
| 生成清单 | 写 `latest.json`（versionCode / apkUrl / sha256 / size / releaseNotes） |
| 上传 | scp 到服务器 `updates/android/` |

## 上传凭据

服务器连接信息在仓库外（沿用桌面端习惯：`D:\wenjian\mima\服务器连接信息.md`）。
**不写进仓库**（规范 §4.4 红线）。

## 只生成不上传

```powershell
powershell -ExecutionPolicy Bypass -File android/publish.ps1 -SkipUpload
```

产物在 `android/build-update/`：
- `ShortCut-<version>.apk`
- `latest.json`
