import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppConfig, DEFAULT_CONFIG, Tab, Group, Shortcut, Locale, PanelAnimation, ModuleId, TaskNote, TaskBoardConfig, TaskEditorDraft, UpdateState, IslandPreferences } from '../types';
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

  // Actions
  loadConfig: () => Promise<void>;
  saveConfig: () => Promise<void>;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setLocale: (locale: Locale) => void;
  setPanelAnimation: (animation: PanelAnimation) => void;
  setOpenOnStartup: (enabled: boolean) => Promise<void>;
  setActiveTab: (tabId: string) => void;
  setSearchQuery: (q: string) => void;
  setSelectedShortcut: (shortcutId: string | null) => void;
  setActiveModule: (moduleId: ModuleId) => void;
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
      getOpenAtLogin: () => Promise<boolean>;
      setOpenAtLogin: (enabled: boolean) => Promise<boolean>;
      setAdminMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
      getInstalledSoftware: () => Promise<Array<{ name: string; path: string; icon: string }>>;
      getFileInfo: (filePath: string) => Promise<{ name: string; path: string; type: 'app' | 'folder' | 'file' } | null>;
      getFileIcon: (filePath: string) => Promise<string | null>;
      getFileIcons: (filePaths: string[]) => Promise<Record<string, string | null>>;
      getWebsiteIcon: (url: string) => Promise<string | null>;
      translateText: (text: string, from: string, to: string) => Promise<{ success: boolean; translatedText?: string; from?: string; to?: string; error?: string }>;
      startCockpit: () => Promise<{ success: boolean; error?: string }>;
      stopCockpit: () => Promise<boolean>;
      onCockpitData: (callback: (data: unknown) => void) => () => void;
      showNotification: (title: string, body: string) => Promise<boolean>;
      checkForUpdates: () => Promise<{ success: boolean; status: string; error?: string }>;
      downloadUpdate: () => Promise<{ success: boolean; status: string; error?: string }>;
      getUpdateState: () => Promise<UpdateState>;
      installUpdate: () => Promise<boolean>;
      onUpdateState: (callback: (state: UpdateState) => void) => () => void;
      getTheme: () => Promise<'dark' | 'light'>;
      getIslandState: () => Promise<{ enabled: boolean; style: string; position: string; autoHideFullscreen: boolean; musicEnabled?: boolean }>;
      setIsland: (enabled: boolean, style: string, position: string, autoHideFullscreen: boolean, musicEnabled: boolean, lyricBounce: boolean, displayState: string, orbitGlow: boolean, barsEnabled: boolean, tasksEnabled: boolean, cockpitEnabled: boolean, dailyQuoteEnabled: boolean) => Promise<{ success: boolean; error?: string }>;
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
      getDailyQuote: () => Promise<unknown>;
      refreshDailyQuote: () => Promise<unknown>;
      copyText: (text: string) => Promise<unknown>;
      controlMusic: (action: string) => Promise<unknown>;
      seekMusic: (ms: number) => Promise<unknown>;
      onIslandMusic: (callback: (state: unknown) => void) => () => void;
      onIslandCockpit: (callback: (data: unknown) => void) => () => void;
      closeWindow: () => Promise<void>;
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

const nextTaskZIndex = (notes: TaskNote[]) => notes.reduce((max, note) => Math.max(max, note.zIndex || 0), 0) + 1;

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
        set({
          config: { ...DEFAULT_CONFIG, ...parsed, island, scTaskList: parsed.scTaskList || [], locale: 'zh-CN', searchHistory: parsed.searchHistory || [], activeModule: parsed.activeModule || 'shortcuts', ...normalizeTaskBoards(parsed) },
          activeTabId: parsed.activeTabId || parsed.tabs[0]?.id || 'default',
          activeModule: parsed.activeModule || 'shortcuts',
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
    set((state) => ({
      activeModule: moduleId,
      config: { ...state.config, activeModule: moduleId },
      searchQuery: moduleId === 'shortcuts' ? state.searchQuery : '',
      selectedShortcutId: null,
    }));
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
          zIndex: nextTaskZIndex(board.notes),
          createdAt: now,
          updatedAt: now,
        };
        return { ...board, notes: [task, ...board.notes], updatedAt: now };
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
        const zIndex = nextTaskZIndex(board.notes);
        return {
          ...board,
          notes: board.notes.map((task) => task.id === taskId ? { ...task, x, y, zIndex, updatedAt: now } : task),
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

