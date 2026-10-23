import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  ActivationPolicy,
  AppConfig,
  DEFAULT_CONFIG,
  Tab,
  Group,
  Shortcut,
  Locale,
  ModuleAccessLevel,
  ModuleAccessRule,
  FeatureAccessRule,
  ModuleId,
  PanelAnimation,
  TaskNote,
  TaskBoardConfig,
  TaskEditorDraft,
  UpdateState,
  IslandPreferences,
  UsageData,
  CodexPresetState,
} from '../types';
import {
  CORE_MODULE_IDS,
  MODULE_REGISTRY,
  getAvailableModuleIds,
  normalizeModuleConfig,
  reorderModuleConfig,
} from '../moduleRegistry';
import { t } from '../i18n';

interface AppState {
  config: AppConfig;
  activeTabId: string;
  searchQuery: string;
  selectedShortcutId: string | null;
  activeModule: ModuleId;
  editingShortcut: Shortcut | null;
  editingGroupId: string | null;
  showAddModal: boolean;
  showSettings: boolean;
  showImportSoftware: boolean;
  toasts: Toast[];
  licensePolicy: ActivationPolicy;
  licenseModuleAccess: Record<ModuleId, boolean>;
  licenseFeatureAccess: Record<string, boolean>;
  /** 右键菜单/命令行带入转换板块的文件（App 收到后置入，面板挂载时取走） */
  pendingConverterDrop: { paths: string[]; action: string } | null;

  // Actions
  loadConfig: () => Promise<void>;
  saveConfig: () => Promise<void>;
  setPendingConverterDrop: (drop: { paths: string[]; action: string } | null) => void;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setLocale: (locale: Locale) => void;
  setPanelAnimation: (animation: PanelAnimation) => void;
  setOpenOnStartup: (enabled: boolean) => Promise<void>;
  setActiveTab: (tabId: string) => void;
  setSearchQuery: (q: string) => void;
  setSelectedShortcut: (shortcutId: string | null) => void;
  setActiveModule: (moduleId: ModuleId) => void;
  setLicenseAccess: (info: { activationPolicy?: ActivationPolicy; moduleAccess?: ModuleAccessRule[]; featureAccess?: FeatureAccessRule[]; tier?: ModuleAccessLevel; guestEnabled?: boolean; contactLine?: string; code?: string; status?: string; expiresAt?: string; message?: string }) => void;
  setModuleEnabled: (id: ModuleId, enabled: boolean) => void;
  setModuleVisible: (id: ModuleId, visible: boolean) => void;
  setModuleOrder: (orderedIds: ModuleId[]) => void;
  setModuleGroup: (id: ModuleId, group: 'primary' | 'more') => void;
  addSearchHistory: (query: string) => void;
  deleteSearchHistory: (query: string) => void;

  // Task actions
  addTaskBoard: (name?: string) => void;
  renameTaskBoard: (boardId: string, name: string) => void;
  deleteTaskBoard: (boardId: string) => void;
  setActiveTaskBoard: (boardId: string) => void;
  setTaskEditorDraft: (draft: TaskEditorDraft | null) => void;
  addTask: (text: string, options?: { longText?: boolean; details?: string; reminderAt?: string }) => string | null;
  updateTask: (taskId: string, updates: Partial<TaskNote>) => void;
  markTaskReminded: (boardId: string, taskId: string) => void;
  toggleTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  moveTask: (taskId: string, x: number, y: number) => void;

  // Tab actions
  addTab: (name: string) => void;
  renameTab: (tabId: string, name: string) => void;
  deleteTab: (tabId: string) => void;
  reorderTabs: (fromIdx: number, toIdx: number) => void;

  // Group actions
  addGroup: (tabId: string, name: string) => void;
  renameGroup: (tabId: string, groupId: string, name: string) => void;
  deleteGroup: (tabId: string, groupId: string) => void;
  toggleGroupCollapse: (tabId: string, groupId: string) => void;

  // Shortcut actions
  addShortcut: (tabId: string, groupId: string, shortcut: Omit<Shortcut, 'id' | 'createdAt' | 'updatedAt' | 'sort'>) => void;
  updateShortcut: (tabId: string, groupId: string, shortcutId: string, updates: Partial<Shortcut>) => void;
  deleteShortcut: (tabId: string, groupId: string, shortcutId: string) => void;
  moveShortcut: (fromTabId: string, fromGroupId: string, toTabId: string, toGroupId: string, shortcutId: string, newIndex: number) => void;
  reorderShortcuts: (tabId: string, groupId: string, fromIdx: number, toIdx: number) => void;
  addMultipleShortcuts: (tabId: string, groupId: string, shortcuts: Array<Omit<Shortcut, 'id' | 'createdAt' | 'updatedAt' | 'sort'>>) => void;

  // Modal
  openAddModal: (groupId: string, editing?: Shortcut) => void;
  closeAddModal: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openImportSoftware: () => void;
  closeImportSoftware: () => void;

  // Toast
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;

