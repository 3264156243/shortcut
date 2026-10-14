# android/ —— 安卓端（原生 Kotlin）

> **归属：安卓侧开发者。** 桌面侧（`src/`、`src-tauri/`、`server/`、`resources/`、`tools/`、`docs/*.md`）不会碰这个目录，
> 也请安卓侧不要改上述目录。分工与提交规则见 [`docs/协同开发规范.md`](../docs/协同开发规范.md)。
>
> 本文已随实际实现更新（2026-10-14）。

---

## 1. 目录现状

工程已可编译、可出 APK，框架与两个板块完成。**不是空壳。**

```
android/                     ← 本目录即工程根
├── settings.gradle.kts      仓库源（阿里云镜像优先）
├── build.gradle.kts         AGP 8.7.3 + Kotlin 2.0.21
├── gradle.properties        内存与 AndroidX 开关
├── gradle/wrapper/          已入库（契约红线要求）
├── local.properties         ★ 不入库（sdk.dir）
└── app/
    └── src/
        ├── main/java/com/wanan/shortcut/
        │   ├── core/        result / net / identity / error / prefs / util / realtime
        │   ├── framework/   ModuleSpec / ShortcutModule / ModuleRegistry / HomeLayout
        │   ├── feature/     bind / home / settings / local(notes,demo) / linked(taskwall)
        │   └── ui/          theme / components / nav
        └── test/java/…      87 个 JVM 单测
```

| 项 | 实际值 |
|---|---|
| `applicationId` | `com.wanan.shortcut` |
| `minSdk` / `targetSdk` / `compileSdk` | 24 / 35 / 35 |
| JDK | **21**（`C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot`） |
| Gradle | 8.11.1（wrapper 指向腾讯云镜像，`services.gradle.org` 本机不可达） |
| 界面 | Jetpack Compose + Material 3 |
| 网络 | OkHttp 4.12（HTTP + WebSocket） |
| 序列化 | Gson |

---

## 2. 先读什么（顺序）

1. **[`docs/移动互联-协议契约.md`](../docs/移动互联-协议契约.md)** —— 接口唯一真源。
   按 §0 → §1 → §2.6 → §3 的顺序读，就能跑通第一个闭环：**绑定 → 拿到 mobileToken → 记住 deviceKey**。
2. 契约 §7 是**实时通道**（电脑控制）的逐字协议；§8 是局域网直连；§10 是**已知陷阱清单**。
3. **[`docs/android/安卓端框架设计.md`](../docs/android/安卓端框架设计.md)** —— 板块分「本机/联动」两类的设计。
4. **[`docs/android/安卓端界面与交互设计规范.md`](../docs/android/安卓端界面与交互设计规范.md)** ——
   设计令牌、导航架构、验收清单（含已踩过的坑）。
5. [`docs/协同开发规范.md`](../docs/协同开发规范.md) §3 是目录归属、§7 是怎么在没有 Windows 桌面端的情况下联调。

---

## 3. 一上手就要做对的三件事

1. **持久化 `deviceKey`**（随机 24 位 hex，首次生成后长期保存）。
   `mobile.bind` 每次都带上它。**不做这件事**：用户每次重装/清数据后重绑都会在设备列表里新增一台"我的手机"，
   很快占满上限（默认 5）。详见契约 §3.4。
   > 已实现于 `core/identity/DeviceKey.kt` + `IdentityStore`；且**解绑时刻意保留 deviceKey**。
2. **明文 HTTP 放行**：`http://192.168.x.x:9823` 在 Android 9+ 默认被拦。
   > ⚠️ **不要**照常规写法逐段列 IP：`network-security-config` 的 `<domain>` 对 IP **只做精确匹配、
   > 不支持 CIDR/通配符**，`<domain>192.168.0.0</domain>` **匹配不到** `192.168.1.5`（会静默失败）。
   > 而局域网 IP 运行时才定、每次可能变，构建期无法枚举 → 本工程用 `base-config` 放行，
   > 理由与安全权衡写在 `res/xml/network_security_config.xml` 内。
