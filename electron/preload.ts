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
  getOpenAtLogin: () => ipcRenderer.invoke('app:getOpenAtLogin'),
  setOpenAtLogin: (enabled: boolean) => ipcRenderer.invoke('app:setOpenAtLogin', enabled),

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
  setIsland: (enabled: boolean, style: string, position: string, autoHideFullscreen: boolean) => ipcRenderer.invoke('island:set', enabled, style, position, autoHideFullscreen),
  moveIsland: (screenX: number, screenY: number, deltaX: number, deltaY: number) => ipcRenderer.invoke('island:move', screenX, screenY, deltaX, deltaY),
  toggleIsland: () => ipcRenderer.invoke('island:toggle'),
  onIslandConfig: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('island:config', handler);
    return () => ipcRenderer.removeListener('island:config', handler);
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
