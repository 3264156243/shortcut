export type ShortcutType = 'app' | 'folder' | 'file' | 'url';
export type Locale = 'zh-CN' | 'en';
export type PanelAnimation = 'bottom' | 'top' | 'left' | 'right' | 'center';

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
