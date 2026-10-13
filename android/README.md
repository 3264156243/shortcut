# android/ —— 安卓端（原生 Kotlin）

> **归属：安卓侧开发者。** 桌面侧（`src/`、`src-tauri/`、`server/`、`resources/`、`tools/`、`docs/*.md`）不会碰这个目录，
> 也请安卓侧不要改上述目录。分工与提交规则见 [`docs/协同开发规范.md`](../docs/协同开发规范.md)。

---

## 1. 目录现状

**本目录目前只有这份说明，还没有工程骨架**——这是刻意的：

Gradle / AGP / Kotlin / JDK 三者版本必须与你本机 Android Studio 的工具链匹配，
由**你用 Android Studio「New Project」在 `android/` 下生成**，比手写一套更容易跑通。

建议：

```
android/                     ← 本目录即工程根（.gitignore 已按此布局配置）
├── settings.gradle.kts
├── build.gradle.kts
├── gradle/wrapper/…         ← wrapper 必须入库（.gitignore 已放行 jar/properties）
├── app/
│   ├── build.gradle.kts
│   └── src/main/AndroidManifest.xml
└── README.md                ← 本文件
```

建议配置（可自行调整）：

| 项 | 建议值 | 理由 |
|---|---|---|
| `applicationId` | `com.wanan.shortcut`（或 `.mobile` 后缀） | 桌面端 app id 是 `com.wanan.shortcut`，保持品牌一致 |
| `minSdk` | 24+ | 覆盖足够广；低于 24 会缺很多现代 API |
| 语言 | Kotlin（Compose 或 View 均可） | 与项目其它部分无关，选你熟的 |
| 网络 | OkHttp（自带 WebSocket）或 Ktor | WS 是核心通道 |
| 序列化 | kotlinx.serialization 或 Moshi | 协议全是 JSON |
| 本地存储 | DataStore / EncryptedSharedPreferences | 存 `bindId`/`mobileToken`/`deviceKey` |

---

## 2. 先读什么（顺序）

1. **[`docs/移动互联-协议契约.md`](../docs/移动互联-协议契约.md)** —— 接口唯一真源。
   按 §0 → §1 → §2.6 → §3 的顺序读，就能跑通第一个闭环：**绑定 → 拿到 mobileToken → 记住 deviceKey**。
2. 契约 §7 是**实时通道**（电脑控制）的逐字协议；§8 是局域网直连；§10 是**已知陷阱清单**（开工前通读）。
3. [`docs/协同开发规范.md`](../docs/协同开发规范.md) §3 是目录归属、§7 是怎么在没有 Windows 桌面端的情况下联调。

---

## 3. 一上手就要做对的三件事

1. **持久化 `deviceKey`**（随机 24 位 hex，首次生成后长期保存；等价 Web 端的 `shortcut-device-key-v1`）。
   `mobile.bind` 每次都带上它。**不做这件事**：用户每次重装/清数据后重绑都会在设备列表里新增一台"我的手机"，
   很快占满上限（默认 5），而且用户删都删不干净。详见契约 §3.4。
2. **局域网直连要放行明文 HTTP**：`http://192.168.x.x:9823` 在 Android 9+ 默认被系统拦掉，
   需要 `res/xml/network_security_config.xml` + `AndroidManifest` 引用（`cleartextTrafficPermitted` 放行私网段）。
   **不配 = 局域网控制静默失败**。详见契约 §8.5。
3. **判断成败的姿势**：`api.php` 的业务失败**也是 HTTP 200**（必须读 `success` 字段）；
   而 `file.php` 反过来用真实 HTTP 状态码。详见契约 §1.2。

---

## 4. 联调（**不需要 Windows 桌面端**）

1. 自己建一个测试绑定，别拿别人的真实绑定做实验（`mobile.bind` 会**轮换**该设备的凭证）：
   ```bash
   curl -s -X POST https://shortcut.326415.xyz/sync/api.php \
     -H 'Content-Type: application/json' \
     -d '{"action":"bind.create","deviceName":"android-dev"}'
   ```
   返回 `{bindId, code, deskToken}`：用 `code` 走 `mobile.bind` 拿手机凭证，用 `deskToken` 当"假桌面"的身份。
2. 实时控制链路需要一个 desktop 角色的对端 → 用 [`tools/mock-desktop/`](../tools/mock-desktop/README.md)（假桌面桩）。
3. 观测点：契约 §7.2 那一节列了日志/健康检查位置。

---

## 5. 提交红线

- **绝不提交**：`local.properties`、`*.keystore`、`*.jks`、`*.apk`、`*.aab`、`android/.gradle/`、`android/**/build/`
  （`.gitignore` 已配好，请勿用 `git add -f` 绕过）。
- **必须提交**：`gradle/wrapper/gradle-wrapper.jar` 与 `gradle-wrapper.properties`（`.gitignore` 已显式放行）。
- 签名 keystore 请放在仓库外单独备份；仓库里只记录**指纹（SHA-256）**。
  丢了 keystore = 无法再给已安装用户推送更新。
- 提交信息格式见 §4.3：`<type>(android): <中文一句话>`。
