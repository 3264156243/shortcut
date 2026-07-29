const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const globalShortcut = electron.globalShortcut;
const ipcMain = electron.ipcMain;
const Tray = electron.Tray;
const Menu = electron.Menu;
const nativeImage = electron.nativeImage;
const shell = electron.shell;
const dialog = electron.dialog;
const nativeTheme = electron.nativeTheme;
const ElectronNotification = electron.Notification;
const autoUpdater = require('electron-updater').autoUpdater;
const path = require('path');
const fs = require('fs');
const net = electron.net;

const APP_USER_MODEL_ID = 'com.wanan.shortcut';

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow: any = null;
let tray: any = null;

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unconfigured';

let updateState: {
  status: UpdateStatus;
  currentVersion: string;
  version?: string;
  progress?: number;
  error?: string;
  manual?: boolean;
  releaseNotes?: string;
} = {
  status: 'idle',
  currentVersion: app.getVersion(),
};

let autoUpdaterReady = false;

function sendUpdateState(next: Partial<typeof updateState>) {
  updateState = { ...updateState, ...next };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:state', updateState);
  }
}

function configureUpdateFeed() {
  if (!app.isPackaged) return false;
  const resourcesPath = (process as any).resourcesPath || '';
  const hasPackagedConfig = fs.existsSync(path.join(resourcesPath, 'app-update.yml'))
    || fs.existsSync(path.join(resourcesPath, 'app-update.yaml'));
  if (!hasPackagedConfig) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://shortcut.326415.xyz/updates/',
    });
  }
  return true;
}

function normalizeReleaseNotes(notes: unknown) {
  if (typeof notes === 'string') {
    const value = notes.trim();
    return value || undefined;
  }
  if (!Array.isArray(notes)) return undefined;
  const values = notes
    .map((item: any) => typeof item === 'string' ? item : item?.note)
    .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0);
  return values.length ? values.join('\n\n') : undefined;
}

function setupAutoUpdater() {
  if (autoUpdaterReady) return;
  autoUpdaterReady = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateState({ status: 'checking', currentVersion: app.getVersion(), error: undefined });
  });
  autoUpdater.on('update-available', (info: any) => {
    sendUpdateState({
      status: 'available',
      currentVersion: app.getVersion(),
      version: info?.version,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      progress: 0,
      error: undefined,
    });
  });
  autoUpdater.on('download-progress', (progress: any) => {
    sendUpdateState({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
      version: updateState.version,
      error: undefined,
    });
  });
  autoUpdater.on('update-downloaded', (info: any) => {
    sendUpdateState({
      status: 'downloaded',
      version: info?.version || updateState.version,
      progress: 100,
      error: undefined,
    });
  });
  autoUpdater.on('update-not-available', () => {
    sendUpdateState({
      status: 'not-available',
      currentVersion: app.getVersion(),
      version: undefined,
      progress: undefined,
      releaseNotes: undefined,
      error: undefined,
    });
  });
  autoUpdater.on('error', (error: any) => {
    sendUpdateState({
      status: 'error',
      currentVersion: app.getVersion(),
      error: error?.message || 'Update check failed',
    });
  });
}

async function checkForUpdates(manual = false) {
  setupAutoUpdater();
  sendUpdateState({ manual });
  if (!configureUpdateFeed()) {
    sendUpdateState({
      status: app.isPackaged ? 'unconfigured' : 'idle',
      currentVersion: app.getVersion(),
      error: undefined,
    });
    return { success: false, status: updateState.status };
  }

  try {
    await autoUpdater.checkForUpdates();
    return { success: true, status: updateState.status };
  } catch (error: any) {
    sendUpdateState({
      status: 'error',
      error: error?.message || 'Update check failed',
    });
    return { success: false, status: 'error', error: updateState.error };
  }
}

async function downloadUpdate() {
  setupAutoUpdater();
  if (updateState.status !== 'available') {
    return { success: false, status: updateState.status };
  }

  sendUpdateState({ status: 'downloading', progress: 0, manual: true, error: undefined });
  try {
    await autoUpdater.downloadUpdate();
    return { success: true, status: updateState.status };
  } catch (error: any) {
    sendUpdateState({
      status: 'error',
      error: error?.message || 'Update download failed',
      manual: true,
    });
    return { success: false, status: 'error', error: updateState.error };
  }
}
// Simple i18n for main process
const trayTranslations: Record<string, Record<string, string>> = {
  'zh-CN': {
    'tray.showHide': '显示/隐藏',
    'tray.quit': '退出',
    'app.title': 'ShortCut - 快捷面板',
  },
  'en': {
    'tray.showHide': 'Show/Hide',
    'tray.quit': 'Quit',
    'app.title': 'ShortCut - Quick Panel',
  },
};

