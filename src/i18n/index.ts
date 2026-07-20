export type Locale = 'zh-CN' | 'en';

export interface I18nConfig {
  locale: Locale;
}

export const DEFAULT_LOCALE: Locale = 'zh-CN';

// Translation strings
export const translations: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    // App
    'app.title': 'ShortCut',
    'app.subtitle': '快捷面板',

    // TopBar
    'search.placeholder': '搜索快捷方式...',
    'search.noResults': '未找到结果',
    'search.noResultsDesc': '没有匹配 "{query}" 的快捷方式',
    'search.switchTab': '切换',
    'add.button': '添加快捷方式',
    'settings.button': '设置',

    // TabBar
    'tab.add': '添加页签',
    'tab.default': '通用',

    // PanelBody
    'panel.empty.title': '还没有快捷方式',
    'panel.empty.desc': '点击 + 按钮添加你的第一个快捷方式',
    'panel.addGroup': '添加分组',

    // GroupSection
    'group.add': '添加到分组',
    'group.rename': '重命名分组',
    'group.delete': '删除分组',
    'group.default': '收藏',

    // ShortcutCard
    'shortcut.open': '打开',
    'shortcut.edit': '编辑',
    'shortcut.delete': '删除',
    'shortcut.deleteTitle': '确认删除',
    'shortcut.deleteMessage': '确定要删除 "{name}" 吗？',
    'shortcut.deleteCancel': '取消',
    'shortcut.deleteConfirm': '确认删除',
    'shortcut.copyPath': '复制路径',
    'shortcut.pathCopied': '路径已复制',
    'shortcut.showInFolder': '在文件管理器打开',
    'shortcut.missing': '目标丢失',
    'shortcut.opened': '已打开 {name}',
    'shortcut.openFailed': '打开失败: {error}',

    // AddShortcutModal
    'modal.add.title': '添加快捷方式',
    'modal.edit.title': '编辑快捷方式',
    'modal.type.app': '应用',
    'modal.type.folder': '文件夹',
    'modal.type.file': '文件',
    'modal.type.url': '网址',
    'modal.name': '名称',
    'modal.namePlaceholder': '我的快捷方式',
    'modal.path': '路径',
    'modal.url': '网址',
    'modal.pathPlaceholder': 'C:\\路径\\到\\目标',
    'modal.urlPlaceholder': 'https://example.com',
    'modal.remark': '备注（可选）',
    'modal.remarkPlaceholder': '可选的描述...',
    'modal.browse': '浏览',
    'modal.cancel': '取消',
    'modal.add': '添加快捷方式',
    'modal.save': '保存修改',
    'modal.added': '快捷方式已添加',
    'modal.updated': '快捷方式已更新',
    'modal.error.nameRequired': '名称和目标为必填项',
    'modal.error.noGroup': '未选择分组',

    // SettingsPanel
    'settings.title': '设置',
    'settings.theme': '主题',
    'settings.theme.dark': '深色',
    'settings.theme.light': '浅色',
    'settings.theme.system': '跟随系统',
    'settings.hotkey': '全局快捷键',
    'settings.behavior': '行为',
    'settings.closeOnBlur': '失焦时关闭',
    'settings.rememberSize': '记住窗口大小',
    'settings.language': '语言',
    'settings.language.zhCN': '简体中文',
    'settings.language.en': 'English',
    'settings.animation': '弹出动效',
    'settings.animation.bottom': '从下方弹出',
    'settings.animation.top': '从上方弹出',
    'settings.animation.left': '从左侧弹出',
    'settings.animation.right': '从右侧弹出',
    'settings.animation.center': '中心缩放',
    'settings.data': '数据',
    'settings.export': '导出配置',
    'settings.import': '导入配置',
    'settings.exportSuccess': '导出成功',
    'settings.exportFailed': '导出失败',
    'settings.importSuccess': '导入成功',
    'settings.importFailed': '导入失败：配置文件格式无效',
    'settings.version': 'ShortCut v1.0.0',

    // Tray
    'tray.showHide': '显示/隐藏',
    'tray.quit': '退出',

    // Common
    'common.success': '成功',
    'common.error': '错误',
    'common.info': '信息',

    // Import Software
    'import.title': '从已安装软件导入',
    'import.search': '搜索软件...',
    'import.loading': '正在加载已安装软件...',
    'import.empty': '未找到已安装软件',
    'import.selected': '已选择 {count} 个',
    'import.confirm': '导入选中',
    'import.cancel': '取消',
    'import.success': '成功导入 {count} 个软件',
    'import.toGroup': '导入到分组',
  },
  'en': {
    // App
    'app.title': 'ShortCut',
    'app.subtitle': 'Quick Panel',

    // TopBar
    'search.placeholder': 'Search shortcuts...',
    'search.noResults': 'No results found',
    'search.noResultsDesc': 'No shortcuts match "{query}"',
    'search.switchTab': 'Switch',
    'add.button': 'Add Shortcut',
    'settings.button': 'Settings',

    // TabBar
    'tab.add': 'Add Tab',
    'tab.default': 'General',

    // PanelBody
    'panel.empty.title': 'No shortcuts yet',
    'panel.empty.desc': 'Click the + button to add your first shortcut',
    'panel.addGroup': 'Add Group',

    // GroupSection
    'group.add': 'Add to group',
    'group.rename': 'Rename group',
    'group.delete': 'Delete group',
    'group.default': 'Favorites',

    // ShortcutCard
    'shortcut.open': 'Open',
    'shortcut.edit': 'Edit',
    'shortcut.delete': 'Delete',
    'shortcut.deleteTitle': 'Confirm Delete',
    'shortcut.deleteMessage': 'Are you sure you want to delete "{name}"?',
    'shortcut.deleteCancel': 'Cancel',
    'shortcut.deleteConfirm': 'Delete',
    'shortcut.copyPath': 'Copy Path',
    'shortcut.pathCopied': 'Path copied',
    'shortcut.showInFolder': 'Show in File Explorer',
    'shortcut.missing': 'Target missing',
    'shortcut.opened': 'Opened {name}',
    'shortcut.openFailed': 'Failed: {error}',

    // AddShortcutModal
    'modal.add.title': 'Add Shortcut',
    'modal.edit.title': 'Edit Shortcut',
    'modal.type.app': 'Application',
    'modal.type.folder': 'Folder',
    'modal.type.file': 'File',
    'modal.type.url': 'URL',
    'modal.name': 'Name',
    'modal.namePlaceholder': 'My shortcut',
    'modal.path': 'Path',
    'modal.url': 'URL',
    'modal.pathPlaceholder': 'C:\\path\\to\\target',
    'modal.urlPlaceholder': 'https://example.com',
    'modal.remark': 'Remark (optional)',
    'modal.remarkPlaceholder': 'Optional description...',
    'modal.browse': 'Browse',
    'modal.cancel': 'Cancel',
    'modal.add': 'Add Shortcut',
    'modal.save': 'Save Changes',
    'modal.added': 'Shortcut added',
    'modal.updated': 'Shortcut updated',
    'modal.error.nameRequired': 'Name and target are required',
    'modal.error.noGroup': 'No group selected',

    // SettingsPanel
    'settings.title': 'Settings',
    'settings.theme': 'Theme',
    'settings.theme.dark': 'Dark',
    'settings.theme.light': 'Light',
    'settings.theme.system': 'System',
    'settings.hotkey': 'Global Hotkey',
    'settings.behavior': 'Behavior',
    'settings.closeOnBlur': 'Close on blur',
    'settings.rememberSize': 'Remember window size',
    'settings.language': 'Language',
    'settings.language.zhCN': '简体中文',
    'settings.language.en': 'English',
    'settings.animation': 'Panel Animation',
    'settings.animation.bottom': 'Slide from Bottom',
    'settings.animation.top': 'Slide from Top',
    'settings.animation.left': 'Slide from Left',
    'settings.animation.right': 'Slide from Right',
    'settings.animation.center': 'Scale from Center',
    'settings.data': 'Data',
    'settings.export': 'Export Config',
    'settings.import': 'Import Config',
    'settings.exportSuccess': 'Export successful',
    'settings.exportFailed': 'Export failed',
    'settings.importSuccess': 'Import successful',
    'settings.importFailed': 'Import failed: invalid config file',
    'settings.version': 'ShortCut v1.0.0',

    // Tray
    'tray.showHide': 'Show/Hide',
    'tray.quit': 'Quit',

    // Common
    'common.success': 'Success',
    'common.error': 'Error',
    'common.info': 'Info',

    // Import Software
    'import.title': 'Import from Installed Software',
    'import.search': 'Search software...',
    'import.loading': 'Loading installed software...',
    'import.empty': 'No installed software found',
    'import.selected': '{count} selected',
    'import.confirm': 'Import Selected',
    'import.cancel': 'Cancel',
    'import.success': 'Successfully imported {count} software',
    'import.toGroup': 'Import to group',
  },
};

// Get translation with optional interpolation
export function t(key: string, params?: Record<string, string>, locale: Locale = DEFAULT_LOCALE): string {
  let text = translations[locale]?.[key] || translations['en']?.[key] || key;
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, v);
    });
  }
  return text;
}
