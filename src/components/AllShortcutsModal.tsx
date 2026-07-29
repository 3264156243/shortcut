import { useMemo, useState } from 'react';
import { AppWindow, File, Folder, Globe, Layers3, Search, SquareTerminal, X } from 'lucide-react';
import { useStore } from '../store';
import { Shortcut, ShortcutType } from '../types';
import { executeShortcut } from '../utils/openShortcut';

const icons: Record<ShortcutType, typeof AppWindow> = { app: AppWindow, folder: Folder, file: File, url: Globe, group: Layers3, bat: SquareTerminal };
const labels: Record<ShortcutType, string> = { app: '程序', folder: '文件夹', file: '文件', url: '网页', group: '快捷方式组', bat: 'BAT 文件' };

export default function AllShortcutsModal({ onClose }: { onClose: () => void }) {
  const config = useStore((state) => state.config);
  const addToast = useStore((state) => state.addToast);
  const [query, setQuery] = useState('');
  const items = useMemo(() => config.tabs.flatMap((tab) => tab.groups.flatMap((group) => group.shortcuts.map((shortcut) => ({ shortcut, tab: tab.name, group: group.name }))))
    .filter(({ shortcut, tab, group }) => `${shortcut.name} ${shortcut.targetPath} ${tab} ${group}`.toLowerCase().includes(query.trim().toLowerCase())), [config.tabs, query]);
  const open = async (shortcut: Shortcut) => {
    const result = await executeShortcut(shortcut);
    addToast(result.success ? `已打开：${shortcut.name}` : `打开失败：${result.error || '未知错误'}`, result.success ? 'success' : 'error');
  };
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-5" style={{ background: 'var(--color-overlay)' }} onClick={onClose} data-all-shortcuts-modal>
      <section className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', boxShadow: '0 24px 70px var(--color-shadow)' }} onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b p-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="min-w-0 flex-1"><h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>全部快捷方式</h2><p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>共 {items.length} 项</p></div>
          <div className="flex w-64 items-center gap-2 rounded-md px-3 py-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><Search size={14} style={{ color: 'var(--color-text-muted)' }} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、位置或分组" className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--color-text)' }} /></div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md" title="关闭"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {items.length ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{items.map(({ shortcut, tab, group }) => { const Icon = icons[shortcut.type]; return <button key={shortcut.id} onClick={() => void open(shortcut)} className="flex min-w-0 items-center gap-3 rounded-md p-3 text-left transition-colors hover:bg-[var(--color-bg-card-hover)]" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>{shortcut.icon ? <img src={shortcut.icon} className="h-6 w-6 object-contain" alt="" /> : <Icon size={18} />}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium" style={{ color: 'var(--color-text)' }}>{shortcut.name}</div><div className="mt-1 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>{tab} / {group} · {labels[shortcut.type]}</div></div></button>; })}</div> : <div className="flex h-40 items-center justify-center text-sm" style={{ color: 'var(--color-text-muted)' }}>没有匹配的快捷方式</div>}
        </div>
      </section>
    </div>
  );
}