function getTrayTranslation(key: string, locale: string = 'zh-CN'): string {
  return trayTranslations[locale]?.[key] || trayTranslations['en']?.[key] || key;
}

// Only initialize config when app is ready
let CONFIG_DIR: string;
let CONFIG_FILE: string;
let ICONS_DIR: string;

function initConfig() {
  CONFIG_DIR = path.join(app.getPath('userData'), 'shortcut');
  CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
  ICONS_DIR = path.join(CONFIG_DIR, 'icons');
}

function ensureConfigDir() {
  if (!CONFIG_DIR) initConfig();
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });
}

function readConfig(): string {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) return '';
  return fs.readFileSync(CONFIG_FILE, 'utf-8');
}

function writeConfig(data: string) {
  ensureConfigDir();
  // write to temp then rename for crash safety
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, CONFIG_FILE);
}


function expandWindowsEnv(input: string): string {
  return input.replace(/%([^%]+)%/g, (_match, name) => process.env[name] || '');
}

function normalizeExternalUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizeIconPath(iconSource: string): string {
  const expanded = expandWindowsEnv(iconSource || '').trim();
  const quoted = expanded.match(/^"([^"]+)"/);
  const raw = quoted ? quoted[1] : expanded.split(/,(?=-?\d+$)/)[0];
  return raw.trim().replace(/^"|"$/g, '');
}

async function getIconDataUrl(filePath: string): Promise<string | null> {
  try {
    const normalized = normalizeIconPath(filePath);
    if (!normalized || !fs.existsSync(normalized)) return null;
    const icon = await app.getFileIcon(normalized, { size: 'normal' });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    return null;
  }
}

async function getBestIconDataUrl(iconSource: string, fallbackPath: string): Promise<string | null> {
  return (await getIconDataUrl(iconSource)) || (await getIconDataUrl(fallbackPath));
}

function getAppIconPath(preferIco: boolean = false): string | undefined {
  const resourcesPath = (process as any).resourcesPath || '';
  const names = preferIco ? ['icon.ico', 'icon.png'] : ['icon.png', 'icon.ico'];
  const roots = [path.join(__dirname, '../resources'), resourcesPath];
  for (const root of roots) {
    for (const name of names) {
      const iconPath = path.join(root, name);
      if (fs.existsSync(iconPath)) return iconPath;
    }
  }
  return undefined;
}

function fileToDataUrl(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'ico' ? 'image/x-icon' : 'image/png';
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return null;
  }
}
const MAX_FAVICON_BYTES = 1024 * 1024;

