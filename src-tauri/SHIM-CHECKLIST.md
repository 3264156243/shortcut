# electronAPI → Rust 命令对账清单

> 来源：`electron/preload.ts`（139 个方法）。前端调用 `electronAPI.xxx()` → invoke `electron_api(method=xxx)`。
> 状态图例：✅ 已实现 · 🔲 待实现（按里程碑）· 📞 回调型（onXxx → emit `electron:<name>` 事件）

## M1 已实现（9）
✅ getAppVersion ✅ getAppName ✅ getPlatform ✅ getSystemInfo（占位）
✅ minimizeWindow ✅ maximizeWindow ✅ hideWindow ✅ closeWindow（=隐藏）✅ showWindow ✅ quitApp

## M2 核心骨架
- 🔲 readConfig / writeConfig / getPath / getTheme / setUsageEnabled
- 🔲 getOpenAtLogin / setOpenAtLogin（plugin-autostart）
- 🔲 getUsageData / clearUsageData / addUsageIgnored / removeUsageIgnored / addUsageBackgroundApp / removeUsageBackgroundApp / deleteUsageDay
- 🔲 getTaskList / addTaskFromDrag / completeTaskInList / removeTaskFromList / dropTaskOnList / overlapTaskDrag / locateTaskFromList / refreshTaskList / viewReminder / confirmReminder / getReminderData
- 🔲 showNotification / openExternal / openTarget / copyText
- 🔲 getVersion / isMaximized
- 📞 onReminderData / onTaskListData / onTaskLocate / onConfigChanged / onShortcutFailed / onWindowWillShow

## M3 透明窗（SC球/灵动岛/翻译胶囊）
- 🔲 toggleIsland / moveIsland / moveIslandTo / finishIslandMove / getIslandState / setIsland / getIslandBounds / getIslandCockpitState / startCockpit / stopCockpit
- 📞 onIslandConfig / onIslandCockpit / onIslandMusic / onCockpitData

## M4 控制板块
- 🔲 startControl / stopControl / restartControl / getControlStatus / resetControlCode
- 🔲 startCloudControl / stopCloudControl / getCloudControlStatus

## M5 全板块
- 翻译：🔲 translateText
- 语音：🔲 voiceOpen / voiceStart / voiceToggle / voiceCancel / voiceConfirm / voiceAudio / voiceGetConfig / voiceGetStats；📞 onVoiceSession / onVoiceStatus / onVoicePolish / onVoicePolishError
- 音乐：🔲 startMusicBridge / stopMusicBridge / controlMusic / seekMusic / getMusicState / setBalanceMusicPlaying / setDeepseekMusicPlaying
- 平台余额：🔲 getDeepseekBalance / getBalanceData / setBalanceKey / setDeepseekKey / openDeepseekPlatform / openBalancePlatform / openOpenCodePlatform
- Codex：🔲 getCodexPresetState / saveCodexPreset / deleteCodexPreset / applyCodexPreset / restoreCodexPreset / saveCurrentCodexPreset / openCodexFile / openCodexPresetDir
- 激活：🔲 checkLicense / activateLicense / startTrial / getLicenseState / getLicenseGate / licenseGatePassed / getLicensePolicy；📞 onLicenseChanged
- 文件/系统：🔲 openFile / openFolder / showInFolder / readFile / writeFile / saveFile / fileExists / getFileInfo / getFileIcon / getFileIcons / getWebsiteIcon / openIconFile / openImportFile / runBat / getInstalledSoftware
- 快传：🔲 fileTransferSendFile / fileTransferSendText / fileTransferDownload / fileTransferClaim / fileTransferGetState / fileTransferShareList / fileTransferShareText / fileTransferShareDelete / fileTransferDelete
- 绑定同步：🔲 syncGetBinding / syncPullNow
- 更新：🔲 checkForUpdates / downloadUpdate / installUpdate / getUpdateState；📞 onUpdateState
- 其他：📞 onBalanceMerge / onDeepseekMerge

## 统计
- 已实现：10 / 139 · 回调型：19
- M1-M6 每完成一个里程碑更新本清单
