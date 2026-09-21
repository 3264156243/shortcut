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
const clipboard = electron.clipboard;
const electronScreen = electron.screen;
const desktopCapturer = electron.desktopCapturer;
const autoUpdater = require('electron-updater').autoUpdater;
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const net = electron.net;
const nodeCrypto = require('crypto');
const session = electron.session;

const APP_USER_MODEL_ID = 'com.wanan.shortcut';

function registerShortcut(accelerator: string, name: string, callback: () => void): boolean {
  const ok = globalShortcut.register(accelerator, callback);
  if (!ok) {
    console.error(`Failed to register ${name} (${accelerator})`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('shortcut:failed', { accelerator, name });
      } catch {}
    }
  }
  return ok;
}

function ensureGlobalShortcut(accelerator: string, name: string, callback: () => void): boolean {
  try {
    if (globalShortcut.isRegistered(accelerator)) globalShortcut.unregister(accelerator);
  } catch {}
  return registerShortcut(accelerator, name, callback);
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow: any = null;
let tray: any = null;
let translationBubble: any = null;
let translationBubbleCloseTimer: ReturnType<typeof setTimeout> | null = null;
let translationBubblePinned = false;
let selectionTranslationBusy = false;
let hardwareMonitorProcess: any = null;
let hardwareMonitorBuffer = '';
let captureOverlay: any = null;
let islandWindow: any = null;
let islandProgrammaticMove = false;
let islandProgrammaticMoveUntil = 0;
let islandUserHidden = false;
let musicBridgeProcess: any = null;
let musicBridgeBuffer = '';
let latestMusicState: any = null;
let reminderWindows = new Map<string, any>();
let reminderDataByWindow = new Map<number, any>();
let taskListWindow: any = null;
let deepseekBallWindow: any = null;
let taskListHidden = false;
let currentDragTask: { boardId: string; taskId: string } | null = null;
let licenseGatePassed = false;
let islandCockpitActive = false;
let mainCockpitActive = false;
let latestCockpitData: any = null;
let latestDeepseek: any = null;
let latestDeepseekAt = 0;
let latestOpenCode: any = null;
let latestOpenCodeAt = 0;
let usageMonitorProcess: any = null;
let usageMonitorBuffer = '';
let usageRecord: any = null;
let usageRecordLastTick = 0;
let usageIconCache = new Map<string, string | null>();
const USAGE_ICON_CACHE_LIMIT = 160;
let usageFlushTimer: ReturnType<typeof setInterval> | null = null;
let usageCurrent: { exe: string; name: string; title: string; startedAt: number } | null = null;

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unconfigured';

let updateState: {
  status: UpdateStatus;
  currentVersion: string;
  version?: string;
  progress?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
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
      bytesPerSecond: Math.max(0, Number(progress?.bytesPerSecond) || 0),
      transferred: Math.max(0, Number(progress?.transferred) || 0),
      total: Math.max(0, Number(progress?.total) || 0),
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

  sendUpdateState({ status: 'downloading', progress: 0, bytesPerSecond: 0, transferred: 0, total: undefined, manual: true, error: undefined });
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
const ISLAND_SIZE = { width: 360, height: 340 };
const ISLAND_COLLAPSED_HEIGHT = 70;
const ISLAND_POSITIONS: Record<string, { x: number; y: number }> = {
  'top-center': { x: 0.5, y: 0.08 },
  'top-left': { x: 0.12, y: 0.08 },
  'top-right': { x: 0.88, y: 0.08 },
  'left-center': { x: 0.12, y: 0.5 },
  'right-center': { x: 0.88, y: 0.5 },
};

function getIslandPreferences(): any {
  try {
    const raw = readConfig();
    const island = raw ? JSON.parse(raw)?.island : undefined;
    return {
      enabled: island?.enabled !== false,
      style: island?.style || 'capsule',
      position: island?.position || 'top-center',
      autoHideFullscreen: island?.autoHideFullscreen !== false,
      musicEnabled: island?.musicEnabled !== false,
      tasksEnabled: island?.tasksEnabled !== false,
      cockpitEnabled: island?.cockpitEnabled === true,
      deepseekEnabled: island?.deepseekEnabled === true,
      balanceProvider: currentBalanceProvider({ island }),
      lyricBounce: island?.lyricBounce !== false,
      orbitGlow: island?.orbitGlow !== false,
      barsEnabled: island?.barsEnabled !== false,
      displayState: island?.displayState || 'collapsed',
      ...(island?.x != null ? { x: island.x } : {}),
      ...(island?.y != null ? { y: island.y } : {}),
    };
  } catch {
    return {
      enabled: true,
      style: 'capsule',
      position: 'top-center',
      autoHideFullscreen: true,
      musicEnabled: true,
      tasksEnabled: true,
      cockpitEnabled: false,
      deepseekEnabled: false,
      balanceProvider: 'none',
      lyricBounce: true,
      orbitGlow: true,
      barsEnabled: true,
      displayState: 'collapsed',
    };
  }
}

function isIslandEnabled(prefs: any): boolean {
  return prefs?.enabled !== false;
}

function islandPositionBounds(prefs: any): { x: number; y: number; width: number; height: number } {
  const position = prefs.position || 'top-center';
  const preset = ISLAND_POSITIONS[position] || ISLAND_POSITIONS['top-center'];
  const display = electronScreen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(ISLAND_SIZE.width, Math.max(260, area.width));
  const height = Math.min(ISLAND_SIZE.height, Math.max(220, area.height));
  const customX = Number(prefs.x);
  const customY = Number(prefs.y);
  if (position === 'custom' && Number.isFinite(customX) && Number.isFinite(customY)) {
    return {
      x: Math.max(area.x, Math.min(area.x + area.width - width, Math.round(customX))),
      y: Math.max(area.y, Math.min(area.y + area.height - height, Math.round(customY))),
      width,
      height,
    };
  }
  return {
    x: Math.round(area.x + area.width * preset.x - width / 2),
    y: Math.round(area.y + area.height * preset.y),
    width,
    height,
  };
}

function anyFullscreenWindow(): boolean {
  try {
    return BrowserWindow.getAllWindows().some((win: any) => !win.isDestroyed() && win.isVisible() && win.isFullScreen());
  } catch {
    return false;
  }
}

function applyIslandVisibility() {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  applyIslandMousePassthrough();
  const prefs = getIslandPreferences();
  if (prefs.autoHideFullscreen !== false && anyFullscreenWindow()) {
    islandWindow.hide();
  } else if (isIslandEnabled(prefs) && !islandUserHidden) {
    islandWindow.showInactive();
  }
}

function applyIslandMousePassthrough() {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const prefs = getIslandPreferences();
  const expanded = prefs.displayState === 'expanded';
  islandWindow.setIgnoreMouseEvents(!expanded, { forward: true });
}

function positionIslandWindow(force = false) {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const bounds = islandPositionBounds(getIslandPreferences());
  islandProgrammaticMove = true;
  islandProgrammaticMoveUntil = Date.now() + 1000;
  islandWindow.setBounds(bounds);
  islandProgrammaticMove = false;
  if (force) applyIslandVisibility();
}

function createIslandWindow() {
  if (!licenseGatePassed) return;
  if (!readModuleEnabled('island')) return;
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandUserHidden = false;
    islandWindow.showInactive();
    return;
  }
  const prefs = getIslandPreferences();
  if (!isIslandEnabled(prefs)) return;
  const bounds = islandPositionBounds(prefs);
  islandWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  islandWindow.setAlwaysOnTop(true, 'screen-saver');
  islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyIslandMousePassthrough();
  if (process.env.VITE_DEV_SERVER_URL) {
    islandWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '/island.html');
  } else {
    islandWindow.loadFile(path.join(__dirname, '../dist/island.html'));
  }
  islandWindow.once('ready-to-show', () => {
    applyIslandVisibility();
  });
  if (readModuleEnabled('island') && readFeatureEnabled('island.music') && prefs?.musicEnabled !== false) {
    startMusicBridge();
  } else if (islandWindow && !islandWindow.isDestroyed()) {
    stopMusicBridge();
  }
  islandCockpitActive = prefs?.cockpitEnabled === true && readModuleEnabled('cockpit') && readFeatureEnabled('island.cockpit');
  syncHardwareMonitor();
  islandWindow.on('closed', () => { islandWindow = null; });
  islandWindow.on('move', () => positionDeepseekBall());
  islandWindow.on('moved', () => {
    if (!islandWindow || islandWindow.isDestroyed()) return;
    if (islandProgrammaticMove || Date.now() < islandProgrammaticMoveUntil) return;
    const [x, y] = islandWindow.getPosition();
    writeIslandConfig({ position: 'custom', x, y });
    positionDeepseekBall();
  });
}

function getMusicBridgePath() {
  return app.isPackaged
    ? path.join((process as any).resourcesPath, 'music-bridge', 'netmusic-bridge.ps1')
    : path.join(__dirname, '..', 'resources', 'music-bridge', 'netmusic-bridge.ps1');
}

function sendIslandMusic(state: any) {
  latestMusicState = state;
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.webContents.send('island:music', state);
  }
}

function startMusicBridge() {
  if (musicBridgeProcess) return { success: true };
  const script = getMusicBridgePath();
  if (!fs.existsSync(script)) {
    return { success: false, error: '音乐桥接脚本不存在' };
  }
  try {
    musicBridgeProcess = childProcess.spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', script,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    musicBridgeProcess.stdout.setEncoding('utf8');
    musicBridgeProcess.stdout.on('data', (chunk: string) => {
      musicBridgeBuffer += chunk;
      const lines = musicBridgeBuffer.split(/\r?\n/);
      musicBridgeBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          sendIslandMusic(JSON.parse(line));
        } catch {}
      }
    });
    musicBridgeProcess.on('exit', () => {
      musicBridgeProcess = null;
      musicBridgeBuffer = '';
    });
    musicBridgeProcess.on('error', () => {
      stopMusicBridge();
    });
    return { success: true };
  } catch (error: any) {
    stopMusicBridge();
    return { success: false, error: error?.message || '音乐桥接启动失败' };
  }
}

function stopMusicBridge() {
  if (!musicBridgeProcess) return;
  const processToStop = musicBridgeProcess;
  musicBridgeProcess = null;
  musicBridgeBuffer = '';
  try { processToStop.kill(); } catch {}
}

