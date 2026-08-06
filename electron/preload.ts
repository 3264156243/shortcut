const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (data: string) => ipcRenderer.invoke('config:write', data),

  // Shell
  openTarget: (targetPath: string) => ipcRenderer.invoke('shell:open', targetPath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  runBat: (content: string, runAsAdmin: boolean) => ipcRenderer.invoke('shell:runBat', content, runAsAdmin),
  showInFolder: (targetPath: string) => ipcRenderer.invoke('shell:showInFolder', targetPath),

  // Dialogs
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFile: (name: string) => ipcRenderer.invoke('dialog:saveFile', name),
  openImportFile: () => ipcRenderer.invoke('dialog:openImportFile'),
  openIconFile: () => ipcRenderer.invoke('dialog:openIconFile'),

  // File system
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, data: string) => ipcRenderer.invoke('fs:writeFile', path, data),
  fileExists: (path: string) => ipcRenderer.invoke('fs:exists', path),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getLicenseState: () => ipcRenderer.invoke('license:getState'),
  activateLicense: (code: string) => ipcRenderer.invoke('license:activate', code),
  checkLicense: () => ipcRenderer.invoke('license:check'),
  getLicenseGate: () => ipcRenderer.invoke('license:gate'),
  licenseGatePassed: () => ipcRenderer.invoke('license:gatePassed'),
  getReminderData: () => ipcRenderer.invoke('reminder:getData'),
  onReminderData: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('reminder:data', handler);
    return () => ipcRenderer.removeListener('reminder:data', handler);
  },
  confirmReminder: (boardId: string, taskId: string) => ipcRenderer.invoke('reminder:confirm', boardId, taskId),
  viewReminder: (boardId: string, taskId: string) => ipcRenderer.invoke('reminder:view', boardId, taskId),
  getTaskList: () => ipcRenderer.invoke('tasklist:get'),
  refreshTaskList: () => ipcRenderer.invoke('tasklist:refresh'),
  removeTaskFromList: (boardId: string, taskId: string) => ipcRenderer.invoke('tasklist:remove', boardId, taskId),
  completeTaskInList: (boardId: string, taskId: string) => ipcRenderer.invoke('tasklist:complete', boardId, taskId),
  locateTaskFromList: (boardId: string, taskId: string) => ipcRenderer.invoke('tasklist:locate', boardId, taskId),
  overlapTaskDrag: (screenX: number, screenY: number, boardId: string, taskId: string) => ipcRenderer.invoke('tasklist:overlap', screenX, screenY, boardId, taskId),
  dropTaskOnList: (screenX: number, screenY: number, boardId: string, taskId: string) => ipcRenderer.invoke('tasklist:drop', screenX, screenY, boardId, taskId),
  addTaskFromDrag: (boardId: string, taskId: string) => ipcRenderer.invoke('tasklist:addFromDrag', boardId, taskId),
  onTaskListData: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('tasklist:data', handler);
    return () => ipcRenderer.removeListener('tasklist:data', handler);
  },
  onConfigChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('config:changed', handler);
    return () => ipcRenderer.removeListener('config:changed', handler);
  },
  onTaskLocate: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('task:locate', handler);
    return () => ipcRenderer.removeListener('task:locate', handler);
  },
  getOpenAtLogin: () => ipcRenderer.invoke('app:getOpenAtLogin'),
  setOpenAtLogin: (enabled: boolean) => ipcRenderer.invoke('app:setOpenAtLogin', enabled),
  setAdminMode: (enabled: boolean) => ipcRenderer.invoke('app:setAdminMode', enabled),

  // System
  getInstalledSoftware: () => ipcRenderer.invoke('system:getInstalledSoftware'),
  getFileInfo: (filePath: string) => ipcRenderer.invoke('system:getFileInfo', filePath),
  getFileIcon: (filePath: string) => ipcRenderer.invoke('system:getFileIcon', filePath),
  getFileIcons: (filePaths: string[]) => ipcRenderer.invoke('system:getFileIcons', filePaths),
  getWebsiteIcon: (url: string) => ipcRenderer.invoke('web:getIcon', url),
  translateText: (text: string, from: string, to: string) => ipcRenderer.invoke('translate:text', text, from, to),
  startCockpit: () => ipcRenderer.invoke('cockpit:start'),
  stopCockpit: () => ipcRenderer.invoke('cockpit:stop'),
  onCockpitData: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('cockpit:data', handler);
    return () => ipcRenderer.removeListener('cockpit:data', handler);
  },
  showNotification: (title: string, body: string) => ipcRenderer.invoke('notification:show', title, body),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.removeListener('update:state', handler);
  },

  // Dynamic island
  getIslandState: () => ipcRenderer.invoke('island:getState'),
  setIsland: (enabled: boolean, style: string, position: string, autoHideFullscreen: boolean, musicEnabled: boolean, lyricBounce: boolean, displayState: string, orbitGlow: boolean, barsEnabled: boolean, tasksEnabled: boolean, cockpitEnabled: boolean, dailyQuoteEnabled: boolean) => ipcRenderer.invoke('island:set', enabled, style, position, autoHideFullscreen, musicEnabled, lyricBounce, displayState, orbitGlow, barsEnabled, tasksEnabled, cockpitEnabled, dailyQuoteEnabled),
  moveIsland: (screenX: number, screenY: number, deltaX: number, deltaY: number) => ipcRenderer.invoke('island:move', screenX, screenY, deltaX, deltaY),
  getIslandBounds: () => ipcRenderer.invoke('island:getBounds'),
  moveIslandTo: (x: number, y: number) => ipcRenderer.invoke('island:moveTo', x, y),
  finishIslandMove: () => ipcRenderer.invoke('island:finishMove'),
  toggleIsland: () => ipcRenderer.invoke('island:toggle'),
  onIslandConfig: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('island:config', handler);
    return () => ipcRenderer.removeListener('island:config', handler);
  },
  startMusicBridge: () => ipcRenderer.invoke('island:music:start'),
  stopMusicBridge: () => ipcRenderer.invoke('island:music:stop'),
  getMusicState: () => ipcRenderer.invoke('island:music:state'),
  getIslandCockpitState: () => ipcRenderer.invoke('island:cockpit:state'),
  getDailyQuote: () => ipcRenderer.invoke('island:quote:get'),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  controlMusic: (action: string) => ipcRenderer.invoke('island:music:control', action),
  seekMusic: (ms: number) => ipcRenderer.invoke('island:music:seek', ms),
  onIslandMusic: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('island:music', handler);
    return () => ipcRenderer.removeListener('island:music', handler);
  },
  onIslandCockpit: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('island:cockpit', handler);
    return () => ipcRenderer.removeListener('island:cockpit', handler);
  },

  // Theme
  getTheme: () => ipcRenderer.invoke('app:getTheme'),

  // Window
  closeWindow: () => ipcRenderer.invoke('window:close'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Events
  onWindowWillShow: (callback: () => void) => {
    ipcRenderer.on('window:will-show', callback);
    return () => {
      ipcRenderer.removeListener('window:will-show', callback);
    };
  },
});
