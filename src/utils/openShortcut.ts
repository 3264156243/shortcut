import { Shortcut, ShortcutTarget } from '../types';

const hasUrlScheme = (value: string) => /^https?:\/\//i.test(value.trim());
const normalizeUrl = (value: string) => hasUrlScheme(value) ? value.trim() : `https://${value.trim()}`;

async function openTarget(target: Pick<ShortcutTarget, 'type' | 'targetPath'>) {
  const api = window.electronAPI;
  if (!api) {
    if (target.type === 'url') window.open(normalizeUrl(target.targetPath), '_blank');
    return { success: target.type === 'url', error: target.type === 'url' ? undefined : 'Electron API unavailable' };
  }
  return target.type === 'url'
    ? api.openExternal(normalizeUrl(target.targetPath))
    : api.openTarget(target.targetPath);
}

export async function executeShortcut(shortcut: Shortcut) {
  if (shortcut.type === 'bat') {
    if (!window.electronAPI?.runBat) return { success: false, error: 'BAT runner unavailable' };
    return window.electronAPI.runBat(shortcut.batContent || '', !!shortcut.runAsAdmin);
  }
  if (shortcut.type === 'group') {
    const targets = shortcut.targets || [];
    if (!targets.length) return { success: false, error: '快捷方式组为空' };
    const results = [];
    for (const target of targets) {
      results.push(await openTarget(target));
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    const failed = results.find((result) => !result.success);
    return failed || { success: true };
  }
  return openTarget({ type: shortcut.type as ShortcutTarget['type'], targetPath: shortcut.targetPath });
}