function runMusicBridgeCommand(args: string[]) {
  const script = getMusicBridgePath();
  return new Promise<any>((resolve) => {
    let child: any;
    try {
      child = childProcess.spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', script,
        ...args,
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error: any) {
      resolve({ success: false, error: error?.message || '命令执行失败' });
      return;
    }
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { out += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { err += chunk; });
    child.once('close', () => {
      try {
        const firstLine = out.trim().split(/\r?\n/)[0];
        resolve(firstLine ? JSON.parse(firstLine) : { success: false, error: err.trim() || '命令执行失败' });
      } catch {
        resolve({ success: false, error: err.trim() || '命令输出解析失败' });
      }
    });
    child.once('error', (error: Error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

const LICENSE_API_URL = 'https://shortcut.326415.xyz/activation/api.php';

let machineProfilePromise: Promise<any> | null = null;
let machineProfileCache: any = null;

const MACHINE_FINGERPRINT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$props = [ordered]@{}
function Get-Value($obj, $name) {
  try { $v = $obj.$name } catch { return '' }
  if ($null -eq $v) { return '' }
  return ([string]$v).Trim()
}
function Add-Prop($key, $value) {
  $s = [string]$value
  $props[$key] = $s.Trim()
}
$cs = Get-CimInstance Win32_ComputerSystemProduct
if ($cs) {
  Add-Prop 'systemUuid' (Get-Value $cs 'UUID')
  Add-Prop 'systemSerial' (Get-Value $cs 'IdentifyingNumber')
}
$bb = Get-CimInstance Win32_BaseBoard
if ($bb) {
  Add-Prop 'baseboardSerial' (Get-Value $bb 'SerialNumber')
  Add-Prop 'baseboardProduct' (Get-Value $bb 'Product')
}
$bios = Get-CimInstance Win32_BIOS
if ($bios) { Add-Prop 'biosSerial' (Get-Value $bios 'SerialNumber') }
$cpu = Get-CimInstance Win32_Processor
if ($cpu) {
  Add-Prop 'cpuId' (Get-Value $cpu 'ProcessorId')
  Add-Prop 'cpuModel' (Get-Value $cpu 'Name')
}
$disk = Get-CimInstance Win32_DiskDrive | Sort-Object Index | Select-Object -First 1
if ($disk) {
  Add-Prop 'diskSerial' (Get-Value $disk 'SerialNumber')
  Add-Prop 'diskModel' (Get-Value $disk 'Model')
}
$guid = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid
if ($guid) { Add-Prop 'machineGuid' $guid.MachineGuid }
$adapterMacs = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.MacAddress -and $_.MacAddress -ne '00-00-00-00-00-00' } | Select-Object -ExpandProperty MacAddress | ForEach-Object { ($_ -replace '[-:]','').ToUpper() })
$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress)
$props['adapterMacs'] = @($adapterMacs)
$props['lanIps'] = @($lanIps)
$props['hostname'] = $env:COMPUTERNAME
$props['platform'] = $env:PROCESSOR_ARCHITECTURE
$result = [ordered]@{ success = $true; fields = $props; collectedAt = (Get-Date).ToString('o') }
$result | ConvertTo-Json -Compress -Depth 4
`;

function runFingerprintScript(): Promise<any> {
  return new Promise<any>((resolve) => {
    let child: any;
    try {
      child = childProcess.spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', MACHINE_FINGERPRINT_SCRIPT,
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error: any) {
      resolve({ success: false, error: error?.message || '指纹采集启动失败' });
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ success: false, error: '指纹采集超时' });
    }, 15000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { out += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { err += chunk; });
    child.once('close', () => {
      clearTimeout(timer);
      try {
        const firstLine = out.trim().split(/\r?\n/)[0];
        if (firstLine) {
          resolve(JSON.parse(firstLine));
        } else {
          resolve({ success: false, error: err.trim() || '指纹采集无输出' });
        }
      } catch {
        resolve({ success: false, error: err.trim() || '指纹采集输出解析失败' });
      }
    });
    child.once('error', (error: Error) => {
      clearTimeout(timer);
      resolve({ success: false, error: error.message });
    });
  });
}

async function getMachineProfile(): Promise<any> {
  if (machineProfileCache) return machineProfileCache;
  if (!machineProfilePromise) {
    machineProfilePromise = (async () => {
      const nodeMacs: string[] = [];
      const nodeLanIps: string[] = [];
      const interfaces = os.networkInterfaces();
      for (const key of Object.keys(interfaces)) {
        for (const item of interfaces[key] || []) {
          if (item.internal) continue;
          if (item.mac && item.mac !== '00:00:00:00:00:00') {
            nodeMacs.push(item.mac.replace(/[-:]/g, '').toUpperCase());
          }
          if (item.family === 'IPv4' && item.address && item.address !== '127.0.0.1' && !item.address.startsWith('169.254.')) {
            nodeLanIps.push(item.address);
          }
        }
      }
      const payload = await runFingerprintScript();
      const fields = payload?.success && payload?.fields ? payload.fields : null;
      const copyFields = fields ? JSON.parse(JSON.stringify(fields)) : null;
      const lanIps = Array.from(new Set([...(copyFields?.lanIps || []), ...nodeLanIps])).filter(Boolean) as string[];
      const macs = Array.from(new Set([...(copyFields?.adapterMacs || []), ...nodeMacs])).filter(Boolean) as string[];
      machineProfileCache = {
        fields: copyFields,
        source: copyFields ? 'hardware' : 'fallback',
        hostname: copyFields?.hostname || os.hostname(),
        lanIps,
        macs,
        collectedAt: payload?.collectedAt || new Date().toISOString(),
      };
      return machineProfileCache;
    })();
  }
  return machineProfilePromise;
}

function getMachineFingerprintProfile(): any {
  return machineProfileCache || { source: 'pending' };
}

async function getMachineCode(): Promise<string> {
  const profile = await getMachineProfile();
  const fields = profile?.fields;
  if (fields) {
    const stableKeys = [
      'systemUuid',
      'systemSerial',
      'baseboardSerial',
      'baseboardProduct',
      'biosSerial',
      'cpuId',
      'cpuModel',
      'diskSerial',
      'diskModel',
      'machineGuid',
    ];
    const parts = stableKeys.map((key) => `${key}=${String(fields[key] || '').trim().toUpperCase()}`);
    parts.push(`macs=${(profile.macs || []).map((mac: string) => mac.replace(/[-:]/g, '')).sort().join(',')}`);
    const source = parts.sort().join('|');
    return nodeCrypto.createHash('sha256').update(source).digest('hex').slice(0, 32).toUpperCase();
  }
  let mac = '';
  const interfaces = os.networkInterfaces();
  for (const key of Object.keys(interfaces)) {
    for (const item of interfaces[key] || []) {
      if (!item.internal && item.mac && item.mac !== '00:00:00:00:00:00') {
        mac = item.mac;
        break;
      }
    }
    if (mac) break;
  }
  const source = [os.hostname(), mac, os.arch(), os.cpus()[0]?.model || '', os.platform()].join('|');
  return nodeCrypto.createHash('sha256').update(source).digest('hex').slice(0, 32).toUpperCase();
}

async function licenseRequest(action: string, payload: any = {}) {
  const response = await net.fetch(LICENSE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, message: text || '激活服务响应异常' };
  }
}

function readLicense(): any {
  const cfg = readConfigObject();
  return cfg?.license || {};
}

function writeLicense(license: any) {
  const cfg = readConfigObject();
  if (!cfg) return false;
  writeConfig(JSON.stringify({ ...cfg, license: { ...(cfg.license || {}), ...license } }, null, 2));
  return true;
}

function buildClientInfoPayload(): any {
  const profile = getMachineFingerprintProfile();
  return {
    appVersion: app.getVersion(),
    platform: `${os.platform()} ${os.arch()}`,
    hostname: profile?.hostname || os.hostname(),
    lanIps: profile?.lanIps || [],
    macs: profile?.macs || [],
    machineSource: profile?.source || 'pending',
    // 板块清单（含改名）随校验/上报自动同步到服务端
    modules: [
      { id: 'shortcuts', label: '快捷' },
      { id: 'tasks', label: '任务' },
      { id: 'cockpit', label: '驾驶舱' },
      { id: 'translate', label: '翻译' },
      { id: 'fileTransfer', label: '文件快传' },
      { id: 'usage', label: '统计' },
      { id: 'island', label: 'SC球' },
      { id: 'codexProvider', label: '供应商' },
      { id: 'voiceInput', label: '语音' },
    ],
  };
}

async function checkLicense(code?: string) {
  const machineCode = await getMachineCode();
  const current = readLicense();
  const activeCode = code || current.code;
  const result = await licenseRequest('check', {
    code: activeCode || '',
    machineCode,
    clientInfo: buildClientInfoPayload(),
  });
  writeLicense({
    code: activeCode,
    machineCode,
    plan: result.plan,
    status: result.success ? 'active' : 'invalid',
    expiresAt: result.expiresAt,
    lastCheckAt: new Date().toISOString(),
    message: result.message,
    tier: result.tier,
    activationPolicy: result.activationPolicy,
    moduleAccess: result.moduleAccess,
    featureAccess: result.featureAccess,
    guestEnabled: result.guestEnabled,
    contactLine: result.contactLine,
  });
  return { ...result, machineCode };
}

function checkLicenseOnStartup() {
  void checkLicense().catch(() => undefined);
}

async function reportDeviceStartup() {
  try {
    const machineCode = await getMachineCode();
    const current = readLicense();
    await licenseRequest('report', {
      code: current.code || '',
      machineCode,
      clientInfo: buildClientInfoPayload(),
    });
  } catch {
    // 设备上报失败不阻塞启动
  }
}

const DEEPSEEK_BALANCE_API = 'https://api.deepseek.com/user/balance';
const OPENCODE_USAGE_API = 'https://opencode.ai/zen/go/v1/usage';
const OPENCODE_WORKSPACE_URL = 'https://opencode.ai/workspace/wrk_01M00CWWMMNAXGCSG43KM5MMSD/go';

function currentBalanceProvider(cfg?: any): 'none' | 'deepseek' | 'opencode' {
  const island = cfg?.island || {};
  if (island.balanceProvider === 'deepseek' || island.balanceProvider === 'opencode') {
    return island.balanceProvider;
  }
  return island.deepseekEnabled === true ? 'deepseek' : 'none';
}

async function getDeepseekBalance(force = false) {
  const apiKey = readConfigObject()?.island?.deepseekApiKey;
  if (!apiKey) {
    return { provider: 'deepseek', configured: false, error: '未配置 API Key' };
  }
  if (!force && latestDeepseek && Date.now() - latestDeepseekAt < 60000) {
    return latestDeepseek;
  }
  try {
    const response = await net.fetch(DEEPSEEK_BALANCE_API, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    const data = await response.json();
    const info = Array.isArray(data?.balance_infos) ? data.balance_infos[0] : null;
    latestDeepseek = {
      provider: 'deepseek',
      configured: true,
      currency: info?.currency || 'CNY',
      balance: info?.total_balance != null ? Number(info.total_balance) : null,
      granted: info?.granted_balance != null ? Number(info.granted_balance) : null,
      toppedUp: info?.topped_up_balance != null ? Number(info.topped_up_balance) : null,
      available: data?.is_available !== false,
    };
  } catch {
    latestDeepseek = { provider: 'deepseek', configured: true, error: '余额获取失败' };
  }
  latestDeepseekAt = Date.now();
  return latestDeepseek;
}

async function getOpenCodeUsage(force = false) {
  const apiKey = readConfigObject()?.island?.opencodeApiKey;
  if (!apiKey) {
    return { provider: 'opencode', configured: false, error: '未配置 API Key' };
  }
  if (!force && latestOpenCode && Date.now() - latestOpenCodeAt < 60000) {
    return latestOpenCode;
  }
  try {
    const response = await net.fetch(OPENCODE_USAGE_API, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    if (!response.ok) {
      latestOpenCode = { provider: 'opencode', configured: true, error: response.status === 401 ? 'API Key 无效' : `请求失败 (${response.status})` };
      latestOpenCodeAt = Date.now();
      return latestOpenCode;
    }
    const data = await response.json();
    const usage = data?.usage || {};
    const pick = (window: any) => {
      if (!window || typeof window !== 'object') return undefined;
      const percent = Number(window.percent);
      return {
        status: window.status || 'ok',
        percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : undefined,
        resetsAt: window.resetsAt,
      };
    };
    latestOpenCode = {
      provider: 'opencode',
      configured: true,
      rolling: pick(usage.rolling),
      weekly: pick(usage.weekly),
      monthly: pick(usage.monthly),
    };
  } catch {
    latestOpenCode = { provider: 'opencode', configured: true, error: '用量获取失败' };
  }
  latestOpenCodeAt = Date.now();
  return latestOpenCode;
}

async function getBalanceData(force = false) {
  const provider = currentBalanceProvider(readConfigObject());
  if (provider === 'deepseek') return getDeepseekBalance(force);
  if (provider === 'opencode') return getOpenCodeUsage(force);
  return { provider: 'none', configured: false };
}

function getHardwareMonitorPath() {
  return app.isPackaged
    ? path.join((process as any).resourcesPath, 'hardware-monitor', 'ShortCut.HardwareMonitor.exe')
    : path.join(__dirname, '..', 'resources', 'hardware-monitor', 'ShortCut.HardwareMonitor.exe');
}

function stopHardwareMonitor() {
  if (!hardwareMonitorProcess) return;
  const processToStop = hardwareMonitorProcess;
  hardwareMonitorProcess = null;
  hardwareMonitorBuffer = '';
  try { processToStop.kill(); } catch { }
}

function syncHardwareMonitor() {
  if (islandCockpitActive || mainCockpitActive) {
    startHardwareMonitor();
  } else {
    stopHardwareMonitor();
  }
}

function startHardwareMonitor() {
  if (hardwareMonitorProcess) return { success: true };
  const executable = getHardwareMonitorPath();
  if (!fs.existsSync(executable)) return { success: false, error: '硬件监控组件不存在' };

  try {
    hardwareMonitorProcess = childProcess.spawn(executable, [], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    hardwareMonitorProcess.stdout.setEncoding('utf8');
    hardwareMonitorProcess.stdout.on('data', (chunk: string) => {
      hardwareMonitorBuffer += chunk;
      const lines = hardwareMonitorBuffer.split(/\r?\n/);
      hardwareMonitorBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          latestCockpitData = data;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cockpit:data', data);
          if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send('island:cockpit', data);
        } catch { }
      }
    });
    hardwareMonitorProcess.on('exit', () => {
      hardwareMonitorProcess = null;
      hardwareMonitorBuffer = '';
    });
    hardwareMonitorProcess.on('error', (error: Error) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cockpit:data', { error: error.message });
      if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send('island:cockpit', { error: error.message });
      stopHardwareMonitor();
    });
    return { success: true };
  } catch (error: any) {
    stopHardwareMonitor();
    return { success: false, error: error?.message || '硬件监控启动失败' };
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

const BACKUP_KEEP_COUNT = 3;

function isHealthyConfigObject(cfg: any): boolean {
  return !!cfg && typeof cfg === 'object' && Array.isArray(cfg.tabs) && Array.isArray(cfg.taskBoards);
}

function backupConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return;
    const current = readConfigObject();
    if (!isHealthyConfigObject(current)) return;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backup = path.join(CONFIG_DIR, `config.backup-${stamp}.json`);
    if (fs.existsSync(backup)) return;
    fs.copyFileSync(CONFIG_FILE, backup);
    const backups = fs.readdirSync(CONFIG_DIR)
      .filter((name: string) => /^config\.backup-\d{14}\.json$/.test(name))
      .sort()
      .reverse();
    for (const name of backups.slice(BACKUP_KEEP_COUNT)) {
      try { fs.unlinkSync(path.join(CONFIG_DIR, name)); } catch {}
    }
  } catch {}
}

function restoreFromBackupIfNeeded() {
  try {
    ensureConfigDir();
    if (!fs.existsSync(CONFIG_FILE)) return;
    const cfg = readConfigObject();
    if (isHealthyConfigObject(cfg)) return;
    const backups = fs.readdirSync(CONFIG_DIR)
      .filter((name: string) => /^config\.backup-\d{14}\.json$/.test(name))
      .sort()
      .reverse();
    for (const name of backups) {
      try {
        const candidate = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
        if (isHealthyConfigObject(candidate)) {
          fs.copyFileSync(path.join(CONFIG_DIR, name), CONFIG_FILE);
          return;
        }
      } catch {}
    }
  } catch {}
}

function writeConfig(data: string) {
  ensureConfigDir();
  backupConfig();
  // write to temp then rename for crash safety
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, CONFIG_FILE);
}

function readConfigObject(): any | null {
  const raw = readConfig();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readModuleEnabled(id: string): boolean {
  try {
    const cfg = readConfigObject();
    const list = cfg?.modules || [];
    const item = (Array.isArray(list) ? list : []).find((entry: any) => entry?.id === id);
    if (item && item.enabled === false) return false;
    // 授权门：未授权不可用的板块，后台服务同步停止
    const license = cfg?.license || {};
    const policy = license.activationPolicy || 'none';
    if (policy === 'none') return true;
    const rules: any[] = Array.isArray(license.moduleAccess) ? license.moduleAccess : [];
    const rule = rules.find((r: any) => r?.id === id);
    return rule ? rule.allowed !== false : false;
  } catch {
    return true;
  }
}

function readFeatureEnabled(key: string): boolean {
  try {
    const cfg = readConfigObject();
    const license = cfg?.license || {};
    const policy = license.activationPolicy || 'none';
    if (policy === 'none') return true;
    const rules: any[] = Array.isArray(license.featureAccess) ? license.featureAccess : [];
    const rule = rules.find((r: any) => r?.id === key);
    return rule ? rule.allowed !== false : false;
  } catch {
    return true;
  }
}

function syncModuleServices() {
  if (!licenseGatePassed) return;

  if (readModuleEnabled('translate') && readFeatureEnabled('translate.bubble')) {
    ensureGlobalShortcut('Alt+E', '翻译选中文字', () => {
      void translateCurrentSelection();
    });
  } else {
    globalShortcut.unregister('Alt+E');
    if (translationBubble && !translationBubble.isDestroyed()) {
      translationBubble.destroy();
    }
    translationBubble = null;
    translationBubblePinned = false;
    if (translationBubbleCloseTimer) clearTimeout(translationBubbleCloseTimer);
    translationBubbleCloseTimer = null;
  }

  if (readModuleEnabled('usage')) {
    startUsageMonitor();
  } else {
    stopUsageMonitor();
  }

  const islandEnabled = readModuleEnabled('island');
  const islandMusicOk = islandEnabled && readFeatureEnabled('island.music');
  const islandTasksOk = islandEnabled && readFeatureEnabled('island.tasks');
  const islandCockpitOk = islandEnabled && readFeatureEnabled('island.cockpit');
  const islandBalanceOk = islandEnabled && readFeatureEnabled('island.balance');
  if (islandEnabled) {
    createIslandWindow();
  } else {
    islandUserHidden = true;
    islandCockpitActive = false;
    syncHardwareMonitor();
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.hide();
    stopMusicBridge();
    destroyTaskListWindow();
    destroyDeepseekBall(false);
    for (const win of reminderWindows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    reminderWindows.clear();
  }

  if (!islandMusicOk) {
    stopMusicBridge();
  }
  if (!islandTasksOk) {
    destroyTaskListWindow();
    for (const win of reminderWindows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    reminderWindows.clear();
  }
  if (!islandCockpitOk) {
    islandCockpitActive = false;
    syncHardwareMonitor();
  }
  if (!islandBalanceOk) {
    destroyDeepseekBall(false);
  }

  if (!readModuleEnabled('cockpit')) {
    mainCockpitActive = false;
    islandCockpitActive = false;
    syncHardwareMonitor();
  }

  if (readModuleEnabled('island') && readFeatureEnabled('island.music')) {
    const musicHotkeys = [
      { accelerator: 'Alt+Z', name: '音乐上一首', action: 'prev' },
      { accelerator: 'Alt+X', name: '音乐播放暂停', action: 'toggle' },
      { accelerator: 'Alt+C', name: '音乐下一首', action: 'next' },
    ];
    for (const item of musicHotkeys) {
      ensureGlobalShortcut(item.accelerator, item.name, () => {
        void runMusicBridgeCommand(['-Control', item.action]);
      });
    }
  } else {
    for (const accelerator of ['Alt+Z', 'Alt+X', 'Alt+C']) {
      try { globalShortcut.unregister(accelerator); } catch {}
    }
  }
}

// Usage record tracker
const USAGE_SYSTEM_PROCESSES = new Set([
  'system', 'idle', 'svchost', 'dwm', 'csrss', 'lsass', 'services', 'wininit',
  'winlogon', 'fontdrvhost', 'smss', 'spoolsv', 'explorer', 'searchindexer',
  'sihost', 'taskhostw', 'startmenuexperiencehost', 'shellexperiencehost',
  'runtimebroker', 'securityhealthservice', 'ctfmon', 'backgroundtaskhost',
]);
const USAGE_WINDOWS_PATHS = [
  path.join(process.env.windir || 'C:\\Windows', 'System32').toLowerCase(),
  path.join(process.env.windir || 'C:\\Windows', 'SysWOW64').toLowerCase(),
  path.join(process.env.windir || 'C:\\Windows', 'SystemApps').toLowerCase(),
];
const USAGE_BROWSER_NAMES = new Set(['msedge', 'chrome']);
const USAGE_SITE_RULES: Array<{ domain: string; name: string; keywords: string[] }> = [
  { domain: 'bilibili.com', name: '哔哩哔哩', keywords: ['bilibili', '哔哩哔哩'] },
  { domain: 'youtube.com', name: 'YouTube', keywords: ['youtube'] },
  { domain: 'github.com', name: 'GitHub', keywords: ['github'] },
  { domain: 'gitee.com', name: 'Gitee', keywords: ['gitee', '码云'] },
  { domain: 'zhihu.com', name: '知乎', keywords: ['知乎'] },
  { domain: 'csdn.net', name: 'CSDN', keywords: ['csdn'] },
  { domain: 'juejin.cn', name: '掘金', keywords: ['掘金'] },
  { domain: 'baidu.com', name: '百度', keywords: ['百度', 'baidu'] },
  { domain: 'google.com', name: 'Google', keywords: ['google'] },
  { domain: 'bing.com', name: 'Bing', keywords: ['bing'] },
  { domain: 'douyin.com', name: '抖音', keywords: ['抖音', 'douyin'] },
  { domain: 'weibo.com', name: '微博', keywords: ['微博', 'weibo'] },
  { domain: 'taobao.com', name: '淘宝', keywords: ['淘宝', 'taobao'] },
  { domain: 'jd.com', name: '京东', keywords: ['京东', 'jd.com'] },
  { domain: '163.com', name: '网易', keywords: ['网易', '163.com'] },
  { domain: 'qq.com', name: '腾讯网', keywords: ['腾讯', 'qq.com'] },
  { domain: 'deepseek.com', name: 'DeepSeek', keywords: ['deepseek'] },
  { domain: 'openai.com', name: 'OpenAI', keywords: ['openai', 'chatgpt'] },
  { domain: 'stackoverflow.com', name: 'Stack Overflow', keywords: ['stack overflow'] },
  { domain: 'xiaohongshu.com', name: '小红书', keywords: ['小红书', 'xiaohongshu'] },
];
const USAGE_OTHER_SITE = '__other__';
const USAGE_AFK_THRESHOLD_MS = 600_000;
const USAGE_INACTIVE_WINDOW_CLASSES = new Set([
  'progman', 'workw', 'shelldll_defview', 'sysshadow', 'wndclass_desktop_generic',
  'dwm', 'multitaskingviewframe', 'xamlmetro',
]);

function getUsageRecordPath(): string {
  return path.join(app.getPath('userData'), 'usage-record.json');
}

function loadUsageRecord(): any {
  try {
    const raw = fs.readFileSync(getUsageRecordPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const days = parsed.days && typeof parsed.days === 'object' ? parsed.days : {};
      for (const day of Object.values(days) as any[]) {
        if (!Array.isArray(day?.apps)) continue;
        day.apps = day.apps.map((entry: any) => {
          const { icon: _legacyIcon, ...rest } = entry || {};
          return rest;
        });
      }
      return {
        enabled: parsed.enabled !== false,
        ignored: Array.isArray(parsed.ignored) ? parsed.ignored.filter((item: unknown) => typeof item === 'string') : [],
        backgroundApps: Array.isArray(parsed.backgroundApps) ? parsed.backgroundApps.filter((item: unknown) => typeof item === 'string') : [],
        days,
      };
    }
  } catch {}
  return { enabled: true, ignored: [], backgroundApps: [], days: {} };
}

function saveUsageRecord() {
  try {
    if (!usageRecord) return;
    const file = getUsageRecordPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(usageRecord, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {}
}

function usageDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ensureUsageDay(dateKey: string) {
  if (!usageRecord.days[dateKey]) {
    usageRecord.days[dateKey] = { date: dateKey, apps: [], sites: [], hourly: Array(24).fill(0) };
  }
  return usageRecord.days[dateKey];
}

function upsertUsageEntry(list: any[], key: string, name: string, kind: string, seconds: number, itemPath?: string) {
  let entry = list.find((item: any) => item.key === key);
  if (!entry) {
    entry = { key, name, kind, seconds: 0, count: 0 };
    if (itemPath) entry.path = itemPath;
    list.push(entry);
  }
  entry.seconds = Math.round((entry.seconds + seconds) * 10) / 10;
  entry.count += 1;
  return entry;
}

function getUsageDomainFromTitle(rawTitle: string): string {
  const title = String(rawTitle || '').toLowerCase();
  if (!title) return USAGE_OTHER_SITE;
  for (const rule of USAGE_SITE_RULES) {
    if (rule.keywords.some((keyword) => title.includes(keyword.toLowerCase()))) {
      return rule.domain;
    }
  }
  return USAGE_OTHER_SITE;
}

function usageDisplayName(key: string): string {
  if (key === USAGE_OTHER_SITE) return '其他网页';
  if (key.endsWith('.exe')) return key.slice(0, -4);
  return key;
}

function isUsageSystemPath(processPath: string): boolean {
  const lower = String(processPath || '').toLowerCase();
  return USAGE_WINDOWS_PATHS.some((prefix) => lower.startsWith(prefix));
}

async function cacheUsageIcon(processPath: string) {
  if (!processPath || usageIconCache.has(processPath)) return;
  const icon = await getIconDataUrl(processPath);
  if (usageIconCache.size >= USAGE_ICON_CACHE_LIMIT) {
    const oldestKey = usageIconCache.keys().next().value;
    if (oldestKey) usageIconCache.delete(oldestKey);
  }
  usageIconCache.set(processPath, icon);
}

function attachUsageIcons(day: any) {
  // 图标只用于当前响应，不能写回常驻历史数据，否则 base64 会按天重复并被每分钟持久化。
  const payload = {
    ...day,
    apps: Array.isArray(day?.apps) ? day.apps.map((entry: any) => {
      const { icon: _persistedIcon, ...rest } = entry || {};
      return rest;
    }) : [],
    sites: Array.isArray(day?.sites) ? day.sites.map((entry: any) => ({ ...entry })) : [],
    hourly: Array.isArray(day?.hourly) ? [...day.hourly] : Array(24).fill(0),
  };
  const apps = payload.apps;
  for (const entry of apps) {
    entry.icon = entry.path ? (usageIconCache.get(entry.path) ?? null) : null;
    if (entry.path && !usageIconCache.has(entry.path)) void cacheUsageIcon(entry.path);
  }
  return payload;
}

function getUsageDayPayload(dateKey: string) {
  const existing = usageRecord?.days?.[dateKey];
  const day = existing || { date: dateKey, apps: [], sites: [], hourly: Array(24).fill(0) };
  if (!Array.isArray(day.hourly) || day.hourly.length !== 24) day.hourly = Array(24).fill(0);
  return attachUsageIcons(day);
}

function getUsageDataPayload(dateKey?: string) {
  const normalized = String(dateKey || usageDateKey()).trim();
  const day = getUsageDayPayload(normalized);
  const current = usageRecord?.enabled !== false && normalized === usageDateKey() && usageCurrent
    ? {
        exe: usageCurrent.exe,
        name: usageCurrent.name,
        title: usageCurrent.title,
        seconds: Math.max(0, (Date.now() - usageCurrent.startedAt) / 1000),
      }
    : null;
  return {
    enabled: usageRecord?.enabled !== false,
    ignored: usageRecord?.ignored || [],
    backgroundApps: usageRecord?.backgroundApps || [],
    day,
    current,
  };
}

function handleUsageSnapshot(snapshot: any) {
  if (!usageRecord || usageRecord.enabled === false) return;
  const now = Date.now();
  let seconds = usageRecordLastTick ? (now - usageRecordLastTick) / 1000 : 0;
  usageRecordLastTick = now;
  if (seconds <= 0 || seconds > 10) return;

  const exe = String(snapshot?.exe || '').trim().toLowerCase();
  const processPath = String(snapshot?.path || '');
  const title = String(snapshot?.title || '');
  const windowClass = String(snapshot?.class || '').toLowerCase();
  const idleMs = Number(snapshot?.idleMs) || 0;

  const dateKey = usageDateKey();
  const day = ensureUsageDay(dateKey);
  if (!Array.isArray(day.hourly) || day.hourly.length !== 24) day.hourly = Array(24).fill(0);
  const hour = new Date(now).getHours();

  const background = Array.isArray(snapshot?.background) ? snapshot.background : [];
  for (const item of background) {
    const bgName = String(item?.name || '').trim().toLowerCase();
    const bgPath = String(item?.path || '');
    if (!bgName || bgName === exe) continue;
    if ((usageRecord.ignored || []).includes(bgName)) continue;
    day.hourly[hour] += seconds;
    upsertUsageEntry(day.apps, bgName, usageDisplayName(bgName), 'app', seconds, bgPath);
    if (bgPath) void cacheUsageIcon(bgPath);
  }

  const previousCurrent = usageCurrent;
  usageCurrent = null;
  if (!exe || USAGE_SYSTEM_PROCESSES.has(exe) || isUsageSystemPath(processPath)) return;
  if (USAGE_INACTIVE_WINDOW_CLASSES.has(windowClass)) return;
  if (idleMs > USAGE_AFK_THRESHOLD_MS) return;

  const nextCurrent = previousCurrent?.exe === exe
    ? previousCurrent
    : { exe, name: usageDisplayName(exe), title, startedAt: now };
  usageCurrent = nextCurrent;

  day.hourly[hour] += seconds;

  if ((usageRecord.ignored || []).includes(exe)) return;
  upsertUsageEntry(day.apps, exe, usageDisplayName(exe), 'app', seconds, processPath);
  if (processPath) void cacheUsageIcon(processPath);

  if (USAGE_BROWSER_NAMES.has(exe)) {
    const domain = getUsageDomainFromTitle(title);
    if (!(usageRecord.ignored || []).includes(domain)) {
      upsertUsageEntry(day.sites, domain, usageDisplayName(domain), 'site', seconds);
    }
  }
}

function startUsageMonitor() {
  if (!licenseGatePassed || usageMonitorProcess) return;
  const script = app.isPackaged
    ? path.join((process as any).resourcesPath || '', 'usage-monitor', 'usage-monitor.ps1')
    : path.join(__dirname, '../resources/usage-monitor/usage-monitor.ps1');
  if (!fs.existsSync(script)) return;
  usageMonitorBuffer = '';
  const backgroundNames = (usageRecord?.backgroundApps || [])
    .map((name: string) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
  const spawnArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
  if (backgroundNames.length > 0) {
    spawnArgs.push('-BackgroundApps', backgroundNames.join(','));
  }
  usageMonitorProcess = childProcess.spawn('powershell.exe', spawnArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  usageMonitorProcess.stdout?.on('data', (chunk: Buffer) => {
    usageMonitorBuffer += chunk.toString('utf8');
    let newlineIndex = usageMonitorBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = usageMonitorBuffer.slice(0, newlineIndex).trim();
      usageMonitorBuffer = usageMonitorBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          handleUsageSnapshot(JSON.parse(line));
        } catch {}
      }
      newlineIndex = usageMonitorBuffer.indexOf('\n');
    }
  });
  usageMonitorProcess.once('error', () => { usageMonitorProcess = null; });
  usageMonitorProcess.once('exit', () => { usageMonitorProcess = null; });
}

function stopUsageMonitor() {
  if (usageMonitorProcess) {
    try { usageMonitorProcess.kill(); } catch {}
    usageMonitorProcess = null;
  }
  usageRecordLastTick = 0;
  saveUsageRecord();
}

function restartUsageMonitor() {
  const wasRunning = !!usageMonitorProcess;
  stopUsageMonitor();
  if (wasRunning && licenseGatePassed) startUsageMonitor();
}

// Codex provider presets
const CODEX_BACKUP_DIRNAME = 'backup-shortcut';
const CODEX_DEFAULT_MODEL = {
  prefer_websockets: false,
  support_verbosity: true,
  default_verbosity: 'low',
  apply_patch_tool_type: 'freeform',
  web_search_tool_type: 'text',
  input_modalities: ['text'],
  supports_image_detail_original: false,
  truncation_policy: { mode: 'tokens', limit: 10000 },
  supports_parallel_tool_calls: true,
  use_responses_lite: false,
};

function getCodexHomeDir(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function getCodexPresetFile(): string {
  return path.join(app.getPath('userData'), 'shortcut', 'codex-presets.json');
}

function getCodexConfigPath(): string {
  return path.join(getCodexHomeDir(), 'config.toml');
}

function getCodexAuthPath(): string {
  return path.join(getCodexHomeDir(), 'auth.json');
}

function getCodexModelsPath(): string {
  return path.join(getCodexHomeDir(), 'models.json');
}

function getCodexBackupDir(): string {
  return path.join(getCodexHomeDir(), CODEX_BACKUP_DIRNAME);
}

function loadCodexPresets(): any[] {
  try {
    const raw = fs.readFileSync(getCodexPresetFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.presets) ? parsed.presets : [];
  } catch {
    return [];
  }
}

function parseCurrentCodexProvider(): any | null {
  try {
    const configPath = getCodexConfigPath();
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf8');
    const providerMatch = raw.match(/^model_provider\s*=\s*"([^"]+)"/m);
    const modelMatch = raw.match(/^model\s*=\s*"([^"]+)"/m);
    if (!providerMatch) return null;
    const providerId = providerMatch[1];
    let inSection = false;
    const section: any = { providerId, model: modelMatch?.[1] || '' };
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        inSection = sectionMatch[1] === `model_providers.${providerId}`;
        continue;
      }
      if (!inSection) continue;
      const kv = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*"([^"]*)"$/);
      if (!kv) continue;
      const key = kv[1];
      const value = kv[2];
      if (key === 'name') section.name = value;
      else if (key === 'base_url') section.baseUrl = value;
      else if (key === 'wire_api') section.wireApi = value;
      else if (key === 'experimental_bearer_token') section.apiKey = value;
    }
    return section.baseUrl ? section : null;
  } catch {
    return null;
  }
}

function ensureDefaultCodexPreset() {
  try {
    const presets = loadCodexPresets();
    if (presets.length > 0) return;
    const current = parseCurrentCodexProvider();
    if (!current || !current.baseUrl || !current.model) return;
    const now = new Date().toISOString();
    const preset = {
      id: `default-${current.providerId}`,
      name: current.name || current.providerId,
      providerId: current.providerId,
      baseUrl: current.baseUrl,
      wireApi: current.wireApi || 'chat',
      model: current.model,
      apiKey: current.apiKey || undefined,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };
    presets.push(preset);
    saveCodexPresets(presets);
    if (!getCodexSharedProviderId()) setCodexSharedProviderId(current.providerId);
    const backupConfig = path.join(getCodexBackupDir(), 'config.toml');
    const backupModels = path.join(getCodexBackupDir(), 'models.json');
    const configText = fs.existsSync(backupConfig) ? fs.readFileSync(backupConfig, 'utf8') : readLiveCodexConfigText();
    const modelsText = fs.existsSync(backupModels) ? fs.readFileSync(backupModels, 'utf8') : readLiveCodexModelsText();
    writeCodexPresetSnapshot(preset, configText, modelsText);
    refreshCodexPresetIcon(preset);
  } catch {}
}

function saveCodexPresets(presets: any[]) {
  try {
    const file = getCodexPresetFile();
    const store = loadCodexPresetStore();
    store.presets = presets;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {}
}

function loadCodexPresetStore(): any {
  try {
    const raw = fs.readFileSync(getCodexPresetFile(), 'utf8');
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function getCodexSharedProviderId(): string {
  return String(loadCodexPresetStore().sharedProviderId || '');
}

function setCodexSharedProviderId(id: string) {
  try {
    const file = getCodexPresetFile();
    const store = loadCodexPresetStore();
    store.sharedProviderId = id;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {}
}

function getCodexLastAppliedPreset(): any {
  const store = loadCodexPresetStore();
  return {
    name: String(store.lastAppliedPresetName || ''),
    providerId: String(store.lastAppliedPresetProviderId || ''),
  };
}

function setCodexLastAppliedPreset(name: string, providerId: string) {
  try {
    const file = getCodexPresetFile();
    const store = loadCodexPresetStore();
    store.lastAppliedPresetName = String(name || '');
    store.lastAppliedPresetProviderId = String(providerId || '');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {}
}

function normalizeSnapshotConfig(configText: string, sharedProviderId: string): string {
  const sourceProvider = (configText.match(/^model_provider\s*=\s*"([^"]+)"/m) || [])[1] || '';
  if (!sourceProvider) return configText;
  const lines = configText.split(/\r?\n/);
  const output: string[] = [];
  let currentSection = '';
  let skipSection = '';
  let providerKeyReplaced = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (currentSection === `model_providers.${sourceProvider}`) {
        output.push(`[model_providers.${sharedProviderId}]`);
        skipSection = '';
        continue;
      }
      if (sourceProvider !== sharedProviderId && currentSection === `model_providers.${sharedProviderId}`) {
        skipSection = currentSection;
        continue;
      }
      skipSection = '';
      output.push(line);
      continue;
    }
    if (skipSection) continue;
    if (!currentSection) {
      if (/^model_provider\s*=/.test(trimmed)) {
        if (!providerKeyReplaced) {
          output.push(`model_provider = "${sharedProviderId}"`);
          providerKeyReplaced = true;
        }
        continue;
      }
      output.push(line);
      continue;
    }
    output.push(line);
  }
  if (!providerKeyReplaced) output.unshift(`model_provider = "${sharedProviderId}"`);
  return output.join('\n') + '\n';
}

function normalizeCodexPreset(data: any, existing?: any): any {
  const now = new Date().toISOString();
  const preset = {
    id: existing?.id || data.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(data.name || '').trim(),
    providerId: String(data.providerId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    baseUrl: String(data.baseUrl || '').trim(),
    wireApi: ['chat', 'responses', 'anthropic'].includes(data.wireApi) ? data.wireApi : 'chat',
    model: String(data.model || '').trim(),
    apiKey: data.apiKey ? String(data.apiKey).trim() : undefined,
    icon: existing?.icon || data.icon || undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return preset;
}

function readCodexCurrentState(): any {
  ensureDefaultCodexPreset();
  ensureCodexPresetSnapshots();
  const current = parseCurrentCodexProvider();
  const lastApplied = getCodexLastAppliedPreset();
  const currentPresetName = lastApplied.name && lastApplied.providerId === (current?.providerId || '')
    ? lastApplied.name
    : (current?.name || current?.providerId || '');
  return {
    presets: loadCodexPresets(),
    currentPresetName,
    currentProvider: current?.providerId || '',
    currentModel: current?.model || '',
    currentBaseUrl: current?.baseUrl || '',
    currentWireApi: current?.wireApi || 'chat',
    backupExists: fs.existsSync(path.join(getCodexBackupDir(), 'config.toml')),
  };
}

function backupCodexConfig() {
  const backupDir = getCodexBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });
  for (const name of ['config.toml', 'models.json']) {
    const source = path.join(getCodexHomeDir(), name);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(backupDir, name));
    }
  }
  fs.writeFileSync(path.join(backupDir, 'manifest.txt'), `backup_at=${new Date().toISOString()}\n`, 'utf8');
}

function restoreCodexConfig(): { success: boolean; error?: string } {
  try {
    const backupDir = getCodexBackupDir();
    if (!fs.existsSync(path.join(backupDir, 'config.toml'))) {
      return { success: false, error: '没有可还原的备份' };
    }
    fs.copyFileSync(path.join(backupDir, 'config.toml'), getCodexConfigPath());
    const modelsBackup = path.join(backupDir, 'models.json');
    if (fs.existsSync(modelsBackup)) {
      fs.copyFileSync(modelsBackup, getCodexModelsPath());
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || '还原失败' };
  }
}

function buildCodexProviderSection(preset: any): string[] {
  const lines = [
    `[model_providers.${preset.providerId}]`,
    `name = "${preset.displayProviderId || preset.providerId}"`,
    `base_url = "${preset.baseUrl}"`,
    `wire_api = "${preset.wireApi || 'chat'}"`,
  ];
  if (preset.apiKey) {
    lines.push(`experimental_bearer_token = "${preset.apiKey}"`);
  } else {
    lines.push(`env_key = "OPENAI_API_KEY"`);
  }
  return lines;
}

function applyPresetToToml(configText: string, preset: any, keepProviderKey = false): string {
  const catalogValue = getCodexModelsPath().replace(/\\/g, '/');
  const lines = configText.split(/\r?\n/);
  const output: string[] = [];
  let currentSection = '';
  let skipProviderSection = false;
  let providerSectionReplaced = false;
  let providerKeyReplaced = false;
  let modelKeyReplaced = false;
  let reviewKeyReplaced = false;
  let catalogKeyReplaced = false;
  let providerInsertIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      skipProviderSection = false;
      if (providerInsertIndex < 0) providerInsertIndex = output.length;
      if (currentSection === `model_providers.${preset.providerId}`) {
        output.push(...buildCodexProviderSection(preset));
        providerSectionReplaced = true;
        skipProviderSection = true;
        continue;
      }
      output.push(line);
      continue;
    }
    if (skipProviderSection) continue;
    if (!currentSection) {
      if (/^model_provider\s*=/.test(trimmed)) {
        if (keepProviderKey) {
          output.push(line);
          continue;
        }
        if (!providerKeyReplaced) {
          output.push(`model_provider = "${preset.providerId}"`);
          providerKeyReplaced = true;
        }
        continue;
      }
      if (/^model\s*=/.test(trimmed)) {
        if (!modelKeyReplaced) {
          output.push(`model = "${preset.model}"`);
          modelKeyReplaced = true;
        }
        continue;
      }
      if (/^review_model\s*=/.test(trimmed)) {
        if (!reviewKeyReplaced) {
          output.push(`review_model = "${preset.model}"`);
          reviewKeyReplaced = true;
        }
        continue;
      }
      if (/^model_catalog_json\s*=/.test(trimmed)) {
        if (!catalogKeyReplaced) {
          output.push(`model_catalog_json = "${catalogValue}"`);
          catalogKeyReplaced = true;
        }
        continue;
      }
      output.push(line);
      continue;
    }
    output.push(line);
  }

  const missingTop = [
    !providerKeyReplaced ? `model_provider = "${preset.providerId}"` : '',
    !modelKeyReplaced ? `model = "${preset.model}"` : '',
    !catalogKeyReplaced ? `model_catalog_json = "${catalogValue}"` : '',
  ].filter(Boolean);
  if (missingTop.length) output.unshift(...missingTop);
  if (!providerSectionReplaced) {
    const sectionLines = ['', ...buildCodexProviderSection(preset)];
    if (providerInsertIndex >= 0) output.splice(providerInsertIndex, 0, ...sectionLines);
    else output.push(...sectionLines);
  }
  return output.join('\n') + '\n';
}

function ensureCodexModelInCatalog(modelSlug: string) {
  const modelsPath = getCodexModelsPath();
  let catalog: any = { models: [] };
  try {
    if (fs.existsSync(modelsPath)) {
      const parsed = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
      if (parsed && Array.isArray(parsed.models)) catalog = parsed;
    }
  } catch {
    catalog = { models: [] };
  }
  if (catalog.models.some((item: any) => item?.slug === modelSlug)) return;
  const template = catalog.models.length
    ? JSON.parse(JSON.stringify(catalog.models[0]))
    : { ...CODEX_DEFAULT_MODEL };
  template.slug = modelSlug;
  if (typeof template.name === 'string') template.name = modelSlug;
  catalog.models.push(template);
  fs.mkdirSync(path.dirname(modelsPath), { recursive: true });
  const tmp = modelsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2), 'utf8');
  fs.renameSync(tmp, modelsPath);
}

function applyCodexPreset(preset: any): { success: boolean; error?: string } {
  try {
    const snapshot = readCodexPresetFiles(preset);
    if (!snapshot.config) return { success: false, error: '方案配置文件缺失' };
    backupCodexConfig();
    const configPath = getCodexConfigPath();
    const authPath = getCodexAuthPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, snapshot.config, 'utf8');
    fs.renameSync(tmp, configPath);
    if (snapshot.auth) {
      fs.mkdirSync(path.dirname(authPath), { recursive: true });
      const authTmp = authPath + '.tmp';
      fs.writeFileSync(authTmp, snapshot.auth, 'utf8');
      fs.renameSync(authTmp, authPath);
    }
    if (snapshot.models) {
      const modelsPath = getCodexModelsPath();
      const modelsTmp = modelsPath + '.tmp';
      fs.writeFileSync(modelsTmp, snapshot.models, 'utf8');
      fs.renameSync(modelsTmp, modelsPath);
    } else {
      ensureCodexModelInCatalog(preset.model);
    }
    const appliedProvider = (snapshot.config.match(/^model_provider\s*=\s*"([^"]+)"/m) || [])[1] || preset.providerId;
    setCodexLastAppliedPreset(preset.name, appliedProvider);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || '切换失败' };
  }
}

function refreshCodexPresetIcon(preset: any) {
  if (!preset?.baseUrl) return;
  void getWebsiteIcon(preset.baseUrl).then((icon: string | null) => {
    if (!icon) return;
    const presets = loadCodexPresets();
    const target = presets.find((item: any) => item.id === preset.id);
    if (target) {
      target.icon = icon;
      saveCodexPresets(presets);
    }
  }).catch(() => undefined);
}

function getCodexPresetDir(presetId: string): string {
  return path.join(getCodexHomeDir(), 'shortcut-presets', presetId);
}

function getCodexPresetConfigPath(presetId: string): string {
  return path.join(getCodexPresetDir(presetId), 'config.toml');
}

function getCodexPresetModelsPath(presetId: string): string {
  return path.join(getCodexPresetDir(presetId), 'models.json');
}

function getCodexPresetAuthPath(presetId: string): string {
  return path.join(getCodexPresetDir(presetId), 'auth.json');
}

function readLiveCodexConfigText(): string {
  const file = getCodexConfigPath();
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function readLiveCodexModelsText(): string | null {
  const file = getCodexModelsPath();
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function readLiveCodexAuthText(): string | null {
  const file = getCodexAuthPath();
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function writeCodexPresetSnapshot(preset: any, configText: string, modelsText?: string | null) {
  const dir = getCodexPresetDir(preset.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.toml'), configText, 'utf8');
  if (modelsText) fs.writeFileSync(path.join(dir, 'models.json'), modelsText, 'utf8');
}

function writeCodexPresetFiles(
  preset: any,
  configText: string,
  modelsText?: string | null,
  authText?: string | null,
) {
  const dir = getCodexPresetDir(preset.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.toml'), configText, 'utf8');
  if (modelsText) fs.writeFileSync(path.join(dir, 'models.json'), modelsText, 'utf8');
  if (authText) fs.writeFileSync(path.join(dir, 'auth.json'), authText, 'utf8');
}

function readCodexPresetSnapshot(preset: any): { config: string; models: string | null } {
  const config = fs.existsSync(getCodexPresetConfigPath(preset.id))
    ? fs.readFileSync(getCodexPresetConfigPath(preset.id), 'utf8')
    : '';
  const modelsPath = getCodexPresetModelsPath(preset.id);
  const models = fs.existsSync(modelsPath) ? fs.readFileSync(modelsPath, 'utf8') : null;
  return { config, models };
}

function readCodexPresetFiles(preset: any): { config: string; models: string | null; auth: string | null } {
  const snapshot = readCodexPresetSnapshot(preset);
  const authPath = getCodexPresetAuthPath(preset.id);
  const auth = fs.existsSync(authPath) ? fs.readFileSync(authPath, 'utf8') : null;
  return { ...snapshot, auth };
}

function buildCodexPresetSnapshot(
  preset: any,
  templateConfig: string,
  templateModels: string | null,
): { config: string; models: string | null } {
  const currentProvider = (templateConfig.match(/^model_provider\s*=\s*"([^"]+)"/m) || [])[1] || preset.providerId;
  const config = applyPresetToToml(
    templateConfig,
    { ...preset, providerId: currentProvider, displayProviderId: preset.providerId },
    !!currentProvider,
  );
  let models = templateModels;
  try {
    if (models) {
      const catalog = JSON.parse(models);
      if (!catalog.models.some((item: any) => item?.slug === preset.model)) {
        const template = catalog.models.length
          ? JSON.parse(JSON.stringify(catalog.models[0]))
          : { ...CODEX_DEFAULT_MODEL };
        template.slug = preset.model;
        if (typeof template.name === 'string') template.name = preset.model;
        catalog.models.push(template);
        models = JSON.stringify(catalog, null, 2);
      }
    } else {
      models = JSON.stringify({
        models: [{ ...CODEX_DEFAULT_MODEL, slug: preset.model, name: preset.model }],
      }, null, 2);
    }
  } catch {
    models = JSON.stringify({
      models: [{ ...CODEX_DEFAULT_MODEL, slug: preset.model, name: preset.model }],
    }, null, 2);
  }
  return { config, models };
}

function getDefaultCodexPreset(presets: any[]): any {
  return presets.find((item: any) => item.isDefault || String(item.id || '').startsWith('default-')) || null;
}

function ensureCodexPresetSnapshots() {
  const presets = loadCodexPresets();
  for (const preset of presets) {
    const isDefault = preset.isDefault || String(preset.id || '').startsWith('default-');
    if (fs.existsSync(getCodexPresetConfigPath(preset.id))) {
      if (!fs.existsSync(getCodexPresetAuthPath(preset.id))) {
        const authText = readLiveCodexAuthText();
        if (authText) fs.writeFileSync(getCodexPresetAuthPath(preset.id), authText, 'utf8');
      }
      if (!fs.existsSync(getCodexPresetModelsPath(preset.id))) {
        const modelsText = readLiveCodexModelsText();
        if (modelsText) fs.writeFileSync(getCodexPresetModelsPath(preset.id), modelsText, 'utf8');
      }
      const shared = getCodexSharedProviderId();
      if (shared && !isDefault) {
        const configPath = getCodexPresetConfigPath(preset.id);
        const raw = fs.readFileSync(configPath, 'utf8');
        const currentProvider = (raw.match(/^model_provider\s*=\s*"([^"]+)"/m) || [])[1] || '';
        if (currentProvider && currentProvider !== shared) {
          fs.writeFileSync(configPath, normalizeSnapshotConfig(raw, shared), 'utf8');
        }
      }
      continue;
    }
    if (isDefault) {
      const backupConfig = path.join(getCodexBackupDir(), 'config.toml');
      const backupModels = path.join(getCodexBackupDir(), 'models.json');
      const backupAuth = path.join(getCodexBackupDir(), 'auth.json');
      const configText = fs.existsSync(backupConfig) ? fs.readFileSync(backupConfig, 'utf8') : readLiveCodexConfigText();
      const modelsText = fs.existsSync(backupModels) ? fs.readFileSync(backupModels, 'utf8') : readLiveCodexModelsText();
      const authText = fs.existsSync(backupAuth) ? fs.readFileSync(backupAuth, 'utf8') : readLiveCodexAuthText();
      writeCodexPresetFiles(preset, configText, modelsText, authText);
      continue;
    }
    const defaultPreset = getDefaultCodexPreset(presets);
    let templateConfig = defaultPreset && fs.existsSync(getCodexPresetConfigPath(defaultPreset.id))
      ? fs.readFileSync(getCodexPresetConfigPath(defaultPreset.id), 'utf8')
      : readLiveCodexConfigText();
    let templateModels = defaultPreset && fs.existsSync(getCodexPresetModelsPath(defaultPreset.id))
      ? fs.readFileSync(getCodexPresetModelsPath(defaultPreset.id), 'utf8')
      : readLiveCodexModelsText();
    const snapshot = buildCodexPresetSnapshot(preset, templateConfig, templateModels);
    writeCodexPresetFiles(preset, snapshot.config, snapshot.models, readLiveCodexAuthText());
  }
}

function writeIslandConfig(island: any) {
  const cfg = readConfigObject();
  if (!cfg) return false;
  writeConfig(JSON.stringify({ ...cfg, island: { ...(cfg.island || {}), ...island } }, null, 2));
  return true;
}

function findTask(boardId: string, taskId: string): any | null {
  const cfg = readConfigObject();
  const board = (cfg?.taskBoards || []).find((item: any) => item.id === boardId);
  return board?.notes?.find((note: any) => note.id === taskId) || null;
}

function readTaskList(): any[] {
  const cfg = readConfigObject();
  return Array.isArray(cfg?.scTaskList) ? cfg.scTaskList : [];
}

function saveTaskList(list: any[]) {
  const cfg = readConfigObject();
  if (!cfg) return;
  writeConfig(JSON.stringify({ ...cfg, scTaskList: list }, null, 2));
}

function resolveTaskList(): any[] {
  pruneTaskList();
  return readTaskList()
    .map((entry) => {
      const task = findTask(entry.boardId, entry.taskId);
      if (!task) return null;
      return {
        boardId: entry.boardId,
        taskId: entry.taskId,
        title: task.text || '无标题任务',
        done: !!task.done,
        addedAt: entry.addedAt,
      };
    })
    .filter((item: any) => !!item);
}

function pruneTaskList() {
  const list = readTaskList();
  const pruned = list.filter((item: any) => !!findTask(item.boardId, item.taskId));
  if (pruned.length !== list.length) {
    saveTaskList(pruned);
  }
  return pruned;
}

function notifyConfigChanged() {
  syncModuleServices();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('config:changed');
    } catch {}
  }
}

function sendTaskListData() {
  const items = resolveTaskList();
  if (items.length === 0) {
    destroyTaskListWindow();
    return;
  }
  if (!taskListWindow || taskListWindow.isDestroyed()) return;
  try {
    taskListWindow.webContents.send('tasklist:data', items);
  } catch {}
}

function taskListBounds() {
  const islandBounds = islandWindow && !islandWindow.isDestroyed() ? islandWindow.getBounds() : null;
  return {
    x: islandBounds ? islandBounds.x + islandBounds.width + 8 : 120,
    y: islandBounds ? islandBounds.y : 120,
    width: 340,
    height: 430,
  };
}

function createTaskListWindow() {
  if (taskListHidden) return;
  if (!readModuleEnabled('island')) return;
  const cfg = readConfigObject();
  if (cfg?.island?.tasksEnabled === false) return;
  pruneTaskList();
  if (taskListWindow && !taskListWindow.isDestroyed()) {
    sendTaskListData();
    return;
  }
  const bounds = taskListBounds();
  taskListWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  taskListWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.env.VITE_DEV_SERVER_URL) {
    taskListWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '/tasklist.html');
  } else {
    taskListWindow.loadFile(path.join(__dirname, '../dist/tasklist.html'));
  }
  taskListWindow.once('ready-to-show', () => {
    taskListWindow.showInactive();
    sendTaskListData();
  });
  taskListWindow.on('closed', () => { taskListWindow = null; });
}

function destroyTaskListWindow() {
  if (taskListWindow && !taskListWindow.isDestroyed()) {
    taskListWindow.destroy();
  }
  taskListWindow = null;
}

function deepseekBallBounds() {
  const islandBounds = islandWindow && !islandWindow.isDestroyed() ? islandWindow.getBounds() : null;
  return {
    x: islandBounds ? islandBounds.x + islandBounds.width + 8 : 120,
    y: islandBounds ? islandBounds.y + 8 : 120,
    width: 46,
    height: 46,
  };
}

function positionDeepseekBall() {
  if (!deepseekBallWindow || deepseekBallWindow.isDestroyed()) return;
  const bounds = deepseekBallBounds();
  deepseekBallWindow.setBounds(bounds);
}

function createDeepseekBall() {
  if (deepseekBallWindow && !deepseekBallWindow.isDestroyed()) {
    positionDeepseekBall();
    return;
  }
  const islandBounds = islandWindow && !islandWindow.isDestroyed() ? islandWindow.getBounds() : null;
  const startBounds = {
    x: islandBounds ? islandBounds.x + Math.round((islandBounds.width - 46) / 2) : 120,
    y: islandBounds ? islandBounds.y + 8 : 120,
    width: 46,
    height: 46,
  };
  deepseekBallWindow = new BrowserWindow({
    ...startBounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  deepseekBallWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.env.VITE_DEV_SERVER_URL) {
    deepseekBallWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '/deepseekball.html');
  } else {
    deepseekBallWindow.loadFile(path.join(__dirname, '../dist/deepseekball.html'));
  }
  deepseekBallWindow.once('ready-to-show', () => {
    if (deepseekBallWindow && !deepseekBallWindow.isDestroyed()) {
      deepseekBallWindow.setBounds(startBounds);
      deepseekBallWindow.showInactive();
      setTimeout(() => positionDeepseekBall(), 40);
    }
  });
  deepseekBallWindow.on('closed', () => { deepseekBallWindow = null; });
}

function destroyDeepseekBall(animate = false) {
  if (!deepseekBallWindow || deepseekBallWindow.isDestroyed()) {
    deepseekBallWindow = null;
    return;
  }
  const win = deepseekBallWindow;
  if (animate) {
    try { win.webContents.send('deepseek:merge'); } catch {}
    try { win.webContents.send('balance:merge'); } catch {}
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.destroy();
    }, 350);
  } else {
    win.destroy();
  }
}

function createReminderWindow(boardId: string, taskId: string) {
  if (!readModuleEnabled('island')) return;
  const key = `${boardId}:${taskId}`;
  if (reminderWindows.has(key)) return;
  const task = findTask(boardId, taskId);
  if (!task) return;
  const bounds = taskListBounds();
  const islandBounds = islandWindow && !islandWindow.isDestroyed() ? islandWindow.getBounds() : null;
  const win = new BrowserWindow({
    x: islandBounds ? islandBounds.x + Math.round((islandBounds.width - 340) / 2) : bounds.x,
    y: islandBounds ? islandBounds.y + 60 + reminderWindows.size * 132 : bounds.y + 36,
    width: 340,
    height: 128,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL + '/reminder.html');
  } else {
    win.loadFile(path.join(__dirname, '../dist/reminder.html'));
  }
  win.once('ready-to-show', () => {
    reminderDataByWindow.set(win.webContents.id, { boardId, taskId, title: task.text || '任务提醒' });
    try {
      win.webContents.send('reminder:data', { boardId, taskId, title: task.text || '任务提醒' });
    } catch {}
    win.showInactive();
  });
  win.on('closed', () => {
    reminderDataByWindow.delete(win.webContents.id);
    reminderWindows.delete(key);
  });
  reminderWindows.set(key, win);
}

function markTaskReminded(boardId: string, taskId: string) {
  const cfg = readConfigObject();
  if (!cfg) return;
  const boards = (cfg.taskBoards || []).map((board: any) => {
    if (board.id !== boardId) return board;
    return {
      ...board,
      notes: (board.notes || []).map((note: any) => note.id === taskId
        ? { ...note, remindedAt: new Date().toISOString(), done: true }
        : note),
    };
  });
  writeConfig(JSON.stringify({ ...cfg, taskBoards: boards }, null, 2));
}

function toggleTaskDone(boardId: string, taskId: string) {
  const cfg = readConfigObject();
  if (!cfg) return;
  const boards = (cfg.taskBoards || []).map((board: any) => {
    if (board.id !== boardId) return board;
    return {
      ...board,
      notes: (board.notes || []).map((note: any) => note.id === taskId
        ? { ...note, done: !note.done, updatedAt: new Date().toISOString() }
        : note),
    };
  });
  writeConfig(JSON.stringify({ ...cfg, taskBoards: boards }, null, 2));
}

function scanDueReminders() {
  const cfg = readConfigObject();
  if (!cfg || !licenseGatePassed || cfg.island?.tasksEnabled === false) return;
  const now = Date.now();
  for (const board of cfg.taskBoards || []) {
    for (const note of board.notes || []) {
      if (!note.reminderAt || note.remindedAt) continue;
      const due = new Date(note.reminderAt).getTime();
      if (!Number.isFinite(due) || due > now) continue;
      createReminderWindow(board.id, note.id);
    }
  }
}

function pointInIsland(screenX: number, screenY: number): boolean {
  if (!islandWindow || islandWindow.isDestroyed()) return false;
  const bounds = islandWindow.getBounds();
  return screenX >= bounds.x && screenX <= bounds.x + bounds.width
    && screenY >= bounds.y && screenY <= bounds.y + bounds.height;
}


function expandWindowsEnv(input: string): string {
  return input.replace(/%([^%]+)%/g, (_match, name) => process.env[name] || '');
}

function normalizeExternalUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function encodePowerShellCommand(command: string) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function launchViaWindowsShell(targetPath: string, options: { runAsAdmin?: boolean; argument?: string; hide?: boolean } = {}) {
  return new Promise<void>((resolve, reject) => {
    const workingDirectory = path.dirname(targetPath);
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "$params = @{ FilePath = $env:SHORTCUT_TARGET; WorkingDirectory = $env:SHORTCUT_CWD; PassThru = $true }",
      "if ($env:SHORTCUT_RUN_AS_ADMIN -eq '1') { $params.Verb = 'RunAs' }",
      "if ($env:SHORTCUT_ARGUMENT) { $params.ArgumentList = @($env:SHORTCUT_ARGUMENT) }",
      "if ($env:SHORTCUT_HIDE -eq '1') { $params.WindowStyle = 'Hidden' }",
      "$process = Start-Process @params",
      "if (-not $process) { throw 'Windows did not create the target process.' }",
    ].join('; ');
    const launcher = childProcess.spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePowerShellCommand(command),
    ], {
      windowsHide: true,
      env: {
        ...process.env,
        SHORTCUT_TARGET: targetPath,
        SHORTCUT_CWD: workingDirectory,
        SHORTCUT_RUN_AS_ADMIN: options.runAsAdmin ? '1' : '0',
        SHORTCUT_ARGUMENT: options.argument || '',
        SHORTCUT_HIDE: options.hide ? '1' : '0',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    launcher.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    launcher.once('error', reject);
    launcher.once('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Windows launcher exited with code ${code ?? 'unknown'}`));
    });
  });
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
const TRANSLATE_PROXY_URL = 'https://shortcut.326415.xyz/api/translate';
const TRANSLATION_LANGUAGES = new Set(['auto', 'zh', 'en', 'jp', 'kor', 'fra', 'de', 'ru', 'spa', 'ara', 'th', 'it', 'pt', 'vie']);