async function fetchBuffer(url: string, accept: string, maxBytes = MAX_FAVICON_BYTES): Promise<{ data: Buffer; contentType: string; finalUrl: string }> {
  const response = await net.fetch(url, {
    headers: { Accept: accept, 'User-Agent': 'Mozilla/5.0 ShortCut/2' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > maxBytes) throw new Error('Icon file is empty or too large');
  return { data, contentType: response.headers.get('content-type') || '', finalUrl: response.url || url };
}

function findFaviconUrl(html: string, pageUrl: string) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  const candidates = linkTags.flatMap((tag: string) => {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    return /(?:^|\s)(?:shortcut\s+)?icon(?:\s|$)/i.test(rel) && href ? [href] : [];
  });
  try {
    return new URL(candidates[0] || '/favicon.ico', pageUrl).toString();
  } catch {
    return null;
  }
}

async function getWebsiteIcon(rawUrl: string): Promise<string | null> {
  try {
    const pageUrl = normalizeExternalUrl(rawUrl);
    const page = await fetchBuffer(pageUrl, 'text/html,application/xhtml+xml', 5 * 1024 * 1024);
    const html = page.data.toString('utf8').slice(0, 512 * 1024);
    const iconUrl = findFaviconUrl(html, page.finalUrl);
    if (!iconUrl) return null;
    const icon = await fetchBuffer(iconUrl, 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8');
    const mime = icon.contentType.split(';')[0] || (iconUrl.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon');
    return `data:${mime};base64,${icon.data.toString('base64')}`;
  } catch {
    return null;
  }
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    transparent: false,
    backgroundColor: '#0f1117',
    show: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    icon: getAppIconPath(true),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
  });

  // Load renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Blur handling
  mainWindow.on('blur', () => {
    // Check closeOnBlur setting
    try {
      const raw = readConfig();
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.closeOnBlur && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
        }
      }
    } catch {}
  });
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    // Send message to renderer before showing
    mainWindow.webContents.send('window:will-show');
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  // Load icon from dev resources or packaged resources.
  let icon;
  const iconPath = getAppIconPath(false);
  if (iconPath) {
    try {
      icon = nativeImage.createFromPath(iconPath);
    } catch {}
  }
  // Fallback: create a simple icon
  if (!icon || icon.isEmpty()) {
    const iconSize = 16;
    const canvas = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 16 16">
        <rect width="16" height="16" rx="3" fill="#e85d04"/>
        <path d="M8 2L4 9h3l-0.5 5 4-7h-3l0.5-5z" fill="white"/>
      </svg>
    `;
    icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`);
  }

  tray = new Tray(icon);

  // Get locale from config
  let locale = 'zh-CN';
  try {
    const raw = readConfig();
    if (raw) {
      const cfg = JSON.parse(raw);
      locale = cfg.locale || 'zh-CN';
    }
  } catch {}

  tray.setToolTip(getTrayTranslation('app.title', locale));
  tray.on('click', () => toggleWindow());
  const contextMenu = Menu.buildFromTemplate([
    { label: getTrayTranslation('tray.showHide', locale), click: () => toggleWindow() },
    { type: 'separator' },
    { label: getTrayTranslation('tray.quit', locale), click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
}

// IPC Handlers
ipcMain.handle('config:read', () => readConfig());
ipcMain.handle('config:write', (_e: any, data: string) => writeConfig(data));

ipcMain.handle('shell:open', async (_e: any, targetPath: string) => {
  try {
    await shell.openPath(targetPath);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('shell:openExternal', async (_e: any, url: string) => {
  try {
    await shell.openExternal(normalizeExternalUrl(url));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('web:getIcon', (_e: any, url: string) => getWebsiteIcon(url));

ipcMain.handle('shell:showInFolder', async (_e: any, targetPath: string) => {
  try {
    shell.showItemInFolder(targetPath);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:check', () => checkForUpdates(true));
ipcMain.handle('update:download', () => downloadUpdate());
ipcMain.handle('update:getState', () => updateState);
ipcMain.handle('update:install', () => {
  if (updateState.status !== 'downloaded') return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
});
ipcMain.handle('notification:show', (_e: any, title: string, body: string) => {
  try {
    if (!ElectronNotification.isSupported()) return false;
    const notification = new ElectronNotification({
      title,
      body,
      icon: getAppIconPath(false),
    });
    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notification.show();
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'msi'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_e: any, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:openImportFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openIconFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico', 'svg'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return fileToDataUrl(result.filePaths[0]);
});

ipcMain.handle('fs:readFile', async (_e: any, filePath: string) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
});

ipcMain.handle('fs:writeFile', async (_e: any, filePath: string, data: string) => {
  try {
    fs.writeFileSync(filePath, data, 'utf-8');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fs:exists', (_e: any, filePath: string) => {
  return fs.existsSync(filePath);
});

ipcMain.handle('app:getPath', (_e: any, name: string) => {
  return app.getPath(name as any);
});

ipcMain.handle('app:getTheme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

ipcMain.handle('app:getOpenAtLogin', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('app:setOpenAtLogin', (_e: any, enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });
  return app.getLoginItemSettings().openAtLogin;
});

// Read installed software from registry
ipcMain.handle('system:getInstalledSoftware', async () => {
  const { exec } = require('child_process');
  const softwareList: any[] = [];

  const registryPaths = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];

  for (const regPath of registryPaths) {
    try {
      const result = await new Promise<string>((resolve, reject) => {
        exec(`reg query "${regPath}" /s`, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 }, (err: any, stdout: string) => {
          if (err && !stdout) reject(err);
          else resolve(stdout || '');
        });
      });

      let currentKey = '';
      let displayName = '';
      let displayIcon = '';
      let installLocation = '';
      let uninstallString = '';

      for (const line of result.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('HKLM\\') || trimmed.startsWith('HKCU\\')) {
          // Save previous entry
          if (displayName && (installLocation || uninstallString)) {
            const exePath = findExePath(installLocation, uninstallString, displayName);
            if (exePath && !softwareList.find(s => s.path === exePath)) {
              softwareList.push({
                name: displayName,
                path: exePath,
                icon: await getBestIconDataUrl(displayIcon, exePath) || '',
              });
            }
          }
          currentKey = trimmed;
          displayName = '';
          displayIcon = '';
          installLocation = '';
          uninstallString = '';
        } else if (trimmed.startsWith('DisplayName')) {
          displayName = trimmed.split('    ').pop()?.trim() || '';
        } else if (trimmed.startsWith('DisplayIcon')) {
          displayIcon = trimmed.split('    ').pop()?.trim() || '';
        } else if (trimmed.startsWith('InstallLocation')) {
          installLocation = trimmed.split('    ').pop()?.trim() || '';
        } else if (trimmed.startsWith('UninstallString')) {
          uninstallString = trimmed.split('    ').pop()?.trim() || '';
        }
      }

      // Save last entry
      if (displayName && (installLocation || uninstallString)) {
        const exePath = findExePath(installLocation, uninstallString, displayName);
        if (exePath && !softwareList.find(s => s.path === exePath)) {
          softwareList.push({
            name: displayName,
            path: exePath,
            icon: await getBestIconDataUrl(displayIcon, exePath) || '',
          });
        }
      }
    } catch (e) {
      // Skip failed registry paths
    }
  }

  // Also scan start menu shortcuts
  const startMenuPaths = [
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
    path.join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs'),
  ];

  for (const menuPath of startMenuPaths) {
    try {
      await scanShortcuts(menuPath, softwareList);
    } catch (e) {
      // Skip failed paths
    }
  }

  return softwareList.sort((a, b) => a.name.localeCompare(b.name));
});

function findExePath(installLocation: string, uninstallString: string, name: string): string | null {
  // Try install location first
  if (installLocation && fs.existsSync(installLocation)) {
    const files = findExeFiles(installLocation);
    if (files.length > 0) return files[0];
  }

  // Try to extract path from uninstall string
  if (uninstallString) {
    const match = uninstallString.match(/"?([^"]+\.exe)"?/i);
    if (match && fs.existsSync(match[1])) {
      // Try to find the main exe in the same directory
      const dir = path.dirname(match[1]);
      const files = findExeFiles(dir);
      return files.length > 0 ? files[0] : match[1];
    }
  }

  return null;
}

function findExeFiles(dir: string, maxDepth: number = 2): string[] {
  const results: string[] = [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isFile() && item.name.endsWith('.exe') && !item.name.includes('uninstall') && !item.name.includes('setup')) {
        results.push(fullPath);
      } else if (item.isDirectory() && maxDepth > 0) {
        results.push(...findExeFiles(fullPath, maxDepth - 1));
      }
    }
  } catch (e) {
    // Skip directories we can't read
  }
  return results;
}

async function scanShortcuts(dir: string, softwareList: any[]) {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isFile() && item.name.endsWith('.lnk')) {
        try {
          const shortcut = electron.shell.readShortcutLink(fullPath);
          if (shortcut.target && shortcut.target.endsWith('.exe') && fs.existsSync(shortcut.target)) {
            const name = item.name.replace('.lnk', '');
            if (!softwareList.find(s => s.path === shortcut.target)) {
              softwareList.push({
                name: name,
                path: shortcut.target,
                icon: await getBestIconDataUrl(shortcut.icon || '', shortcut.target) || '',
              });
            }
          }
        } catch (e) {
          // Skip invalid shortcuts
        }
      } else if (item.isDirectory()) {
        await scanShortcuts(fullPath, softwareList);
      }
    }
  } catch (e) {
    // Skip directories we can't read
  }
}

// Handle file drop from external
ipcMain.handle('system:getFileInfo', async (_e: any, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let type: 'app' | 'folder' | 'file' = 'file';
    if (stat.isDirectory()) type = 'folder';
    else if (ext === '.exe' || ext === '.bat' || ext === '.cmd') type = 'app';

    return {
      name: path.basename(filePath, ext),
      path: filePath,
      type,
    };
  } catch (e) {
    return null;
  }
});

// Get file icon as data URL
ipcMain.handle('system:getFileIcon', async (_e: any, filePath: string) => {
  try {
    return await getIconDataUrl(filePath);
  } catch (e) {
    return null;
  }
});

// Batch get file icons
ipcMain.handle('system:getFileIcons', async (_e: any, filePaths: string[]) => {
  const results: Record<string, string | null> = {};
  for (const filePath of filePaths) {
    try {
      results[filePath] = await getIconDataUrl(filePath);
    } catch (e) {
      results[filePath] = null;
    }
  }
  return results;
});

ipcMain.handle('window:close', () => {
  mainWindow?.hide();
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
  return mainWindow?.isMaximized() ?? false;
});

// App lifecycle
app.whenReady().then(() => {
  setupAutoUpdater();
  createWindow();
  createTray();

  setTimeout(() => {
    void checkForUpdates();
  }, 5000);
  setInterval(() => {
    void checkForUpdates();
  }, 6 * 60 * 60 * 1000);

  // Register global hotkey
  const ret = globalShortcut.register('Alt+Space', () => {
    toggleWindow();
  });
  if (!ret) {
    console.error('Failed to register Alt+Space hotkey');
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
});

