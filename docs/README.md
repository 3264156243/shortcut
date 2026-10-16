# ShortCut 文档地图

> **先看这一页**：三分钟知道"项目现在是什么状态、我该读哪份文档、哪份是权威"。
> 最后更新：2026-10-17（仓库整理后）

---

## 一、项目现状（一句话）

ShortCut = **Tauri 2 桌面包 + React 前端 + 移动互联平台（PHP 服务端 + 移动 Web）**，
外加一位协作者正在同一仓库里做 **原生 Kotlin 安卓端**。

> 技术栈迁移（Electron → Tauri 2）**已完成**：当前主线是 `src/` + `src-tauri/`。
> `electron/`、`release/win-unpacked/`、`electron-builder.json5` 等属于**历史遗留**（见 §五），不再改动。

---

## 二、按角色选阅读路径

| 我是谁 | 按顺序读 |
|---|---|
| **安卓端开发者** | [`协作交流-问答台.md`](协作交流-问答台.md) §1（桌面侧等你确认的问题）→ [`移动互联-协议契约.md`](移动互联-协议契约.md) §0→§1→§2.6→§3 → [`协同开发规范.md`](协同开发规范.md) §1.3（上手顺序）→ [`../tools/mock-desktop/README.md`](../tools/mock-desktop/README.md)（联调桩） |
| **桌面端开发者（我）** | [`desktop/tauri-regression.md`](desktop/tauri-regression.md)（启动方式/构建顺序/踩坑总集）→ [`ROADMAP-架构演进.md`](ROADMAP-架构演进.md)（架构决策记录）→ 各功能文档 |
| **服务端维护者** | [`server/updater-deploy.md`](server/updater-deploy.md)（更新发布）→ [`server/安全事件-同步数据目录暴露-20261008.md`](server/安全事件-同步数据目录暴露-20261008.md)（安全事件复盘）→ [`移动互联-协议契约.md`](移动互联-协议契约.md)（接口真源） |
| **刚接手 / 想了解全貌** | 本页 → [`archive/PROJECT_STATUS.md`](archive/PROJECT_STATUS.md)（历史状态快照，⚠️ 部分过时） |

---

## 三、权威性分级（冲突时以谁为准）

| 级别 | 文档 | 说明 |
|---|---|---|
| ① **唯一真源** | [`移动互联-协议契约.md`](移动互联-协议契约.md) | 接口字段/错误文案/协议版本。与代码冲突即为 bug |
| ① **协作规则** | [`协同开发规范.md`](协同开发规范.md) | 分工、目录归属、分支与提交、构建与验证 |
| ① **沟通通道** | [`协作交流-问答台.md`](协作交流-问答台.md) | 提问、待办、已确认共识（留痕） |
| ② **架构决策** | [`ROADMAP-架构演进.md`](ROADMAP-架构演进.md) | 架构级决策记录（D1/D2/…），变更需更新它 |
| ③ **功能与踩坑** | `desktop/`、`mobile/`、`server/` 下各文档 | 具体功能的方案、实测数据、验收步骤 |
| ④ **历史** | `archive/` | Electron 时期与过期内容，**只作考古**，勿据此操作 |

> 📌 判断"某文档是否还作数"的快捷办法：**看它有没有被 §三①/② 引用**。没被引用又放在 archive/ 之外的，
> 说明该更新或归档了。

---

## 四、目录结构

```
docs/
├── README.md                      ← 本页
├── 移动互联-协议契约.md             ★ 跨端接口唯一真源（协作接口，路径稳定不动）
├── 协同开发规范.md                  ★ 分工/分支/提交/构建（协作接口）
├── 协作交流-问答台.md               ★ 提问/待办/共识（协作接口）
├── ROADMAP-架构演进.md              ★ 架构决策记录
│
├── desktop/                       桌面端功能、方案、实测与踩坑
│   ├── tauri-regression.md           ★ 启动方式 / 构建顺序 / UIPI / 回归清单（最常查）
│   ├── 灵动岛开发规划.md               岛的整体规划
│   ├── island-drop-convert-rework.md  拖放转格式改造
│   ├── 球穿透开关修复说明.md            穿透开关语义与实测（含与拖放的取舍）
│   ├── 主程序修复-更多菜单层级与穿透失效.md
│   ├── 驾驶舱温度与拖放冲突-解决方案.md     驾驶舱提权 × 拖放冲突（计划任务方案）
│   ├── game-mode-freeze.md           游戏模式（冻结后台）
│   ├── memory-baseline.md            内存基线对比
│   └── 文件转换板块开发计划.md
│
├── mobile/                        移动互联（协议细节见根目录契约）
│   ├── 移动互联架构现状与目标.md        四层架构与现状核验
│   ├── 移动互联设备管理-部署与验收.md     设备列表/改名/移除
│   ├── 移动互联身份层加固-部署与验收.md   身份层加固（S1/S2/S3）
│   ├── 局域网一键直连-设计与验收.md      手机点一下直连局域网
│   ├── 移动互联-任务墙板块待办.md
│   ├── 移动端联动开发计划.md
│   ├── 文件快传与通用移动联动开发计划.md
│   └── 文件快传审计问题清单.md
│
├── server/                        服务端与运维
│   ├── updater-deploy.md            更新发布（Tauri updater + latest.json + 签名）
│   ├── 安全事件-同步数据目录暴露-20261008.md
│   └── 项目网站需求.md
│
├── references/                    外部参考项目
│   ├── README.md                    状态 × 功能 两维索引（新增参考项目照此登记）
│   ├── notes/                       每个项目的阅读笔记（进版本库）
│   └── <项目名>/                     本地克隆（**不入库**，各自 git pull）
│
└── archive/                       历史（只作考古）
    ├── HANDOVER.md                  ⚠️ Electron 时期交接（讲 app.asar / win-unpacked）
    ├── PROJECT_STATUS.md            历史状态快照（54KB）
    ├── requirements.md / requirements-usage-record.md
    └── TAURI2-重构计划书.md           迁移计划（已执行完）
```

---

## 五、历史遗留（不再改动，别在它上面加功能）

| 东西 | 状态 | 何时能删 |
|---|---|---|
| `electron/`（10 个 ts） | 冻结 | 已切换日常启动到 Tauri 版；确认一段时间无回退需求后即可删 |
| `release/win-unpacked/`（Electron 验收包，~335MB） | **保留作回退** | 同上（安装包已全部移出到云端归档） |
| `dist-electron/` | 已删（可再生） | — |
| `electron-builder.json5`、`tsconfig.electron.json`、`package.json` 的 `electron:*` 脚本 | 冻结 | 与 `electron/` 一起删 |
| `config-rescue/` | 已从版本库移除（历史保留） | — |

> **启动方式（2026-10-17 起）**：开机自启、桌面与开始菜单快捷方式全部指向 Tauri 版
> `src-tauri/target/release/shortcut-tauri.exe`；用 `scripts/run-app.ps1` 可"以普通权限启动并校验完整性级别"。
> ⚠️ 该路径是构建产物目录：**别对它 `cargo clean`**，否则自启会指向不存在的文件（正式做法是以后出安装包）。