async function translateText(text: string, from = 'auto', to = 'zh') {
  const normalizedText = String(text || '').trim().slice(0, 5000);
  if (!normalizedText) return { success: false, error: '请输入需要翻译的文字' };
  if (!TRANSLATION_LANGUAGES.has(from) || !TRANSLATION_LANGUAGES.has(to) || to === 'auto') return { success: false, error: '不支持的语言类型' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await net.fetch(TRANSLATE_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: normalizedText, from, to }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  } catch (error: any) {
    return { success: false, error: error?.name === 'AbortError' ? '翻译请求超时' : (error?.message || '翻译服务暂不可用') };
  } finally {
    clearTimeout(timeout);
  }
}

function escapeBubbleHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

function scheduleTranslationBubbleClose() {
  if (translationBubbleCloseTimer) clearTimeout(translationBubbleCloseTimer);
  translationBubbleCloseTimer = null;
  if (translationBubblePinned) return;
  translationBubbleCloseTimer = setTimeout(() => {
    if (translationBubble && !translationBubble.isDestroyed()) translationBubble.close();
  }, 5000);
}

function showTranslationBubble(source: string, translated: string, error?: string) {
  translationBubble?.destroy();
  translationBubblePinned = false;
  if (translationBubbleCloseTimer) clearTimeout(translationBubbleCloseTimer);
  const width = 380;
  const height = Math.min(340, Math.max(144, 104 + Math.ceil((source.length + translated.length) / 30) * 22));
  const cursor = electronScreen.getCursorScreenPoint();
  const workArea = electronScreen.getDisplayNearestPoint(cursor).workArea;
  const x = Math.max(workArea.x + 8, Math.min(cursor.x + 16, workArea.x + workArea.width - width - 8));
  const y = Math.max(workArea.y + 8, Math.min(cursor.y + 20, workArea.y + workArea.height - height - 8));
  translationBubble = new BrowserWindow({
    width, height, x, y, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  translationBubble.setAlwaysOnTop(true, 'screen-saver');
  const body = error
    ? `<div class="error">${escapeBubbleHtml(error)}</div>`
    : `<div class="tape"></div><div class="source">${escapeBubbleHtml(source)}</div><div class="divider"></div><div class="result-head"><span>译文</span><div class="actions"><a id="pin" href="shortcut-bubble://pin" target="_blank" title="固定纸条"><svg viewBox="0 0 24 24"><path d="M12 17v5M5 17h14M7 3h10l-2 6 3 4H6l3-4-2-6Z"/></svg></a><a id="copy" href="shortcut-bubble://copy" target="_blank" title="复制译文"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg></a></div></div><div class="result">${escapeBubbleHtml(translated)}</div><div id="bubble-toast">已复制译文</div>`;
  const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{height:100%}body{margin:0;padding:8px;background:transparent;font-family:"Special Elite","Noto Serif SC","Microsoft YaHei UI",serif;color:#2c2416}.bubble{position:relative;display:flex;max-height:100%;flex-direction:column;overflow:hidden;background:#f5f0e8;border:1px solid rgba(80,60,35,.18);border-radius:8px;box-shadow:4px 8px 28px rgba(0,0,0,.48)}.tape{position:absolute;left:50%;top:-3px;width:72px;height:17px;transform:translateX(-50%) rotate(-1deg);background:rgba(201,166,107,.72);border:1px solid rgba(90,65,35,.1)}.source{-webkit-app-region:drag;cursor:move;flex:none;padding:22px 16px 10px;font-size:12px;line-height:1.6;color:#81735f;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.divider{height:1px;flex:none;background:#d8ccba;margin:0 16px}.result-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px 0 16px;color:#746550;font-size:11px;font-weight:700}.actions{display:flex;gap:6px;-webkit-app-region:no-drag}.result-head :is(button,a){width:28px;height:28px;border:1px solid #cbbda8;border-radius:7px;background:#fffaf0;color:#655845;cursor:pointer;font-size:14px}.result-head :is(button,a) svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.result-head :is(button,a):hover{background:#e7dfd2}.result-head :is(button,a).pinned{background:#9b2335;border-color:#9b2335;color:#fff8ed}.result-head :is(button,a).copied{color:#27694a}.bubble-toast{}#bubble-toast{position:absolute;left:50%;bottom:12px;transform:translate(-50%,8px);padding:6px 12px;border-radius:7px;background:#2c2416;color:#fff8ed;font-size:12px;opacity:0;pointer-events:none;transition:.18s}#bubble-toast.show{opacity:1;transform:translate(-50%,0)}.result{min-height:0;overflow-y:auto;padding:5px 16px 16px;font-size:15px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;background-image:repeating-linear-gradient(transparent,transparent 25px,rgba(108,88,61,.09) 25px,rgba(108,88,61,.09) 26px)}.result::-webkit-scrollbar{width:5px}.result::-webkit-scrollbar-thumb{background:#b9aa95;border-radius:3px}.error{padding:20px 16px;font-size:14px;line-height:1.7;color:#9b2335}</style><div class="bubble">${body}</div><script>const pin=document.getElementById("pin"),copy=document.getElementById("copy"),toast=document.getElementById("bubble-toast");pin?.addEventListener("click",()=>pin.classList.toggle("pinned"));copy?.addEventListener("click",()=>{copy.classList.add("copied");toast?.classList.add("show");setTimeout(()=>{copy.classList.remove("copied");toast?.classList.remove("show")},1400)})<\/script>`;
  translationBubble.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    const action = url.startsWith('shortcut-bubble://') ? url.slice('shortcut-bubble://'.length).replace(/\/$/, '') : '';
    if (action === 'copy') {
      clipboard.writeText(translated);
    } else if (action === 'pin') {
      translationBubblePinned = !translationBubblePinned;
    }
    if (action) scheduleTranslationBubbleClose();
    return { action: 'deny' };
  });
  translationBubble.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
  translationBubble.once('ready-to-show', () => { translationBubble?.show(); scheduleTranslationBubbleClose(); });
  translationBubble.on('move', scheduleTranslationBubbleClose);
  translationBubble.on('blur', () => { if (!translationBubblePinned && translationBubble && !translationBubble.isDestroyed()) translationBubble.close(); });
  translationBubble.on('closed', () => {
    if (translationBubbleCloseTimer) clearTimeout(translationBubbleCloseTimer);
    translationBubbleCloseTimer = null;
    translationBubblePinned = false;
    translationBubble = null;
  });
}


async function captureDisplayImage(display: any) {
  const scaleFactor = display.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.bounds.width * scaleFactor)),
    height: Math.max(1, Math.round(display.bounds.height * scaleFactor)),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const source = sources.find((item: any) => String(item.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('未能获取屏幕画面');
  return source.thumbnail;
}

function showScreenshotNotification(message: string) {
  if (ElectronNotification.isSupported()) {
    new ElectronNotification({ title: '截图已复制', body: message, silent: true }).show();
  }
}

async function captureCurrentDisplay() {
  try {
    const display = electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint());
    const image = await captureDisplayImage(display);
    clipboard.writeImage(image);
    showScreenshotNotification('当前屏幕已写入剪贴板');
  } catch (error) {
    console.error('Failed to capture screen', error);
  }
}

