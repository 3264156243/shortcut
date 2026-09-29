# Tauri 2 迁移回归清单（M6 验收用）

对照 Electron 版逐项人工回归。基础：`src-tauri` debug/release exe 启动后，主窗 / 灵动岛 / 任务墙 / SC球 / 语音胶囊 / 提醒窗六窗体系与托盘正常。

## 一、壳与窗口（M1/M3）
- [ ] 主窗 Alt+Space 显隐切换；关闭按钮→隐藏到托盘（不退出）
- [ ] 托盘菜单：显示主窗 / 退出；图标tooltip ShortCut
- [ ] 灵动岛显示/隐藏（Alt+I）；四角贴靠位置记忆；鼠标穿透规则（island passthrough）
- [ ] 灵动岛拖动：moveIsland 增量移动 + 工作区夹紧 + finishIslandMove 写回 position:custom
- [ ] 任务墙窗（Alt+U）：便签渲染、新增/完成/删除后 tasklist:data 广播
- [ ] SC球（deepseekball）：setBalanceMusicPlaying 开关创建/销毁
- [ ] 任务提醒窗：getReminderData 到期扫描（30s 定时）、confirmReminder/viewReminder

## 二、配置与系统（M2）
- [ ] readConfig/writeConfig 与 Electron 版 %APPDATA%\ShortCut 配置互通（同文件硬兼容）
- [ ] 开机自启 getOpenAtLogin/setOpenAtLogin
- [ ] 通知 notificationShow
- [ ] getTheme 映射注册表 AppsUseLightTheme
- [ ] 对话框系 openFile/openImportFile/openIconFile/saveFile

## 三、机器码与授权（M5 license）
- [ ] getLicenseState 机器码与 Electron 版一致（5FB0DB8C… 基准）
- [ ] activateLicense/startTrial/checkLicenseCmd/getLicensePolicy 走通激活服务器
- [ ] licenseGatePassed 门禁：未授权时任务墙后台服务停止

## 四、局域网 / 云控制（M4）
- [ ] startControl/stopControl/restartControl/getControlStatus/resetControlCode
- [ ] control 15 端点：config/status/pair 401/正码 token/未授权 401/静态文件
- [ ] startCloudControl/stopCloudControl：WS relay 连接 + 25s 心跳 + 断线重连退避

## 五、任务墙与同步
- [ ] syncGetBinding：bind.info 校验链（复用/重建）；二维码绑定
- [ ] syncPullNow：pull→taskBoards 便签写入→ack 确认；任务墙禁用时拦截
- [ ] 任务墙拖放：overlapTaskDrag/dropTaskOnList 判定与去重
- [ ] getTaskList/addTaskFromDrag/completeTaskInList/removeTaskFromList/locateTaskFromList

## 六、文件快传
- [ ] fileTransferGetState 绑定状态；sendText；sendFile 2MB 分片上传（大文件 ≥5MB）
- [ ] download：流式下载 + Content-Length 校验 + 重名覆盖 + Downloads 目录落点
- [ ] share/shareList/shareDelete/claim

## 七、音乐桥 / 驾驶舱
- [ ] startMusicBridge：SMTC 曲目推送（electron:IslandMusic→onIslandMusic）
- [ ] controlMusic/seekMusic；getMusicState
- [ ] startCockpit/getIslandCockpitState：硬件监控 exe 行流（cockpit:data/island:cockpit）

## 八、语音输入
- [ ] Alt+H 胶囊窗显隐；voiceStart 焦点检查；voiceAudio PCM 流转发（DashScope ASR）
- [ ] 空格暂停/继续、回车确认、ESC 取消（桥进程按键）
- [ ] LLM 润色（polishMode=llm）；确认后 base64 打字进目标输入框
- [ ] voice-stats 按天统计

## 九、Codex 预设
- [ ] getCodexState 首次自捕获 default 预设；saveCurrentCodexPreset 保存当前
- [ ] saveCodexPreset/deleteCodexPreset/applyCodexPreset（备份→切换→lastApplied）
- [ ] restoreCodexPreset 还原备份；openCodexFile/openCodexPresetDir

## 十、余额 / 快捷功能
- [ ] getBalanceData：deepseek 余额 + opencode 用量（60s 缓存）
- [ ] setBalanceKey/setDeepseekKey/setOpenCodeKey/openBalancePlatform/openDeepseekPlatform
- [ ] translateText 14 语言白名单；getWebsiteIcon favicon；getInstalledSoftware
- [ ] runBat 内容参数执行；getFileInfo/getFileIcon(s)；readFile/writeFile
- [ ] checkForUpdates latest.yml 版本对比

## 十一、更新（M6）
- [ ] downloadUpdate：updater.check→latest.json→进度→downloaded；installUpdate 安装器启动并重启
- [ ] 服务器端 latest.json + .sig 部署流程（见 docs/updater-deploy.md）

## 十二、内存基线
- [ ] Tauri 版启动 5 分钟 WorkingSet vs Electron 版（基线记录 docs/memory-baseline.md）
