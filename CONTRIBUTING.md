# 贡献指南

感谢关注 ShortCut。仓库里有**两端并行开发**（桌面端 / 安卓端），且共享一个线上服务端，
所以提交前请先看这份指南。更细的规则见 [docs/协同开发规范.md](./docs/协同开发规范.md)。

---

## 一、先读三份文档

| 文档 | 作用 |
|---|---|
| [docs/README.md](./docs/README.md) | **文档地图**：哪些是权威、按角色该读什么 |
| [docs/移动互联-协议契约.md](./docs/移动互联-协议契约.md) | **接口唯一真源**：API / WS 消息 / 字段 / 变更日志 |
| [docs/协同开发规范.md](./docs/协同开发规范.md) | 分工、目录归属、分支、提交、构建与验证 |

> 原则：**代码与契约冲突时，以契约为准**；改接口必须先改契约文档，再改实现。

## 二、目录归属（别越界改别人的地盘）

| 路径 | 归属 |
|---|---|
| `src/`、`src-tauri/`、`public/`、`scripts/`、`tools/` | 桌面侧 |
| `server/` | 桌面侧（**部署也归桌面侧**） |
| `android/`、`docs/android/` | 安卓侧 |
| `docs/移动互联-协议契约.md`、`docs/协同开发规范.md` | 共享，改动前在问答台说明 |

跨边界改动请先在 [docs/协作交流-问答台.md](./docs/协作交流-问答台.md) 提一句。

## 三、分支

| 分支 | 用途 |
|---|---|
| `main` | 主线（默认分支），保持可构建 |
| `codex/tauri2-migration` | 桌面端功能开发 |
| `feature/android-shell` | 安卓端开发 |
| `feature/<scope>-<短描述>` | 其它功能分支 |

## 四、提交

- 提交信息：`type(scope): 中文一句话`，例如 `fix(island): 修正穿透开关在收起态失效`
- `type`：`feat` / `fix` / `docs` / `chore` / `refactor` / `perf` / `test`
- **一次提交只做一件事**；不要混入无关格式化
- 涉及"为什么这样改"的坑，写进提交正文（这类信息比代码更值钱）

## 五、提交前自检

```powershell
# 1) 前端类型 + 构建
npx tsc --noEmit
npm run build

# 2) Rust 编译检查
cd src-tauri
cargo check --release --features custom-protocol

# 3) 跑一遍应用（普通权限，管理员会掐断拖放）
powershell -ExecutionPolicy Bypass -File scripts\run-app.ps1
```

安卓端：`assembleDebug` 可出包 + 单测全绿（详见 `android/README.md`）。

## 六、绝不能提交的东西

```text
keystore.properties  /  *.jks  /  *.apk      # 签名材料与产物
任何私钥、令牌、服务器密码                    # 包括文档/脚本里的明文
node_modules/  dist/  src-tauri/target/      # 构建产物
本地绝对路径（C:\Users\<你的用户名>\…）        # 文档里请用 %USERPROFILE%
```

`.gitignore` 已覆盖上述大部分内容。**绝不要用 `git add -f` 绕过忽略规则**。
万一误提交了凭据：立刻更换该凭据，并告知维护者（历史里的凭据视为已泄漏）。

## 七、安全

漏洞请走私密渠道，**不要开公开 issue** —— 见 [SECURITY.md](./SECURITY.md)。

## 八、许可

提交代码即表示同意以 [MIT License](./LICENSE) 授权本项目。
引入第三方代码请确认许可证兼容（GPL/AGPL 强传染，**禁止复制或翻译其代码**，
只能借鉴思路——参考项目清单见 [docs/references/README.md](./docs/references/README.md)）。