async function startRegionCapture() {
  try {
    if (captureOverlay && !captureOverlay.isDestroyed()) captureOverlay.destroy();
    const display = electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint());
    const image = await captureDisplayImage(display);
    const dataUrl = image.toDataURL();
    const html = '<!doctype html><meta charset="utf-8"><style>' +
      '*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;cursor:crosshair;user-select:none}' +
      'body{background:#000}img{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}' +
      '#shade{position:absolute;inset:0;background:rgba(0,0,0,.34)}' +
      '#selection{display:none;position:absolute;border:1px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.42);background:rgba(255,255,255,.04)}' +
      '#size{position:absolute;left:0;top:-30px;padding:5px 8px;border-radius:5px;background:#111;color:#fff;font:12px "Segoe UI",sans-serif;white-space:nowrap}' +
      '#hint{position:absolute;left:50%;top:18px;transform:translateX(-50%);padding:7px 12px;border-radius:6px;background:rgba(15,15,18,.86);color:#fff;font:13px "Microsoft YaHei UI",sans-serif}' +
      '</style><img src="' + dataUrl + '"><div id="shade"></div><div id="selection"><span id="size"></span></div><div id="hint">拖动选择截图区域，Esc 或右键取消</div>' +
      '<script>const box=document.getElementById("selection"),size=document.getElementById("size"),shade=document.getElementById("shade");let start=null;' +
      'const draw=(x,y)=>{const left=Math.min(start.x,x),top=Math.min(start.y,y),width=Math.abs(x-start.x),height=Math.abs(y-start.y);box.style.cssText="display:block;left:"+left+"px;top:"+top+"px;width:"+width+"px;height:"+height+"px";size.textContent=Math.round(width)+" × "+Math.round(height)};' +
      'addEventListener("mousedown",e=>{if(e.button!==0)return;start={x:e.clientX,y:e.clientY};shade.style.display="none";draw(e.clientX,e.clientY)});' +
      'addEventListener("mousemove",e=>{if(start)draw(e.clientX,e.clientY)});' +
      'addEventListener("mouseup",e=>{if(!start||e.button!==0)return;const x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY),w=Math.abs(e.clientX-start.x),h=Math.abs(e.clientY-start.y);start=null;if(w<3||h<3){shade.style.display="block";box.style.display="none";return}location.href="shortcut-capture://select?x="+x+"&y="+y+"&width="+w+"&height="+h});' +
      'addEventListener("keydown",e=>{if(e.key==="Escape")location.href="shortcut-capture://cancel"});addEventListener("contextmenu",e=>{e.preventDefault();location.href="shortcut-capture://cancel"});</script>';

    captureOverlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    captureOverlay.setAlwaysOnTop(true, 'screen-saver');
    captureOverlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const finish = (url: string) => {
      if (!captureOverlay || captureOverlay.isDestroyed()) return;
      if (url.startsWith('shortcut-capture://select')) {
        const selection = new URL(url);
        const scaleFactor = display.scaleFactor || 1;
        const x = Math.max(0, Math.round(Number(selection.searchParams.get('x')) * scaleFactor));
        const y = Math.max(0, Math.round(Number(selection.searchParams.get('y')) * scaleFactor));
        const width = Math.min(image.getSize().width - x, Math.max(1, Math.round(Number(selection.searchParams.get('width')) * scaleFactor)));
        const height = Math.min(image.getSize().height - y, Math.max(1, Math.round(Number(selection.searchParams.get('height')) * scaleFactor)));
        if (width > 0 && height > 0) {
          clipboard.writeImage(image.crop({ x, y, width, height }));
          showScreenshotNotification('所选区域已写入剪贴板');
        }
      }
      captureOverlay.destroy();
    };
    captureOverlay.webContents.on('will-navigate', (event: any, url: string) => {
      if (!url.startsWith('shortcut-capture://')) return;
      event.preventDefault();
      finish(url);
    });
    captureOverlay.on('closed', () => { captureOverlay = null; });
    await captureOverlay.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
    captureOverlay.show();
    captureOverlay.focus();
  } catch (error) {
    console.error('Failed to start region capture', error);
    if (captureOverlay && !captureOverlay.isDestroyed()) captureOverlay.destroy();
  }
}