  // Import/Export
  exportConfig: () => Promise<void>;
  importConfig: () => Promise<void>;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

let taskEditorSaveTimer: ReturnType<typeof setTimeout> | null = null;

declare global {
  interface Window {
    electronAPI?: {
      readConfig: () => Promise<string>;
      writeConfig: (data: string) => Promise<void>;
      openTarget: (path: string) => Promise<{ success: boolean; error?: string }>;
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
      runBat: (content: string, runAsAdmin: boolean) => Promise<{ success: boolean; error?: string }>;
      showInFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
      openFile: () => Promise<string | null>;
      openFolder: () => Promise<string | null>;
      saveFile: (name: string) => Promise<string | null>;
      openImportFile: () => Promise<string | null>;
      openIconFile: () => Promise<string | null>;
      readFile: (path: string) => Promise<string | null>;
      writeFile: (path: string, data: string) => Promise<{ success: boolean; error?: string }>;
      fileExists: (path: string) => Promise<boolean>;
      getPath: (name: string) => Promise<string>;
      getVersion: () => Promise<string>;
      getLicenseState: () => Promise<unknown>;
      activateLicense: (code: string) => Promise<unknown>;
      checkLicense: () => Promise<unknown>;
      getLicenseGate: () => Promise<unknown>;
      licenseGatePassed: () => Promise<unknown>;
      getLicensePolicy: () => Promise<unknown>;
      startTrial: () => Promise<unknown>;
      onLicenseChanged: (callback: (data: unknown) => void) => () => void;
      voiceGetConfig: () => Promise<unknown>;
      voiceOpen: () => Promise<unknown>;
      voiceGetStats: () => Promise<unknown>;
      voiceStart: () => Promise<unknown>;
      voiceAudio: (chunk: ArrayBuffer) => void;
      voiceConfirm: () => Promise<unknown>;
      voiceToggle: () => Promise<unknown>;
      voiceCancel: () => Promise<unknown>;
      syncGetBinding: () => Promise<unknown>;
      syncPullNow: () => Promise<unknown>;
      syncListDevices: () => Promise<unknown>;
      syncRemoveDevice: (deviceId: string) => Promise<unknown>;
      syncRenameDevice: (deviceId: string, deviceName: string) => Promise<unknown>;
      onVoiceSession: (callback: (text: string) => void) => () => void;
      onVoicePolish: (callback: (text: string) => void) => () => void;
      onVoicePolishError: (callback: (text: string) => void) => () => void;
      onVoiceStatus: (callback: (data: unknown) => void) => () => void;
      getReminderData: () => Promise<unknown>;
      onReminderData: (callback: (data: unknown) => void) => () => void;
      confirmReminder: (boardId: string, taskId: string) => Promise<unknown>;
      viewReminder: (boardId: string, taskId: string) => Promise<unknown>;
      getTaskList: () => Promise<unknown>;
      refreshTaskList: () => Promise<unknown>;
      removeTaskFromList: (boardId: string, taskId: string) => Promise<unknown>;
      completeTaskInList: (boardId: string, taskId: string) => Promise<unknown>;
      locateTaskFromList: (boardId: string, taskId: string) => Promise<unknown>;
      overlapTaskDrag: (screenX: number, screenY: number, boardId: string, taskId: string) => Promise<unknown>;
      dropTaskOnList: (screenX: number, screenY: number, boardId: string, taskId: string) => Promise<unknown>;
      addTaskFromDrag: (boardId: string, taskId: string) => Promise<unknown>;
      onTaskListData: (callback: (data: unknown) => void) => () => void;
      onConfigChanged: (callback: () => void) => () => void;
      onTaskLocate: (callback: (data: unknown) => void) => () => void;
      /** 把本地任务墙名列表重新上报到云端（手机端 board.list 依赖它）；建/删/改名墙后必须调用 */
      publishBoardNames: () => Promise<unknown>;
      // ── 转换板块 ──
      converterDetect: (paths: string[]) => Promise<Array<{ path: string; name: string; kind: string; ext: string; size: number; targets: string[]; flavor?: string }>>;
      converterConvert: (path: string, target: string, quality?: number, bitrateKbps?: number, outDir?: string | null) => Promise<{ success: boolean; id: string }>;
      converterExtract: (path: string, password?: string | null, outDir?: string | null) => Promise<{ success: boolean; id: string }>;
      converterCompress: (paths: string[], flavor: string, outPath?: string | null, password?: string | null, level?: number) => Promise<{ success: boolean; id: string }>;
      converterPickFiles: () => Promise<string[] | null>;
      converterPickDir: () => Promise<string | null>;
      converterHistory: () => Promise<Array<{ id: string; time: string; action: string; src: string; out: string; status: string; note: string }>>;
      converterHistoryRemove: (id: string) => Promise<unknown>;
      shellMenuState: () => Promise<{ available: boolean; enabled: boolean; format: string; formats: string[] }>;
      shellMenuSet: (enabled: boolean, format?: string) => Promise<{ success: boolean; enabled: boolean; format?: string; error?: string }>;
      converterTakePending: () => Promise<{ paths: string[]; action?: string } | null>;
      /** 打开某文件所在目录并选中该文件（目录则直接打开）——转换完成后自动定位产物 */
      revealInExplorer: (path: string) => Promise<{ success: boolean; error?: string }>;
      onConverterDrop: (callback: (data: { paths: string[]; action?: string; fromShell?: boolean }) => void) => () => void;
      onConverterDragover: (callback: (data: { active: boolean }) => void) => () => void;
      // ── SC 球（Batch 2：拖放转格式 + 穿透开关）──
      onBallDragover: (callback: (data: { active: boolean; paths?: string[] }) => void) => () => void;
      onBallDrop: (callback: (data: { paths: string[] }) => void) => () => void;
      onBallPassthrough: (callback: (data: { on: boolean }) => void) => () => void;
      ballShape: (shape: 'collapsed' | 'hint' | 'menu') => Promise<{ success: boolean; shape?: string; error?: string }>;
      ballPassthrough: (on: boolean) => Promise<{ success: boolean; on: boolean }>;
      ballState: () => Promise<{ passthrough: boolean; shortcut: string }>;
      /**
       * 岛前端上报"可见内容矩形"（逻辑像素，窗口坐标）。
       * 主进程据此判断"不穿透时哪些区域才接收鼠标"——岛窗口是 360×340 的透明窗，
       * 整窗接收鼠标会吞掉球周围那一圈桌面点击。
       */
      islandHitRect: (x: number, y: number, w: number, h: number) => Promise<{ success: boolean }>;
      ballOpenInPanel: (paths: string[]) => Promise<{ success: boolean }>;
      setBlurGuard: (on: boolean) => Promise<{ success: boolean; guard: boolean }>;
      debugLog: (msg: string) => Promise<unknown>;
      onConverterProgress: (callback: (data: { id: string; pct: number; note: string }) => void) => () => void;
      onConverterDone: (callback: (data: { id: string; out: string; out_dir: string; items: number }) => void) => () => void;
      onConverterError: (callback: (data: { id: string; message: string }) => void) => () => void;
      fileTransferGetState: () => Promise<any>;
      fileTransferPickFiles: () => Promise<string[] | null>;
      fileTransferSendText: (text: string) => Promise<any>;
      fileTransferSendFile: (taskId: string, filePath: string) => Promise<any>;
      fileTransferSendBytes: (taskId: string, name: string, base64: string) => Promise<any>;
      fileTransferDownload: (taskId: string, fileId: string, name: string) => Promise<any>;
      fileTransferPreviewUrl: (fileId: string) => Promise<string | null>;
      fileTransferDownloadShared: (taskId: string, token: string, fileId: string, name: string) => Promise<any>;
      fileTransferDelete: (messageId: string) => Promise<any>;
      fileTransferFavorite: (messageId: string, favorite: boolean) => Promise<any>;
      fileTransferCancel: (taskId: string) => Promise<any>;
      fileTransferActiveTasks: () => Promise<any>;
      fileTransferHistory: () => Promise<any>;
      fileTransferHistoryRemove: (id: string) => Promise<any>;
      onFileTransferProgress: (callback: (data: any) => void) => () => void;
      onFileTransferDrop: (callback: (data: { paths?: string[] }) => void) => () => void;
      onFileTransferDragover: (callback: (data: { active?: boolean }) => void) => () => void;
      onFileTransferMessage: (callback: (data: any) => void) => () => void;
      fileTransferShareText: (text: string, code: string, hours: number) => Promise<any>;
      fileTransferShareFile: (messageId: string, code: string, hours: number) => Promise<any>;
      fileTransferShareList: () => Promise<any>;
      fileTransferShareDelete: (id: string) => Promise<any>;
      fileTransferClaim: (code: string) => Promise<any>;
      getOpenAtLogin: () => Promise<boolean>;
      setOpenAtLogin: (enabled: boolean) => Promise<boolean>;
      getInstalledSoftware: () => Promise<Array<{ name: string; path: string; icon: string }>>;
      getFileInfo: (filePath: string) => Promise<{ name: string; path: string; type: 'app' | 'folder' | 'file' } | null>;
      getFileIcon: (filePath: string) => Promise<string | null>;
      getFileIcons: (filePaths: string[]) => Promise<Record<string, string | null>>;
      getWebsiteIcon: (url: string) => Promise<string | null>;
      translateText: (text: string, from: string, to: string) => Promise<{ success: boolean; translatedText?: string; from?: string; to?: string; error?: string }>;
      startCockpit: () => Promise<{ success: boolean; error?: string }>;
      stopCockpit: () => Promise<boolean>;
      // 驾驶舱提权：主进程保持普通权限（拖放不受影响），只把读传感器的子进程放进
      // Highest 计划任务，两边用命名管道通信 → 这样 CPU/内存温度也能拿到。
      cockpitElevationStatus: () => Promise<{
        success: boolean;
        selfElevated?: boolean;
        taskName?: string;
        taskExists?: boolean;
        taskExeMatches?: boolean;
        taskExe?: string;
        sidecarPath?: string;
        mode?: 'off' | 'task' | 'stdout' | string;
        tempsAvailable?: boolean;
      }>;
      cockpitSetupElevation: () => Promise<{ success: boolean; error?: string }>;
      startControl: () => Promise<{ success: boolean; port?: number; error?: string }>;
      stopControl: () => Promise<boolean>;
      restartControl: () => Promise<{ success: boolean; port?: number; error?: string }>;
      getControlStatus: () => Promise<{ running: boolean; starting?: boolean; port: number; injector: boolean; authMode?: string; pairCode?: string | null; clients?: number; urls: string[] }>;
      resetControlCode: () => Promise<{ success: boolean; pairCode?: string; error?: string }>;
      startCloudControl: () => Promise<{ success: boolean; error?: string }>;
      stopCloudControl: () => Promise<boolean>;
      getCloudControlStatus: () => Promise<{ active: boolean; connected: boolean; connecting: boolean; injector: boolean; lastError: string }>;
      onCockpitData: (callback: (data: unknown) => void) => () => void;
      showNotification: (title: string, body: string) => Promise<boolean>;
      checkForUpdates: () => Promise<{ success: boolean; status: string; error?: string }>;
      downloadUpdate: () => Promise<{ success: boolean; status: string; error?: string }>;
      getUpdateState: () => Promise<UpdateState>;
      installUpdate: () => Promise<boolean>;
      onUpdateState: (callback: (state: UpdateState) => void) => () => void;
      onShortcutFailed: (callback: (data: unknown) => void) => () => void;
      getTheme: () => Promise<'dark' | 'light'>;
      getUsageData: (date?: string) => Promise<UsageData>;
      setUsageEnabled: (enabled: boolean) => Promise<UsageData>;
      deleteUsageDay: (date: string) => Promise<UsageData>;
      addUsageBackgroundApp: (key: string) => Promise<UsageData>;
      removeUsageBackgroundApp: (key: string) => Promise<UsageData>;
      clearUsageData: () => Promise<UsageData>;
      addUsageIgnored: (key: string) => Promise<UsageData>;
      removeUsageIgnored: (key: string) => Promise<UsageData>;
      getCodexPresetState: () => Promise<CodexPresetState>;
      saveCurrentCodexPreset: (data: unknown) => Promise<{ success: boolean; error?: string; state?: CodexPresetState }>;
      saveCodexPreset: (preset: unknown) => Promise<{ success: boolean; error?: string; state?: CodexPresetState }>;
      deleteCodexPreset: (id: string) => Promise<{ success: boolean; error?: string; state?: CodexPresetState }>;
      applyCodexPreset: (id: string) => Promise<{ success: boolean; error?: string; state?: CodexPresetState }>;
      restoreCodexPreset: () => Promise<{ success: boolean; error?: string; state?: CodexPresetState }>;
      openCodexFile: (which: string) => Promise<{ success: boolean; error?: string }>;
      openCodexPresetDir: (id: string) => Promise<{ success: boolean; error?: string }>;
      getIslandState: () => Promise<{ enabled: boolean; style: string; position: string; autoHideFullscreen: boolean; musicEnabled?: boolean }>;
      setIsland: (enabled: boolean, style: string, position: string, autoHideFullscreen: boolean, musicEnabled: boolean, lyricBounce: boolean, displayState: string, orbitGlow: boolean, barsEnabled: boolean, tasksEnabled: boolean, cockpitEnabled: boolean, balanceProvider: string) => Promise<{ success: boolean; error?: string; island?: Record<string, unknown> }>;
      moveIsland: (screenX: number, screenY: number, deltaX: number, deltaY: number) => Promise<{ success: boolean; error?: string }>;
      getIslandBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
      moveIslandTo: (x: number, y: number) => Promise<{ success: boolean; error?: string }>;
      finishIslandMove: () => Promise<boolean>;
      toggleIsland: () => Promise<{ visible: boolean }>;
      onIslandConfig: (callback: (state: unknown) => void) => () => void;
      startMusicBridge: () => Promise<{ success: boolean; error?: string }>;
      stopMusicBridge: () => Promise<boolean>;
      getMusicState: () => Promise<unknown>;
      getIslandCockpitState: () => Promise<unknown>;
      getBalanceData: () => Promise<unknown>;
      setBalanceKey: (provider: string, key: string) => Promise<{ success: boolean; error?: string }>;
      setBalanceMusicPlaying: (playing: boolean) => Promise<unknown>;
      openBalancePlatform: (provider: string) => Promise<unknown>;
      onBalanceMerge: (callback: () => void) => () => void;
      getDeepseekBalance: () => Promise<unknown>;
      setDeepseekKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      setOpenCodeKey: (key: string) => Promise<{ success: boolean; error?: string }>;
      setDeepseekMusicPlaying: (playing: boolean) => Promise<unknown>;
      openDeepseekPlatform: () => Promise<unknown>;
      openOpenCodePlatform: () => Promise<unknown>;
      onDeepseekMerge: (callback: () => void) => () => void;
      copyText: (text: string) => Promise<unknown>;
      controlMusic: (action: string) => Promise<unknown>;
      seekMusic: (ms: number) => Promise<unknown>;
      onIslandMusic: (callback: (state: unknown) => void) => () => void;
      onIslandCockpit: (callback: (data: unknown) => void) => () => void;
      closeWindow: () => Promise<void>;
      resizeWindow: (width: number, height: number) => Promise<void>;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<boolean>;
      isMaximized: () => Promise<boolean>;
      onWindowWillShow: (callback: () => void) => () => void;
    };
  }
}

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

// Fallback for browser dev
const localStore = {
  get: (): AppConfig | null => {
    try {
      const raw = localStorage.getItem('shortcut-config');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set: (cfg: AppConfig) => {
    localStorage.setItem('shortcut-config', JSON.stringify(cfg));
  },
};

const normalizeTaskBoards = (config: Partial<AppConfig>): Pick<AppConfig, 'taskBoards' | 'activeTaskBoardId' | 'tasks'> => {
  const now = new Date().toISOString();
  const legacyTasks = Array.isArray(config.tasks) ? config.tasks : [];
  const rawBoards = Array.isArray(config.taskBoards) && config.taskBoards.length > 0
    ? config.taskBoards
    : [{ ...DEFAULT_CONFIG.taskBoards[0], notes: legacyTasks }];

  const taskBoards = rawBoards.map((board, boardIndex) => {
    const notes = (Array.isArray(board.notes) ? board.notes : []).map((note, noteIndex) => ({
      ...note,
      zIndex: typeof note.zIndex === 'number' ? note.zIndex : (noteIndex + 1),
    }));
    return {
      id: board.id || (boardIndex === 0 ? DEFAULT_CONFIG.taskBoards[0].id : uuidv4()),
      name: (board.name || `任务墙 ${boardIndex + 1}`).trim(),
      notes,
      createdAt: board.createdAt || now,
      updatedAt: board.updatedAt || now,
    };
  });

  const fallbackBoard = taskBoards[0] || { ...DEFAULT_CONFIG.taskBoards[0], notes: [] };
  const activeTaskBoardId = taskBoards.some((board) => board.id === config.activeTaskBoardId)
    ? config.activeTaskBoardId
    : fallbackBoard.id;

  return { taskBoards: taskBoards.length > 0 ? taskBoards : [fallbackBoard], activeTaskBoardId, tasks: [] };
};

const getActiveBoardId = (config: AppConfig) => config.activeTaskBoardId || config.taskBoards[0]?.id || DEFAULT_CONFIG.taskBoards[0].id;

/**
 * 任务便签 z 值上限（**全局弹层的层序基线**）。
 *
 * 为什么必须有上界：语义要求"新便签 / 刚拖过的便签在最上层"，所以每次 addTask/moveTask
 * 都要取"当前最大 + 1"。但那是**无上界递增**——用户每拖一次就 +1，真实配置里已经涨到
 * 66/67…，于是固定层级的全局弹层（设置面板等）会被便签压住。
 *
 * 约定（改动前请先看清 TaskBoard.tsx 顶部注释）：
 *   便签 1..999  <  全局弹层 1000（设置/导入/快捷键）  <  确认类弹层 1100
 *               <  撕碎 12000 < 撕纸机 13000 < 任务墙自身弹层 14000+
 * 任何新增的全局弹层都必须 ≥ 1000。
 */
const TASK_Z_CEILING = 999;

/**
 * 归一化便签 z 值：按当前层序（zIndex 升序）重排为 1..n，保留相对上下关系。
 * 顺便把非法值（NaN/负数/非数字）修正为有效序号，避免 `max` 被污染。
 */
const normalizeNoteZIndexes = (notes: TaskNote[]): TaskNote[] =>
  notes
    .slice()
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
    .reduce<TaskNote[]>((acc, note) => {
      acc.push({ ...note, zIndex: acc.length + 1 });
      return acc;
    }, []);

/**
 * 取"下一个最上层"的 z 值；达到上限时先把该墙所有便签归一化为 1..n 再 +1。
 * 返回归一化后的便签数组（无需归一化时原样返回）与要赋给目标便签的 z。
 */
const nextTaskZIndex = (notes: TaskNote[]): { notes: TaskNote[]; zIndex: number } => {
  const max = notes.reduce((m, note) => Math.max(m, Number.isFinite(note.zIndex) ? (note.zIndex as number) : 0), 0);
  if (max >= TASK_Z_CEILING) {
    const renumbered = normalizeNoteZIndexes(notes);
    return { notes: renumbered, zIndex: renumbered.length + 1 };
  }
  return { notes, zIndex: Math.max(max + 1, 1) };
};

const updateActiveTaskBoard = (config: AppConfig, update: (board: TaskBoardConfig) => TaskBoardConfig): AppConfig => {
  const activeBoardId = getActiveBoardId(config);
  return {
    ...config,
    taskBoards: config.taskBoards.map((board) => board.id === activeBoardId ? update(board) : board),
    activeTaskBoardId: activeBoardId,
    tasks: [],
  };
};
export const useStore = create<AppState>((set, get) => ({
  config: { ...DEFAULT_CONFIG },
  activeTabId: DEFAULT_CONFIG.activeTabId || 'default',
  searchQuery: '',
  selectedShortcutId: null,
  activeModule: DEFAULT_CONFIG.activeModule,
  editingShortcut: null,
  editingGroupId: null,
  showAddModal: false,
  showSettings: false,
  showImportSoftware: false,
  toasts: [],
  licensePolicy: 'all',
  licenseModuleAccess: Object.fromEntries(
    MODULE_REGISTRY.map((meta) => [meta.id, true]),
  ) as Record<ModuleId, boolean>,
  licenseFeatureAccess: {},

  pendingConverterDrop: null,
  setPendingConverterDrop: (drop) => set({ pendingConverterDrop: drop }),

  loadConfig: async () => {
    let raw = '';
    if (isElectron) {
      raw = await window.electronAPI!.readConfig();
    } else {
      const stored = localStore.get();
      if (stored) raw = JSON.stringify(stored);
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as AppConfig;
        const island: IslandPreferences = { ...DEFAULT_CONFIG.island!, ...(parsed.island || {}) };
        const modules = normalizeModuleConfig(parsed.modules);
        const base = {
          ...DEFAULT_CONFIG,
          ...parsed,
          modules,
          island,
          scTaskList: parsed.scTaskList || [],
          locale: 'zh-CN' as Locale,
          searchHistory: parsed.searchHistory || [],
          activeModule: parsed.activeModule || 'shortcuts',
          ...normalizeTaskBoards(parsed),
        };
        const available = getAvailableModuleIds(base as AppConfig);
        const usageEntry = modules.find((item) => item.id === 'usage');
        const usageManageOk = usageEntry?.enabled !== false && usageEntry?.visible !== false;
        const savedActive = parsed.activeModule;
        const nextActive: ModuleId = savedActive === 'usageManage' && usageManageOk
          ? 'usageManage'
          : available.includes(savedActive as ModuleId)
            ? (savedActive as ModuleId)
            : (available[0] || 'shortcuts');
        const storedLicense = (parsed.license || {}) as {
          activationPolicy?: ActivationPolicy;
          moduleAccess?: ModuleAccessRule[];
          featureAccess?: FeatureAccessRule[];
        };
        const storedPolicy = storedLicense.activationPolicy || 'none';
        const storedRules = new Map((storedLicense.moduleAccess || []).map((rule) => [rule.id, rule]));
        const licenseModuleAccess = Object.fromEntries(
          MODULE_REGISTRY.map((meta) => [
            meta.id,
            meta.id === 'activation'
              ? true
              : storedPolicy === 'none'
                ? true
                : storedRules.has(meta.id)
                  ? storedRules.get(meta.id)!.allowed !== false
                  : storedPolicy === 'all' ? false : true,
          ]),
        ) as Record<ModuleId, boolean>;
        const licenseFeatureAccess = Object.fromEntries(
          (storedLicense.featureAccess || []).map((rule) => [rule.id, rule.allowed !== false]),
        );
        set({
          config: { ...base, activeModule: nextActive },
          activeTabId: parsed.activeTabId || parsed.tabs[0]?.id || 'default',
          activeModule: nextActive,
          licensePolicy: storedPolicy,
          licenseModuleAccess,
          licenseFeatureAccess,
        });
      } catch {
        console.error('Failed to parse config');
      }
    }
    if (isElectron && window.electronAPI?.getOpenAtLogin) {
      try {
        const openOnStartup = await window.electronAPI.getOpenAtLogin();
        set((s) => ({ config: { ...s.config, openOnStartup } }));
      } catch {
        // Keep stored preference if the system setting cannot be read.
      }
    }
  },

  saveConfig: async () => {
    const { config, activeTabId } = get();
    const toSave = { ...config, activeTabId };
    if (isElectron) {
      await window.electronAPI!.writeConfig(JSON.stringify(toSave, null, 2));
    } else {
      localStore.set(toSave);
    }
  },

  setTheme: (theme) => {
    set((s) => {
      const newConfig = { ...s.config, theme };
      return { config: newConfig };
    });
    get().saveConfig();
  },

  setLocale: (locale) => {
    set((s) => {
      const newConfig = { ...s.config, locale };
      return { config: newConfig };
    });
    get().saveConfig();
  },

  setPanelAnimation: (animation) => {
    set((s) => {
      const newConfig = { ...s.config, panelAnimation: animation };
      return { config: newConfig };
    });
    get().saveConfig();
  },

  setOpenOnStartup: async (enabled) => {
    let finalValue = enabled;
    if (isElectron && window.electronAPI?.setOpenAtLogin) {
      finalValue = await window.electronAPI.setOpenAtLogin(enabled);
    }
    set((s) => {
      const newConfig = { ...s.config, openOnStartup: finalValue };
      return { config: newConfig };
    });
    await get().saveConfig();
    get().addToast(finalValue ? t('settings.startupEnabled', undefined, get().config.locale) : t('settings.startupDisabled', undefined, get().config.locale), 'success');
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId, searchQuery: '', selectedShortcutId: null });
    get().saveConfig();
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  setSelectedShortcut: (shortcutId) => set({ selectedShortcutId: shortcutId }),

  setActiveModule: (moduleId) => {
    const state = get();
    const available = getAvailableModuleIds(state.config);
    const usageEntry = state.config.modules.find((item) => item.id === 'usage');
    const usageManageOk = usageEntry?.enabled !== false && state.licenseModuleAccess['usage'] !== false;
    const target: ModuleId | null = moduleId === 'usageManage' && usageManageOk
      ? 'usageManage'
      : available.includes(moduleId) && state.licenseModuleAccess[moduleId] !== false
        ? moduleId
        : null;
    if (!target) {
      // 无权限板块：保留入口展示，点击仅提示并停留当前板块
      if (moduleId !== 'usageManage' && available.includes(moduleId) && state.licenseModuleAccess[moduleId] === false) {
        get().addToast('该板块需要激活后可用', 'info');
        return;
      }
      const fallback = available.find((id) => state.licenseModuleAccess[id] !== false) || (state.licenseModuleAccess['shortcuts'] !== false ? 'shortcuts' : null);
      if (!fallback) return;
      if (moduleId !== 'usageManage') {
        get().addToast(state.licenseModuleAccess[moduleId] === false ? '该板块需要激活后可用' : '该板块不可用', 'info');
      }
      set((s) => ({
        activeModule: fallback,
        config: { ...s.config, activeModule: fallback },
        searchQuery: '',
        selectedShortcutId: null,
      }));
      get().saveConfig();
      return;
    }
    set((state) => ({
      activeModule: target,
      config: { ...state.config, activeModule: target },
      searchQuery: target === 'shortcuts' ? state.searchQuery : '',
      selectedShortcutId: null,
    }));
    get().saveConfig();
  },

  setLicenseAccess: (info) => {
      const policy = info.activationPolicy || 'none';
    const rules = new Map((info.moduleAccess || []).map((rule) => [rule.id, rule]));
    const access = Object.fromEntries(
      MODULE_REGISTRY.map((meta) => [
        meta.id,
        meta.id === 'activation'
          ? true
          : policy === 'none'
            ? true
            : rules.has(meta.id)
              ? rules.get(meta.id)!.allowed !== false
              : policy === 'all' ? false : true,
      ]),
    ) as Record<ModuleId, boolean>;
    const featureAccess = Object.fromEntries(
      (info.featureAccess || []).map((rule) => [rule.id, rule.allowed !== false]),
    );
    set((s) => {
      const available = getAvailableModuleIds(s.config).filter((id) => access[id] !== false);
      const activeIsValid = s.activeModule === 'usageManage'
        ? access['usage'] !== false
        : available.includes(s.activeModule);
      const nextActive = activeIsValid ? s.activeModule : (available[0] || 'shortcuts');
      const config = {
        ...s.config,
        license: {
          ...(s.config.license || {}),
          activationPolicy: policy,
          moduleAccess: info.moduleAccess || [],
          featureAccess: info.featureAccess || [],
          tier: info.tier,
          guestEnabled: info.guestEnabled,
          contactLine: info.contactLine,
          code: info.code !== undefined ? info.code : s.config.license?.code,
          status: info.status !== undefined ? info.status : s.config.license?.status,
          expiresAt: info.expiresAt !== undefined ? info.expiresAt : s.config.license?.expiresAt,
          message: info.message !== undefined ? info.message : s.config.license?.message,
        },
        activeModule: nextActive,
      };
      return {
        licensePolicy: policy,
        licenseModuleAccess: access,
        licenseFeatureAccess: featureAccess,
        config,
        activeModule: nextActive,
      };
    });
    get().saveConfig();
  },

  setModuleEnabled: (id, enabled) => {
    if (CORE_MODULE_IDS.includes(id) && !enabled) return;
    set((s) => {
      const modules = s.config.modules.map((item) => item.id === id ? { ...item, enabled } : item);
      const nextConfig = { ...s.config, modules };
      const available = getAvailableModuleIds(nextConfig).filter((itemId) => s.licenseModuleAccess[itemId] !== false);
      const invalidActive = s.activeModule === id || (id === 'usage' && s.activeModule === 'usageManage');
      const nextActive = invalidActive
        ? (available[0] || 'shortcuts')
        : s.activeModule === 'usageManage'
          ? (s.licenseModuleAccess['usage'] !== false ? 'usageManage' : (available[0] || 'shortcuts'))
          : s.activeModule;
      return {
        config: { ...nextConfig, activeModule: nextActive },
        activeModule: nextActive,
      };
    });
    get().saveConfig();
  },

  setModuleVisible: (id, visible) => {
    set((s) => {
      const modules = s.config.modules.map((item) => item.id === id ? { ...item, visible } : item);
      const nextConfig = { ...s.config, modules };
      const available = getAvailableModuleIds(nextConfig).filter((itemId) => s.licenseModuleAccess[itemId] !== false);
      const activeIsVisible = s.activeModule === 'usageManage'
        ? available.includes('usage') && s.licenseModuleAccess['usage'] !== false
        : available.includes(s.activeModule);
      const nextActive = activeIsVisible ? s.activeModule : (available[0] || 'shortcuts');
      return {
        config: { ...nextConfig, activeModule: nextActive },
        activeModule: nextActive,
      };
    });
    get().saveConfig();
  },

  setModuleOrder: (orderedIds) => {
    set((s) => ({
      config: { ...s.config, modules: reorderModuleConfig(s.config.modules, orderedIds) },
    }));
    get().saveConfig();
  },

  setModuleGroup: (id, group) => {
    set((s) => {
      const safe = group === 'primary' || group === 'more' ? group : 'more';
      const modules = s.config.modules.map((item) => item.id === id ? { ...item, group: safe } : item);
      return { config: { ...s.config, modules } };
    });
    get().saveConfig();
  },

  addSearchHistory: (query) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    set((state) => {
      const searchHistory = [trimmed, ...(state.config.searchHistory || []).filter((item) => item !== trimmed)].slice(0, 5);
      return { config: { ...state.config, searchHistory } };
    });
    get().saveConfig();
  },

  deleteSearchHistory: (query) => {
    set((state) => ({
      config: {
        ...state.config,
        searchHistory: (state.config.searchHistory || []).filter((item) => item !== query),
      },
    }));
    get().saveConfig();
  },

  addTaskBoard: (name) => {
    const now = new Date().toISOString();
    set((state) => {
      const board: TaskBoardConfig = {
        id: uuidv4(),
        name: (name || `任务墙 ${state.config.taskBoards.length + 1}`).trim(),
        notes: [],
        createdAt: now,
        updatedAt: now,
      };
      return {
        config: {
          ...state.config,
          taskBoards: [...state.config.taskBoards, board],
          activeTaskBoardId: board.id,
          activeModule: 'tasks',
          tasks: [],
        },
        activeModule: 'tasks',
      };
    });
    get().saveConfig();
  },

  renameTaskBoard: (boardId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    set((state) => ({
      config: {
        ...state.config,
        taskBoards: state.config.taskBoards.map((board) => board.id === boardId ? { ...board, name: trimmed, updatedAt: now } : board),
      },
    }));
    get().saveConfig();
  },

  deleteTaskBoard: (boardId) => {
    set((state) => {
      if (state.config.taskBoards.length <= 1) return state;
      const taskBoards = state.config.taskBoards.filter((board) => board.id !== boardId);
      const activeTaskBoardId = state.config.activeTaskBoardId === boardId ? taskBoards[0]?.id : state.config.activeTaskBoardId;
      return {
        config: {
          ...state.config,
          taskBoards,
          activeTaskBoardId,
          tasks: [],
          scTaskList: (state.config.scTaskList || []).filter((item) => item.boardId !== boardId),
        },
      };
    });
    get().saveConfig();
  },

  setActiveTaskBoard: (boardId) => {
    set((state) => ({ config: { ...state.config, activeTaskBoardId: boardId, tasks: [] } }));
    get().saveConfig();
  },

  setTaskEditorDraft: (draft) => {
    set((state) => ({
      config: {
        ...state.config,
        taskEditorDraft: draft || undefined,
      },
    }));
    if (taskEditorSaveTimer) clearTimeout(taskEditorSaveTimer);
    taskEditorSaveTimer = setTimeout(() => {
      taskEditorSaveTimer = null;
      void get().saveConfig();
    }, 200);
  },

  addTask: (text, options) => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const now = new Date().toISOString();
    const taskId = uuidv4();
    const tapes = ['#c0392b', '#e67e22', '#f39c12', '#27ae60', '#2980b9', '#8e44ad', '#e84393'];
    set((state) => ({
      config: updateActiveTaskBoard(state.config, (board) => {
        // 新便签恒在最上层；z 触顶时先归一化整墙（见 nextTaskZIndex）
        const { notes: normalized, zIndex } = nextTaskZIndex(board.notes);
        const task: TaskNote = {
          id: taskId,
          text: trimmed,
          longText: options?.longText || undefined,
          details: options?.longText ? (options.details?.trim() || '') : undefined,
          reminderAt: options?.reminderAt || undefined,
          done: false,
          x: 4 + Math.random() * 58,
          y: 5 + Math.random() * 52,
          rotation: Math.random() * 3.4 - 1.7,
          tape: tapes[Math.floor(Math.random() * tapes.length)],
          zIndex,
          createdAt: now,
          updatedAt: now,
        };
        return { ...board, notes: [task, ...normalized], updatedAt: now };
      }),
    }));
    get().saveConfig();
    return taskId;
  },

  updateTask: (taskId, updates) => {
    const now = new Date().toISOString();
    set((state) => ({
      config: updateActiveTaskBoard(state.config, (board) => ({
        ...board,
        notes: board.notes.map((task) => task.id === taskId ? { ...task, ...updates, updatedAt: now } : task),
        updatedAt: now,
      })),
    }));
    get().saveConfig();
  },

  markTaskReminded: (boardId, taskId) => {
    const now = new Date().toISOString();
    set((state) => ({
      config: {
        ...state.config,
        taskBoards: state.config.taskBoards.map((board) => board.id === boardId ? {
          ...board,
          notes: board.notes.map((task) => task.id === taskId ? { ...task, remindedAt: now, updatedAt: now } : task),
          updatedAt: now,
        } : board),
        tasks: [],
      },
    }));
    get().saveConfig();
  },
  toggleTask: (taskId) => {
    const now = new Date().toISOString();
    set((state) => ({
      config: updateActiveTaskBoard(state.config, (board) => ({
        ...board,
        notes: board.notes.map((task) => task.id === taskId ? { ...task, done: !task.done, updatedAt: now } : task),
        updatedAt: now,
      })),
    }));
    get().saveConfig();
  },

  deleteTask: (taskId) => {
    const now = new Date().toISOString();
    set((state) => ({
      config: {
        ...updateActiveTaskBoard(state.config, (board) => ({
          ...board,
          notes: board.notes.filter((task) => task.id !== taskId),
          updatedAt: now,
        })),
        scTaskList: (state.config.scTaskList || []).filter((item) => item.taskId !== taskId),
      },
    }));
    get().saveConfig();
  },

  moveTask: (taskId, x, y) => {
    const now = new Date().toISOString();
    set((state) => ({
      config: updateActiveTaskBoard(state.config, (board) => {
        // 刚拖过的便签置顶；z 触顶时先归一化整墙，保证"新/刚拖动在上层"语义不变而上限有界
        const { notes: normalized, zIndex } = nextTaskZIndex(board.notes);
        return {
          ...board,
          notes: normalized.map((task) => task.id === taskId ? { ...task, x, y, zIndex, updatedAt: now } : task),
          updatedAt: now,
        };
      }),
    }));
    get().saveConfig();
  },
  addTab: (name) => {
    const id = uuidv4();
    set((s) => {
      const tabs = [...s.config.tabs, { id, name, sort: s.config.tabs.length, groups: [] }];
      return { config: { ...s.config, tabs }, activeTabId: id };
    });
    get().saveConfig();
  },

  renameTab: (tabId, name) => {
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) => t.id === tabId ? { ...t, name } : t),
      },
    }));
    get().saveConfig();
  },

  deleteTab: (tabId) => {
    set((s) => {
      const tabs = s.config.tabs.filter((t) => t.id !== tabId);
      const newActive = s.activeTabId === tabId ? (tabs[0]?.id || '') : s.activeTabId;
      return { config: { ...s.config, tabs }, activeTabId: newActive };
    });
    get().saveConfig();
  },

  reorderTabs: (fromIdx, toIdx) => {
    set((s) => {
      const tabs = [...s.config.tabs];
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);
      tabs.forEach((t, i) => t.sort = i);
      return { config: { ...s.config, tabs } };
    });
    get().saveConfig();
  },

  addGroup: (tabId, name) => {
    const groupId = uuidv4();
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? { ...t, groups: [...t.groups, { id: groupId, name, collapsed: false, sort: t.groups.length, shortcuts: [] }] }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  renameGroup: (tabId, groupId, name) => {
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? { ...t, groups: t.groups.map((g) => g.id === groupId ? { ...g, name } : g) }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  deleteGroup: (tabId, groupId) => {
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? { ...t, groups: t.groups.filter((g) => g.id !== groupId) }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  toggleGroupCollapse: (tabId, groupId) => {
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? { ...t, groups: t.groups.map((g) => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g) }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  addShortcut: (tabId, groupId, data) => {
    const now = new Date().toISOString();
    const shortcut: Shortcut = {
      ...data,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      sort: 0,
    };
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                groups: t.groups.map((g) =>
                  g.id === groupId
                    ? { ...g, shortcuts: [...g.shortcuts, { ...shortcut, sort: g.shortcuts.length }] }
                    : g
                ),
              }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  addMultipleShortcuts: (tabId, groupId, shortcutsData) => {
    const now = new Date().toISOString();
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                groups: t.groups.map((g) => {
                  if (g.id !== groupId) return g;
                  const newShortcuts = shortcutsData.map((data, idx) => ({
                    ...data,
                    id: uuidv4(),
                    createdAt: now,
                    updatedAt: now,
                    sort: g.shortcuts.length + idx,
                  }));
                  return { ...g, shortcuts: [...g.shortcuts, ...newShortcuts] };
                }),
              }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  updateShortcut: (tabId, groupId, shortcutId, updates) => {
    const now = new Date().toISOString();
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                groups: t.groups.map((g) =>
                  g.id === groupId
                    ? { ...g, shortcuts: g.shortcuts.map((sc) => sc.id === shortcutId ? { ...sc, ...updates, updatedAt: now } : sc) }
                    : g
                ),
              }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  deleteShortcut: (tabId, groupId, shortcutId) => {
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                groups: t.groups.map((g) =>
                  g.id === groupId
                    ? { ...g, shortcuts: g.shortcuts.filter((sc) => sc.id !== shortcutId) }
                    : g
                ),
              }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  moveShortcut: (fromTabId, fromGroupId, toTabId, toGroupId, shortcutId, newIndex) => {
    set((s) => {
      let movedShortcut: Shortcut | null = null;
      const tabs = s.config.tabs.map((t) => {
        if (t.id === fromTabId) {
          return {
            ...t,
            groups: t.groups.map((g) => {
              if (g.id === fromGroupId) {
                movedShortcut = g.shortcuts.find((sc) => sc.id === shortcutId) || null;
                return { ...g, shortcuts: g.shortcuts.filter((sc) => sc.id !== shortcutId) };
              }
              return g;
            }),
          };
        }
        return t;
      });
      if (!movedShortcut) return {};
      const finalTabs = tabs.map((t) => {
        if (t.id === toTabId) {
          return {
            ...t,
            groups: t.groups.map((g) => {
              if (g.id === toGroupId) {
                const shortcuts = [...g.shortcuts];
                shortcuts.splice(newIndex, 0, movedShortcut!);
                shortcuts.forEach((sc, i) => sc.sort = i);
                return { ...g, shortcuts };
              }
              return g;
            }),
          };
        }
        return t;
      });
      return { config: { ...s.config, tabs: finalTabs } };
    });
    get().saveConfig();
  },

  reorderShortcuts: (tabId, groupId, fromIdx, toIdx) => {
    set((s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                groups: t.groups.map((g) => {
                  if (g.id !== groupId) return g;
                  const shortcuts = [...g.shortcuts];
                  const [moved] = shortcuts.splice(fromIdx, 1);
                  shortcuts.splice(toIdx, 0, moved);
                  shortcuts.forEach((sc, i) => sc.sort = i);
                  return { ...g, shortcuts };
                }),
              }
            : t
        ),
      },
    }));
    get().saveConfig();
  },

  openAddModal: (groupId, editing) => {
    set({ showAddModal: true, editingGroupId: groupId, editingShortcut: editing || null });
  },

  closeAddModal: () => {
    set({ showAddModal: false, editingShortcut: null, editingGroupId: null });
  },

  openSettings: () => set({ showSettings: true }),
  closeSettings: () => set({ showSettings: false }),

  openImportSoftware: () => set({ showImportSoftware: true }),
  closeImportSoftware: () => set({ showImportSoftware: false }),

  addToast: (message, type = 'info') => {
    const id = uuidv4();
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => get().removeToast(id), 3000);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  exportConfig: async () => {
    const { config, activeTabId } = get();
    const data = JSON.stringify({ ...config, activeTabId }, null, 2);
    if (isElectron) {
      const filePath = await window.electronAPI!.saveFile('shortcut-config.json');
      if (filePath) {
        const result = await window.electronAPI!.writeFile(filePath, data);
        if (result.success) {
          get().addToast('Export successful', 'success');
        } else {
          get().addToast('Export failed: ' + result.error, 'error');
        }
      }
    } else {
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shortcut-config.json';
      a.click();
      URL.revokeObjectURL(url);
      get().addToast('Export successful', 'success');
    }
  },

  importConfig: async () => {
    let raw = '';
    if (isElectron) {
      const filePath = await window.electronAPI!.openImportFile();
      if (!filePath) return;
      raw = (await window.electronAPI!.readFile(filePath)) || '';
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      const file = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files?.[0] || null);
        input.click();
      });
      if (!file) return;
      raw = await file.text();
    }
    try {
      const parsed = JSON.parse(raw) as AppConfig;
      if (!parsed.tabs || !Array.isArray(parsed.tabs)) throw new Error('Invalid format');
      set({ config: parsed, activeTabId: parsed.activeTabId || parsed.tabs[0]?.id || 'default' });
      get().saveConfig();
      get().addToast('Import successful', 'success');
    } catch (err: any) {
      get().addToast('Import failed: invalid config file', 'error');
    }
  },
}));
