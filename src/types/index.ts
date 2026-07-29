export type ShortcutType = 'app' | 'folder' | 'file' | 'url';
export type Locale = 'zh-CN' | 'en';
export type PanelAnimation = 'bottom' | 'top' | 'left' | 'right' | 'center';
export type ModuleId = 'shortcuts' | 'tasks';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unconfigured';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  version?: string;
  progress?: number;
  error?: string;
  manual?: boolean;
}

export interface Shortcut {
  id: string;
  name: string;
  type: ShortcutType;
  targetPath: string;
  icon?: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
  sort: number;
  missing?: boolean;
}

export interface Group {
  id: string;
  name: string;
  collapsed: boolean;
  sort: number;
  shortcuts: Shortcut[];
}

export interface Tab {
  id: string;
  name: string;
  sort: number;
  groups: Group[];
}

export interface TaskNote {
  id: string;
  text: string;
  longText?: boolean;
  details?: string;
  reminderAt?: string;
  remindedAt?: string;
  done: boolean;
  x: number;
  y: number;
  rotation: number;
  tape: string;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskBoardConfig {
  id: string;
  name: string;
  notes: TaskNote[];
  createdAt: string;
  updatedAt: string;
}

export interface AppConfig {
  version: number;
  theme: 'dark' | 'light' | 'system';
  locale: Locale;
  panelAnimation: PanelAnimation;
  globalHotkey: string;
  openOnStartup: boolean;
  rememberWindowSize: boolean;
  closeOnBlur: boolean;
  searchHistory: string[];
  activeModule: ModuleId;
  tasks: TaskNote[];
  taskBoards: TaskBoardConfig[];
  activeTaskBoardId?: string;
  tabs: Tab[];
  activeTabId?: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  locale: 'zh-CN',
  panelAnimation: 'bottom',
  globalHotkey: 'Alt+Space',
  openOnStartup: false,
  rememberWindowSize: true,
  closeOnBlur: true,
  searchHistory: [],
  activeModule: 'shortcuts',
  tasks: [],
  taskBoards: [
    {
      id: 'default-task-board',
      name: '默认任务墙',
      notes: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  activeTaskBoardId: 'default-task-board',
  tabs: [
    {
      id: 'default',
      name: '通用',
      sort: 0,
      groups: [
        {
          id: 'default-group',
          name: '收藏',
          collapsed: false,
          sort: 0,
          shortcuts: [],
        },
      ],
    },
  ],
  activeTabId: 'default',
};