function snapshotClipboard() {
  return { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage(), bookmark: clipboard.readBookmark() };
}

function restoreClipboard(snapshot: ReturnType<typeof snapshotClipboard>) {
  const data: any = {};
  if (snapshot.text) data.text = snapshot.text;
  if (snapshot.html) data.html = snapshot.html;
  if (snapshot.rtf) data.rtf = snapshot.rtf;
  if (!snapshot.image.isEmpty()) data.image = snapshot.image;
  if (snapshot.bookmark?.title || snapshot.bookmark?.url) data.bookmark = snapshot.bookmark;
  clipboard.clear();
  if (Object.keys(data).length) clipboard.write(data);
}

async function translateCurrentSelection() {
  if (selectionTranslationBusy) return;
  selectionTranslationBusy = true;
  const snapshot = snapshotClipboard();
  try {
    clipboard.clear();
    await new Promise<void>((resolve, reject) => {
      childProcess.execFile('powershell.exe', ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"], { windowsHide: true }, (error: Error | null) => error ? reject(error) : resolve());
    });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const selectedText = clipboard.readText().trim().slice(0, 5000);
    restoreClipboard(snapshot);
    if (!selectedText) { showTranslationBubble('', '', '没有读取到选中的文字'); return; }
    const result = await translateText(selectedText, 'auto', 'zh');
    if (result.success) showTranslationBubble(selectedText, result.translatedText || '');
    else showTranslationBubble('', '', result.error || '翻译失败');
  } catch (error: any) {
    restoreClipboard(snapshot);
    showTranslationBubble('', '', error?.message || '无法读取选中文字');
  } finally {
    selectionTranslationBusy = false;
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
        if (cfg.closeOnBlur !== false && mainWindow && !mainWindow.isDestroyed()) {
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

// Dynamic island IPC
ipcMain.handle('island:getState', () => getIslandPreferences());
ipcMain.handle('island:set', (_e: any, enabled: boolean, style: string, position: string, autoHideFullscreen: boolean, musicEnabled: boolean, lyricBounce: boolean, displayState: string, orbitGlow: boolean, barsEnabled: boolean, tasksEnabled: boolean, cockpitEnabled: boolean, balanceProvider: string) => {
  try {
    const raw = readConfig();
    const cfg = raw ? JSON.parse(raw) : {};
    const provider = balanceProvider === 'opencode' ? 'opencode' : balanceProvider === 'deepseek' ? 'deepseek' : 'none';
    const island = {
      ...(cfg.island || {}),
      enabled: !!enabled,
      style: style || 'capsule',
      position: position || 'top-center',
      autoHideFullscreen: autoHideFullscreen !== false,
      musicEnabled: musicEnabled !== false,
      tasksEnabled: tasksEnabled !== false,
      cockpitEnabled: cockpitEnabled === true,
      balanceProvider: provider,
      deepseekEnabled: provider === 'deepseek',
      lyricBounce: lyricBounce !== false,
      orbitGlow: orbitGlow !== false,
      barsEnabled: barsEnabled !== false,
      displayState: displayState || 'collapsed',
    };
    writeConfig(JSON.stringify({ ...cfg, island }, null, 2));
    latestDeepseek = null;
    latestOpenCode = null;
    if (island.enabled) {
      islandUserHidden = false;
      createIslandWindow();
      islandCockpitActive = island.cockpitEnabled;
      syncHardwareMonitor();
      if (island.musicEnabled) {
        startMusicBridge();
      } else {
        stopMusicBridge();
      }
      if (!island.tasksEnabled) {
        destroyTaskListWindow();
        for (const win of reminderWindows.values()) {
          if (!win.isDestroyed()) win.destroy();
        }
        reminderWindows.clear();
      } else if (licenseGatePassed && resolveTaskList().length > 0 && !taskListHidden) {
        createTaskListWindow();
      }
      if (provider === 'none') {
        destroyDeepseekBall(false);
      }
    } else {
      islandUserHidden = true;
      islandCockpitActive = false;
      syncHardwareMonitor();
      destroyDeepseekBall(false);
      stopMusicBridge();
      if (islandWindow && !islandWindow.isDestroyed()) islandWindow.hide();
    }
    if (islandWindow && !islandWindow.isDestroyed()) positionIslandWindow(true);
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('island:config', island);
    }
    return { success: true, island };
  } catch (error: any) {
    return { success: false, error: error?.message || '保存灵动岛配置失败' };
  }
});
ipcMain.handle('island:move', (_e: any, _screenX: number, _screenY: number, deltaX: number, deltaY: number) => {
  try {
    if (!islandWindow || islandWindow.isDestroyed()) return { success: false };
    const bounds = islandWindow.getBounds();
    const nextX = bounds.x + deltaX;
    const nextY = bounds.y + deltaY;
    const display = electronScreen.getDisplayMatching(bounds);
    const area = display.workArea;
    const clampedX = Math.max(area.x, Math.min(area.x + area.width - bounds.width, nextX));
    const clampedY = Math.max(area.y, Math.min(area.y + area.height - bounds.height, nextY));
    islandWindow.setBounds({ x: clampedX, y: clampedY, width: bounds.width, height: bounds.height });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || '移动灵动岛失败' };
  }
});
ipcMain.handle('island:getBounds', () => {
  if (!islandWindow || islandWindow.isDestroyed()) return null;
  return islandWindow.getBounds();
});
ipcMain.handle('island:moveTo', (_e: any, x: number, y: number) => {
  try {
    if (!islandWindow || islandWindow.isDestroyed()) return { success: false };
    const bounds = islandWindow.getBounds();
    const display = electronScreen.getDisplayMatching(bounds);
    const area = display.workArea;
    const nextX = Math.max(area.x, Math.min(area.x + area.width - bounds.width, Math.round(Number(x) || 0)));
    const nextY = Math.max(area.y, Math.min(area.y + area.height - bounds.height, Math.round(Number(y) || 0)));
    islandProgrammaticMove = true;
    islandProgrammaticMoveUntil = Date.now() + 1000;
    islandWindow.setBounds({ x: nextX, y: nextY, width: bounds.width, height: bounds.height });
    islandProgrammaticMove = false;
    return { success: true, x: nextX, y: nextY };
  } catch (error: any) {
    return { success: false, error: error?.message || '移动灵动岛失败' };
  }
});
ipcMain.handle('island:finishMove', () => {
  if (!islandWindow || islandWindow.isDestroyed()) return false;
  const [x, y] = islandWindow.getPosition();
  return writeIslandConfig({ position: 'custom', x, y });
});
function toggleIslandWindow() {
  if (islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible()) {
    islandUserHidden = true;
    islandWindow.hide();
    return { visible: false };
  }
  islandUserHidden = false;
  createIslandWindow();
  return { visible: true };
}
ipcMain.handle('island:toggle', () => toggleIslandWindow());
ipcMain.handle('island:music:start', () => startMusicBridge());
ipcMain.handle('island:music:stop', () => {
  stopMusicBridge();
  return true;
});
ipcMain.handle('island:music:state', () => latestMusicState || { available: false });
ipcMain.handle('island:cockpit:state', () => latestCockpitData || {});
ipcMain.handle('island:balance:get', (_e: any, force?: boolean) => getBalanceData(force === true));
function handleBalanceSetKey(provider: string, key: string) {
  const cfg = readConfigObject();
  if (!cfg) return { success: false };
  const target = provider === 'opencode' ? 'opencode' : 'deepseek';
  writeConfig(JSON.stringify({
    ...cfg,
    island: {
      ...(cfg.island || {}),
      [target === 'opencode' ? 'opencodeApiKey' : 'deepseekApiKey']: String(key || '').trim(),
    },
  }, null, 2));
  latestDeepseek = null;
  latestOpenCode = null;
  return { success: true };
}
ipcMain.handle('island:balance:setKey', (_e: any, provider: string, key: string) => handleBalanceSetKey(provider, key));
ipcMain.handle('island:deepseek:setKey', (_e: any, key: string) => handleBalanceSetKey('deepseek', key));
ipcMain.handle('island:opencode:setKey', (_e: any, key: string) => handleBalanceSetKey('opencode', key));
function handleBalanceMusicPlaying(playing: boolean) {
  const cfg = readConfigObject();
  const enabled = currentBalanceProvider(cfg) !== 'none';
  if (playing && enabled && licenseGatePassed && readFeatureEnabled('island.balance')) {
    createDeepseekBall();
  } else {
    destroyDeepseekBall(true);
  }
  return true;
}
ipcMain.handle('island:balance:musicPlaying', (_e: any, playing: boolean) => handleBalanceMusicPlaying(playing));
ipcMain.handle('island:balance:open', (_e: any, provider: string) => {
  void shell.openExternal(provider === 'opencode' ? OPENCODE_WORKSPACE_URL : 'https://platform.deepseek.com');
  return true;
});
ipcMain.handle('island:deepseek:get', () => getBalanceData());
ipcMain.handle('island:deepseek:musicPlaying', (_e: any, playing: boolean) => handleBalanceMusicPlaying(playing));
ipcMain.handle('island:deepseek:open', () => {
  void shell.openExternal('https://platform.deepseek.com');
  return true;
});
ipcMain.handle('island:opencode:open', () => {
  void shell.openExternal(OPENCODE_WORKSPACE_URL);
  return true;
});
ipcMain.handle('clipboard:write', (_e: any, text: string) => {
  clipboard.writeText(String(text || ''));
  return true;
});
ipcMain.handle('island:music:control', (_e: any, action: string) => runMusicBridgeCommand(['-Control', String(action || '').toLowerCase()]));
ipcMain.handle('island:music:seek', (_e: any, ms: number) => runMusicBridgeCommand(['-Seek', String(Math.round(Number(ms) || 0))]));

// IPC Handlers
ipcMain.handle('config:read', () => readConfig());
ipcMain.handle('config:write', (_e: any, data: string) => {
  writeConfig(data);
  syncModuleServices();
  try {
    require('./sync/init').scheduleBoardListPublish();
  } catch {}
  return true;
});

ipcMain.handle('shell:open', async (_e: any, targetPath: string) => {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) return { success: false, error: '目标不存在' };
    const extension = path.extname(targetPath).toLowerCase();
    if (extension === '.exe' || extension === '.com' || extension === '.lnk') {
      await launchViaWindowsShell(targetPath);
    } else {
      const error = await shell.openPath(targetPath);
      if (error) return { success: false, error };
    }
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

ipcMain.handle('cockpit:start', () => {
  mainCockpitActive = true;
  return startHardwareMonitor();
});
ipcMain.handle('cockpit:stop', () => {
  mainCockpitActive = false;
  syncHardwareMonitor();
  return true;
});

const controlService = require('./control-service');
ipcMain.handle('control:start', async () => controlService.startControlService());
ipcMain.handle('control:stop', async () => controlService.stopControlService());
ipcMain.handle('control:restart', async () => controlService.restartControlService());
ipcMain.handle('control:status', async () => controlService.getControlStatus());
ipcMain.handle('control:resetCode', async () => controlService.resetControlCode());

ipcMain.handle('translate:text', (_e: any, text: string, from: string, to: string) => translateText(text, from, to));

ipcMain.handle('shell:runBat', async (_e: any, content: string, runAsAdmin: boolean) => {
  try {
    if (!content.trim()) return { success: false, error: 'BAT content is empty' };
    const batDirectory = path.join(app.getPath('userData'), 'bat');
    fs.mkdirSync(batDirectory, { recursive: true });
    const batPath = path.join(batDirectory, `shortcut-${Date.now()}.bat`);
    const normalizedContent = content.replace(/^\uFEFF/, '');
    fs.writeFileSync(batPath, `@chcp 65001 >nul\r\n${normalizedContent}\r\n`, 'utf8');

    const selfElevates = /%1\s+mshta\b.*ShellExecute/i.test(content);
    await launchViaWindowsShell(batPath, {
      runAsAdmin,
      argument: selfElevates ? '::' : undefined,
      hide: true,
    });
    setTimeout(() => fs.rm(batPath, { force: true }, () => undefined), 5 * 60 * 1000);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});
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

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('license:getState', async () => ({ ...readLicense(), machineCode: await getMachineCode() }));
ipcMain.handle('license:activate', async (_e: any, code: string) => {
  const activeCode = String(code || '').trim();
  const result = await checkLicense(activeCode);
  // 激活/换码成功后立即应用新权限，无需重启
  if (result.success === true) licenseGatePassed = true;
  syncModuleServices();
  await broadcastLicenseGate();
  return { ...result, code: activeCode, status: result.success === true ? 'active' : 'invalid' };
});
ipcMain.handle('license:policy', async () => {
  try {
    const machineCode = await getMachineCode();
    const result = await licenseRequest('policy', { machineCode, clientInfo: buildClientInfoPayload() });
    return result;
  } catch {
    return { success: false, message: '无法连接激活服务器' };
  }
});
ipcMain.handle('license:trial', async () => {
  const machineCode = await getMachineCode();
  try {
    const result = await licenseRequest('trial', { machineCode, clientInfo: buildClientInfoPayload() });
    if (result.success === true && result.code) {
      writeLicense({
        code: result.code,
        machineCode,
        plan: result.tier,
        status: 'active',
        expiresAt: result.expiresAt,
        lastCheckAt: new Date().toISOString(),
        message: result.message,
        tier: result.tier,
        activationPolicy: result.activationPolicy,
        moduleAccess: result.moduleAccess,
        featureAccess: result.featureAccess,
        guestEnabled: result.guestEnabled,
        contactLine: result.contactLine,
      });
      licenseGatePassed = true;
      syncModuleServices();
      await broadcastLicenseGate();
    }
    return { ...result, machineCode };
  } catch {
    return { success: false, machineCode, message: '无法连接激活服务器' };
  }
});

async function broadcastLicenseGate() {
  const machineCode = await getMachineCode();
  const license = readLicense();
  const policy = license?.activationPolicy || 'none';
  const activated = !!license?.code && license?.status === 'active';
  const guestEnabled = license?.guestEnabled === true;
  const payload = {
    required: policy !== 'none' && !activated && !guestEnabled,
    activated,
    checking: false,
    machineCode,
    code: license?.code || '',
    status: license?.status || 'invalid',
    expiresAt: license?.expiresAt,
    activationPolicy: policy,
    moduleAccess: license?.moduleAccess || [],
    featureAccess: license?.featureAccess || [],
    guestEnabled,
    contactLine: license?.contactLine || '',
    tier: license?.tier,
    plan: license?.plan,
    message: license?.message,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send('license:changed', payload);
      } catch {}
    }
  }
}
ipcMain.handle('license:check', () => checkLicense());
ipcMain.handle('license:gate', async () => {
  const machineCode = await getMachineCode();
  try {
    const result = await checkLicense();
    const license = readLicense();
    const hasCode = !!license?.code;
    const policy = result.activationPolicy || 'none';
    const activated = hasCode && result.success === true;
    const guestEnabled = result.guestEnabled === true;
    const required = policy !== 'none' && !activated && !guestEnabled;
    return {
      required,
      activated,
      checking: false,
      machineCode,
      guestEnabled,
      code: license?.code || '',
      status: license?.status || 'invalid',
      expiresAt: license?.expiresAt,
      ...result,
    };
  } catch {
    const license = readLicense();
    const policy = license?.activationPolicy || 'none';
    const activated = !!license?.code && license?.status === 'active';
    const guestEnabled = license?.guestEnabled === true;
    return {
      required: policy !== 'none' && !activated && !guestEnabled,
      activated,
      checking: false,
      machineCode,
      code: license?.code || '',
      status: license?.status || 'invalid',
      expiresAt: license?.expiresAt,
      activationPolicy: policy,
      moduleAccess: license?.moduleAccess,
      featureAccess: license?.featureAccess,
      guestEnabled,
      contactLine: license?.contactLine,
      tier: license?.tier,
      message: '无法连接激活服务器，请检查网络后重试',
    };
  }
});
ipcMain.handle('license:gatePassed', () => {
  licenseGatePassed = true;
  syncModuleServices();
  scanDueReminders();
  pruneTaskList();
  if (readModuleEnabled('island') && resolveTaskList().length > 0 && !taskListHidden && readConfigObject()?.island?.tasksEnabled !== false) {
    createTaskListWindow();
  }
  return true;
});

ipcMain.handle('usage:get', (_e: any, dateKey?: string) => getUsageDataPayload(dateKey));
ipcMain.handle('usage:setEnabled', (_e: any, enabled: boolean) => {
  if (usageRecord) usageRecord.enabled = !!enabled;
  saveUsageRecord();
  return getUsageDataPayload();
});
ipcMain.handle('usage:deleteDay', (_e: any, dateKey: string) => {
  const normalized = String(dateKey || '').trim();
  if (normalized && usageRecord?.days?.[normalized]) {
    delete usageRecord.days[normalized];
    saveUsageRecord();
  }
  return getUsageDataPayload(normalized || undefined);
});
ipcMain.handle('usage:clear', () => {
  if (usageRecord) usageRecord.days = {};
  saveUsageRecord();
  return getUsageDataPayload();
});
ipcMain.handle('usage:addIgnored', (_e: any, key: string) => {
  const normalized = String(key || '').trim().toLowerCase();
  if (usageRecord && normalized && !usageRecord.ignored.includes(normalized)) {
    usageRecord.ignored.push(normalized);
    saveUsageRecord();
  }
  return getUsageDataPayload();
});
ipcMain.handle('usage:removeIgnored', (_e: any, key: string) => {
  const normalized = String(key || '').trim().toLowerCase();
  if (usageRecord) {
    usageRecord.ignored = (usageRecord.ignored || []).filter((item: string) => item !== normalized);
    saveUsageRecord();
  }
  return getUsageDataPayload();
});
ipcMain.handle('usage:addBackgroundApp', (_e: any, key: string) => {
  const normalized = String(key || '').trim().toLowerCase();
  if (usageRecord && normalized && !usageRecord.backgroundApps.includes(normalized)) {
    usageRecord.backgroundApps.push(normalized);
    saveUsageRecord();
    restartUsageMonitor();
  }
  return getUsageDataPayload();
});
ipcMain.handle('usage:removeBackgroundApp', (_e: any, key: string) => {
  const normalized = String(key || '').trim().toLowerCase();
  if (usageRecord) {
    usageRecord.backgroundApps = (usageRecord.backgroundApps || []).filter((item: string) => item !== normalized);
    saveUsageRecord();
    restartUsageMonitor();
  }
  return getUsageDataPayload();
});
ipcMain.handle('codex:getState', () => readCodexCurrentState());
ipcMain.handle('codex:saveCurrentPreset', (_e: any, data: any) => {
  const name = String(data?.name || '').trim();
  const existingId = String(data?.id || '');
  const configText = readLiveCodexConfigText();
  if (!configText) return { success: false, error: '当前 Codex 配置不存在' };
  const current = parseCurrentCodexProvider();
  if (!current) return { success: false, error: '无法解析当前 Codex 配置' };
  const presets = loadCodexPresets();
  const existing = existingId
    ? presets.find((item: any) => item.id === existingId)
    : name
      ? presets.find((item: any) => String(item.name || '').trim().toLowerCase() === name.toLowerCase())
      : null;
  const lastApplied = getCodexLastAppliedPreset();
  const oldName = existing?.name || '';
  const now = new Date().toISOString();
  if (existing) {
    Object.assign(existing, {
      name: name || existing.name,
      providerId: current.providerId,
      baseUrl: current.baseUrl,
      wireApi: current.wireApi || 'chat',
      model: current.model,
      apiKey: current.apiKey || existing.apiKey,
      updatedAt: now,
    });
  } else {
    presets.push({
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name || current.name || current.providerId,
      providerId: current.providerId,
      baseUrl: current.baseUrl,
      wireApi: current.wireApi || 'chat',
      model: current.model,
      apiKey: current.apiKey,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (existing && lastApplied.name === oldName && lastApplied.providerId === current.providerId) {
    setCodexLastAppliedPreset(name || existing.name, lastApplied.providerId);
  }
  const preset = existing || presets[presets.length - 1];
  const shared = getCodexSharedProviderId() || current.providerId;
  if (!getCodexSharedProviderId()) setCodexSharedProviderId(shared);
  const isDefault = preset.isDefault || String(preset.id || '').startsWith('default-');
  const presetConfigText = isDefault ? configText : normalizeSnapshotConfig(configText, shared);
  writeCodexPresetFiles(preset, presetConfigText, readLiveCodexModelsText(), readLiveCodexAuthText());
  saveCodexPresets(presets);
  refreshCodexPresetIcon(preset);
  return { success: true, state: readCodexCurrentState() };
});
ipcMain.handle('codex:savePreset', (_e: any, data: any) => {
  const presets = loadCodexPresets();
  const existing = presets.find((item: any) => item.id === data?.id);
  const preset = normalizeCodexPreset(data || {}, existing);
  if (!preset.name || !preset.providerId || !preset.baseUrl || !preset.model) {
    return { success: false, error: '请填写名称、请求地址、供应商ID和模型名' };
  }
  if (existing) {
    Object.assign(existing, preset);
  } else {
    presets.push(preset);
  }
  saveCodexPresets(presets);
  const template = (() => {
    if (existing && fs.existsSync(getCodexPresetConfigPath(preset.id))) {
      return readCodexPresetSnapshot(preset);
    }
    const defaultPreset = getDefaultCodexPreset(presets);
    if (defaultPreset && fs.existsSync(getCodexPresetConfigPath(defaultPreset.id))) {
      return readCodexPresetSnapshot(defaultPreset);
    }
    return { config: readLiveCodexConfigText(), models: readLiveCodexModelsText() };
  })();
  const snapshot = buildCodexPresetSnapshot(preset, template.config, template.models);
  writeCodexPresetSnapshot(preset, snapshot.config, snapshot.models);
  refreshCodexPresetIcon(preset);
  return { success: true, state: readCodexCurrentState() };
});
ipcMain.handle('codex:deletePreset', (_e: any, id: string) => {
  const presets = loadCodexPresets().filter((item: any) => item.id !== id);
  saveCodexPresets(presets);
  const dir = getCodexPresetDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return { success: true, state: readCodexCurrentState() };
});
ipcMain.handle('codex:applyPreset', (_e: any, id: string) => {
  const preset = loadCodexPresets().find((item: any) => item.id === id);
  if (!preset) return { success: false, error: '预设不存在' };
  const result = applyCodexPreset(preset);
  return { ...result, state: readCodexCurrentState() };
});
ipcMain.handle('codex:restore', () => {
  const result = restoreCodexConfig();
  return { ...result, state: readCodexCurrentState() };
});
ipcMain.handle('codex:openFile', async (_e: any, which: string) => {
  const map: Record<string, string> = {
    config: getCodexConfigPath(),
    auth: getCodexAuthPath(),
    models: getCodexModelsPath(),
  };
  const file = map[which];
  if (!file || !fs.existsSync(file)) return { success: false, error: '文件不存在' };
  const error = await shell.openPath(file);
  return { success: !error, error: error || undefined };
});
ipcMain.handle('codex:openPresetDir', (_e: any, id: string) => {
  const dir = getCodexPresetDir(id);
  if (!fs.existsSync(dir)) return { success: false, error: '方案目录不存在' };
  shell.openPath(dir);
  return { success: true };
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

ipcMain.handle('reminder:getData', (_e: any) => {
  try {
    return reminderDataByWindow.get(_e.sender.id) || null;
  } catch {
    return null;
  }
});
ipcMain.handle('reminder:confirm', (_e: any, boardId: string, taskId: string) => {
  try {
    markTaskReminded(boardId, taskId);
    notifyConfigChanged();
    sendTaskListData();
    const key = `${boardId}:${taskId}`;
    const win = reminderWindows.get(key);
    if (win && !win.isDestroyed()) win.destroy();
  } catch {}
  return true;
});
ipcMain.handle('reminder:view', (_e: any, boardId: string, taskId: string) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('task:locate', { boardId, taskId });
    }
  } catch {}
  const key = `${boardId}:${taskId}`;
  setTimeout(() => {
    try {
      const win = reminderWindows.get(key);
      if (win && !win.isDestroyed()) win.destroy();
    } catch {}
  }, 150);
  return true;
});
ipcMain.handle('tasklist:addFromDrag', (_e: any, boardId: string, taskId: string) => {
  if (readConfigObject()?.island?.tasksEnabled === false) return true;
  const list = readTaskList();
  if (!list.some((item: any) => item.boardId === boardId && item.taskId === taskId)) {
    list.push({ boardId, taskId, addedAt: new Date().toISOString() });
    saveTaskList(list);
    createTaskListWindow();
  }
  return true;
});
ipcMain.handle('tasklist:get', () => {
  pruneTaskList();
  return resolveTaskList();
});
ipcMain.handle('tasklist:refresh', () => {
  pruneTaskList();
  sendTaskListData();
  return true;
});
ipcMain.handle('tasklist:remove', (_e: any, boardId: string, taskId: string) => {
  const list = readTaskList().filter((item: any) => !(item.boardId === boardId && item.taskId === taskId));
  saveTaskList(list);
  if (list.length === 0) {
    destroyTaskListWindow();
    destroyDeepseekBall(false);
  } else {
    sendTaskListData();
  }
  return true;
});
ipcMain.handle('tasklist:complete', (_e: any, boardId: string, taskId: string) => {
  toggleTaskDone(boardId, taskId);
  notifyConfigChanged();
  sendTaskListData();
  return true;
});
ipcMain.handle('tasklist:locate', (_e: any, boardId: string, taskId: string) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('task:locate', { boardId, taskId });
    }
  } catch {}
  return true;
});
ipcMain.handle('tasklist:overlap', (_e: any, screenX: number, screenY: number, boardId: string, taskId: string) => {
  if (readConfigObject()?.island?.tasksEnabled === false) return true;
  if (pointInIsland(screenX, screenY)) {
    currentDragTask = { boardId, taskId };
    createTaskListWindow();
  }
  return true;
});
ipcMain.handle('tasklist:drop', (_e: any, screenX: number, screenY: number, boardId: string, taskId: string) => {
  if (readConfigObject()?.island?.tasksEnabled === false) return true;
  if (pointInIsland(screenX, screenY)) {
    const list = readTaskList();
    if (!list.some((item: any) => item.boardId === boardId && item.taskId === taskId)) {
      list.push({ boardId, taskId, addedAt: new Date().toISOString() });
      saveTaskList(list);
      createTaskListWindow();
    }
  }
  currentDragTask = null;
  return true;
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
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    restoreFromBackupIfNeeded();
  backupConfig();
  usageRecord = loadUsageRecord();
  usageFlushTimer = setInterval(() => saveUsageRecord(), 60000);
  setupAutoUpdater();
  createWindow();
  createTray();
  scanDueReminders();
  setInterval(() => scanDueReminders(), 20000);
  checkLicenseOnStartup();
  reportDeviceStartup();
  setInterval(() => applyIslandVisibility(), 1500);
  syncModuleServices();

  // 语音输入（右 Alt）初始化 + 麦克风权限
  try {
    session.defaultSession.setPermissionRequestHandler((_wc: any, permission: string, callback: (grant: boolean) => void) => {
      callback(permission === 'media');
    });
    const { initVoiceInput } = require('./voice-input');
    initVoiceInput();
  } catch (err: any) {
    console.error('voice input init failed:', err?.message || err);
  }

  // 联动绑定 + 同步引擎初始化
  try {
    const { initSync } = require('./sync/init');
    void initSync({
      readConfigObject,
      updateConfig: (updater: (config: any) => any) => {
        const current = readConfigObject() || {};
        writeConfig(JSON.stringify(updater(current), null, 2));
      },
      notifyConfigChanged,
      taskwallEnabled: () => readModuleEnabled('tasks'),
    });
  } catch (err: any) {
    console.error('sync init failed:', err?.message || err);
  }
  try {
    const { initFileTransfer } = require('./file-transfer');
    initFileTransfer();
  } catch (err: any) {
    console.error('file transfer init failed:', err?.message || err);
  }

  // 每 10 分钟复查激活状态：后台禁用激活码/调整权限后客户端口可生效
  setInterval(() => {
    void checkLicense()
      .then((result) => {
        if (result.success === true) licenseGatePassed = true;
        if (licenseGatePassed) syncModuleServices();
        void broadcastLicenseGate();
      })
      .catch(() => undefined);
  }, 10 * 60 * 1000);

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
  const fullScreenshotHotkey = globalShortcut.register('Alt+S', () => {
    void captureCurrentDisplay();
  });
  if (!fullScreenshotHotkey) {
    console.error('Failed to register Alt+S hotkey');
  }
  const regionScreenshotHotkey = globalShortcut.register('Alt+D', () => {
    void startRegionCapture();
  });
  if (!regionScreenshotHotkey) {
    console.error('Failed to register Alt+D hotkey');
  }
  const islandHotkey = globalShortcut.register('Alt+I', () => {
    toggleIslandWindow();
  });
  if (!islandHotkey) {
    console.error('Failed to register Alt+I hotkey');
  }
  const taskListHotkey = globalShortcut.register('Alt+U', () => {
    taskListHidden = !taskListHidden;
    if (taskListHidden) {
      destroyTaskListWindow();
    } else {
      createTaskListWindow();
    }
  });
  if (!taskListHotkey) {
    console.error('Failed to register Alt+U hotkey');
  }
});

  app.on('window-all-closed', () => {
    // Keep running in tray
  });

  app.on('before-quit', () => {
    if (islandWindow && !islandWindow.isDestroyed()) islandWindow.destroy();
    destroyTaskListWindow();
    for (const win of reminderWindows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    reminderWindows.clear();
    stopMusicBridge();
    stopHardwareMonitor();
    try { require('./control-service').stopControlService(); } catch { }
    if (usageFlushTimer) clearInterval(usageFlushTimer);
    stopUsageMonitor();
    if (captureOverlay && !captureOverlay.isDestroyed()) captureOverlay.destroy();
    globalShortcut.unregisterAll();
  });
}
