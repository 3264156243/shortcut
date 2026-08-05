export type ShortcutType = 'app' | 'folder' | 'file' | 'url' | 'group' | 'bat';
export type ShortcutTargetType = 'app' | 'folder' | 'file' | 'url';

export interface ShortcutTarget {
  id: string;
  name: string;
  type: ShortcutTargetType;
  targetPath: string;
}
export type Locale = 'zh-CN';
export type PanelAnimation = 'bottom' | 'top' | 'left' | 'right' | 'center';
export type IslandStyle = 'capsule' | 'glass' | 'paper';
export type IslandPosition = 'top-center' | 'top-left' | 'top-right' | 'left-center' | 'right-center';
export type IslandDisplayState = 'collapsed' | 'mini' | 'expanded';

export interface IslandPreferences {
  enabled: boolean;
  style: IslandStyle;
  position: IslandPosition;
  autoHideFullscreen: boolean;
  musicEnabled?: boolean;
  lyricBounce?: boolean;
  orbitGlow?: boolean;
  barsEnabled?: boolean;
  displayState?: IslandDisplayState;
  x?: number;
  y?: number;
  displayId?: number;
}

export interface MusicState {
  available: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  songId?: number | string | null;
  lyrics?: string | null;
  coverUrl?: string | null;
  isPlaying?: boolean;
  positionMs?: number;
  durationMs?: number;
}

export type ModuleId = 'shortcuts' | 'tasks' | 'cockpit' | 'translate' | 'island';

export interface CockpitData {
  timestamp?: number;
  error?: string;
  cpu?: { name?: string; temperature?: number | null; usage?: number | null };
  gpu?: { name?: string; temperature?: number | null; usage?: number | null };
  memory?: { name?: string; temperature?: number | null; usage?: number | null };
  battery?: { level?: number | null; status?: string; voltage?: number | null; health?: number | null };
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unconfigured';

export interface UpdateState {
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
}

export interface Shortcut {
  id: string;
  name: string;
  type: ShortcutType;
  targetPath: string;
  targets?: ShortcutTarget[];
  batContent?: string;
  runAsAdmin?: boolean;
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

export interface TaskEditorDraft {
  boardId: string;
  taskId: string | null;
  title: string;
  longText: boolean;
  details: string;
  reminderEnabled: boolean;
  reminderAt: string;
  originalReminderAt?: string;
  originalRemindedAt?: string;
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
  taskEditorDraft?: TaskEditorDraft;
  tabs: Tab[];
  activeTabId?: string;
  island?: IslandPreferences;
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