3. **判断成败的姿势**：`api.php` 的业务失败**也是 HTTP 200**（必须读 `success` 字段）；
   而 `file.php` 反过来用真实 HTTP 状态码。已在 `core/result/ApiResult` 归一，板块不用管。

---

## 4. 联调（**不需要 Windows 桌面端**）

### 4.1 常规单测（离线、确定性，进套件）

```powershell
.\gradlew.bat testDebugUnitTest      # 148 个用例
```

其中 `TaskwallMockServerTest` / `TransferMockServerTest` 用 MockWebServer 覆盖**真实网络代码路径**
（请求体形状、失败语义、令牌失效、`msg_` 前缀处理），不需要网络。

### 4.2 打真实线上服务端（可选，默认跳过）

自建测试绑定（**不要用真实绑定做实验**：`mobile.bind` 会轮换该设备凭证，会把真机顶下线）：

```bash
# 1) 建绑定
curl -s -X POST https://shortcut.326415.xyz/sync/api.php -H 'Content-Type: application/json' -d '{"action":"bind.create","deviceName":"android-dev"}'
# 2) 用返回的 code 换手机凭证（带 deviceKey）
curl -s -X POST https://shortcut.326415.xyz/sync/api.php -H 'Content-Type: application/json' -d '{"action":"mobile.bind","code":"<code>","deviceKey":"<24hex>"}'
# 3) 跑线上冒烟（会在服务端建任务并自行消费，不留残留）
.\gradlew.bat testDebugUnitTest --tests "*LiveServerSmokeTest*" -Dsc.live.bindId=<bindId> -Dsc.live.mobileToken=<mobileToken>
```

> ⚠️ **坑**：Gradle 的 `-D` 只作用于守护进程，**不进 fork 的测试 JVM**。
> 已在 `app/build.gradle.kts` 的 `testOptions.unitTests.all` 里显式透传；
> 否则测试会被静默跳过（输出报告里的 `skipped` 计数能看出来）。

### 4.3 实时控制链路

需要一个 desktop 角色的对端 → 用 [`tools/mock-desktop/`](../tools/mock-desktop/README.md)（假桌面桩）。

---

## 5. 构建与安装

```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"   # 必须 21，不能用 25
$env:GRADLE_USER_HOME = "D:\dev\gradle-home"

.\gradlew.bat assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
.\gradlew.bat installDebug       # 手机连上后直接装
adb devices ; adb logcat         # 真机调试
```

---

## 6. 提交红线

- **绝不提交**：`local.properties`、`*.keystore`、`*.jks`、`*.apk`、`*.aab`、`android/.gradle/`、`android/**/build/`
  （`.gitignore` 已配好，请勿用 `git add -f` 绕过）。
- **必须提交**：`gradle/wrapper/gradle-wrapper.jar` 与 `gradle-wrapper.properties`（已显式放行）。
- 签名 keystore 请放在仓库外单独备份；仓库里只记录**指纹（SHA-256）**。
- 提交信息格式见规范 §4.3：`<type>(android): <中文一句话>`。

---

## 7. 已完成 / 待做

**已完成**：工程骨架、core（身份/网络/错误/偏好/**blob**/**realtime**/**lan**）、
framework（本机+联动两类板块）、首页（网格/列表可切换）、设置（分片式）、绑定（含扫码）、
笔记（本机样例）、**任务墙** / **文件共享** / **电脑控制**（三个联动板块）、
界面与交互第一轮打磨（导航栈/inset/设计令牌/底部标签栏）。

**线上验证**：任务墙与文件共享都在**真实线上服务端**跑通（见
`LiveServerSmokeTest` / `LiveTransferSmokeTest`，默认跳过、提供凭据即跑）。

**待做**：推送（等桌面侧 `push.register` + OPPO 网关）、页面过渡动画、
`core/rpc` 底座、浅色主题精细打磨。
