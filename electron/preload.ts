const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (data: string) => ipcRenderer.invoke('config:write', data),

  // Shell
  openTarget: (targetPath: string) => ipcRenderer.invoke('shell:open', targetPath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  showInFolder: (targetPath: string) => ipcRenderer.invoke('shell:showInFolder', targetPath),

  // Dialogs
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFile: (name: string) => ipcRenderer.invoke('dialog:saveFile', name),
  openImportFile: () => ipcRenderer.invoke('dialog:openImportFile'),

  // File system
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, data: string) => ipcRenderer.invoke('fs:writeFile', path, data),
  fileExists: (path: string) => ipcRenderer.invoke('fs:exists', path),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),

  // System
  getInstalledSoftware: () => ipcRenderer.invoke('system:getInstalledSoftware'),
  getFileInfo: (filePath: string) => ipcRenderer.invoke('system:getFileInfo', filePath),
  getFileIcon: (filePath: string) => ipcRenderer.invoke('system:getFileIcon', filePath),
  getFileIcons: (filePaths: string[]) => ipcRenderer.invoke('system:getFileIcons', filePaths),

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
