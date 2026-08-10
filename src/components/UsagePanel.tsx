import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWindow, BarChart3, Globe, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import type { UsageData, UsageEntry } from '../types';
import EmptyState from './EmptyState';

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} 秒`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
}

function EntryRow({ entry, total, view }: { entry: UsageEntry; total: number; view: 'apps' | 'sites' }) {
  const ratio = total > 0 ? Math.min(100, (entry.seconds / total) * 100) : 0;
  const icon = view === 'apps'
    ? (entry.icon ? <img src={entry.icon} alt="" className="h-5 w-5 object-contain" draggable={false} /> : <AppWindow size={18} />)
    : <Globe size={18} />;
  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-lg px-4 py-3 transition-colors duration-150"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-secondary)' }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium" style={{ color: 'var(--color-text)' }}>{entry.name}</span>
          <span className="shrink-0 text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>{formatDuration(entry.seconds)}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-card-hover)' }}>
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${ratio}%`, background: view === 'apps' ? 'var(--color-accent)' : '#3b82f6' }}
            />
          </div>
          <span className="shrink-0 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{ratio.toFixed(0)}% · {entry.count} 次</span>
        </div>
      </div>
    </div>
  );
}

export default function UsagePanel() {
  const addToast = useStore((state) => state.addToast);
  const [data, setData] = useState<UsageData | null>(null);
  const [view, setView] = useState<'apps' | 'sites'>('apps');
  const [ignoreInput, setIgnoreInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI?.getUsageData?.();
      if (next) setData(next as UsageData);
    } catch {}
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const toggleView = () => setView((current) => current === 'apps' ? 'sites' : 'apps');
    window.addEventListener('usage:toggle-view', toggleView);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('usage:toggle-view', toggleView);
    };
  }, [refresh]);

  const entries = useMemo(() => {
    const list = data?.today?.[view] || [];
    return [...list].sort((a, b) => b.seconds - a.seconds);
  }, [data, view]);

  const totalSeconds = useMemo(() => entries.reduce((sum, entry) => sum + entry.seconds, 0), [entries]);
  const enabled = data?.enabled !== false;

  const toggleEnabled = async () => {
    if (!data) return;
    const next = await window.electronAPI?.setUsageEnabled?.(!enabled);
    if (next) setData(next as UsageData);
    addToast(enabled ? '已暂停使用记录' : '已恢复使用记录', 'success');
  };

  const clearAll = async () => {
    const next = await window.electronAPI?.clearUsageData?.();
    if (next) setData(next as UsageData);
    setConfirmClear(false);
    addToast('使用记录已清空', 'success');
  };

  const addIgnore = async () => {
    const key = ignoreInput.trim().toLowerCase();
    if (!key) return;
    const next = await window.electronAPI?.addUsageIgnored?.(key);
    if (next) setData(next as UsageData);
    setIgnoreInput('');
    addToast(`已忽略 ${key}`, 'success');
  };

  const removeIgnore = async (key: string) => {
    const next = await window.electronAPI?.removeUsageIgnored?.(key);
    if (next) setData(next as UsageData);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-5 py-4">
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ background: 'var(--color-accent)', color: '#fff', boxShadow: '0 4px 14px var(--color-accent-glow)' }}
          >
            <BarChart3 size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>应用使用记录</h1>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              {data?.today?.date || '--'} · 今日 {formatDuration(totalSeconds)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggleEnabled()}
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-all duration-150 hover:opacity-85"
          style={{
            background: enabled ? 'var(--color-bg-card)' : 'var(--color-accent)',
            border: '1px solid ' + (enabled ? 'var(--color-border)' : 'var(--color-accent)'),
            color: enabled ? 'var(--color-text-secondary)' : '#fff',
          }}
          title={enabled ? '暂停记录' : '恢复记录'}
        >
          {enabled ? <Pause size={14} /> : <Play size={14} />}
          <span>{enabled ? '记录中' : '已暂停'}</span>
        </button>
      </div>

      <div className="mb-3 flex shrink-0 items-center gap-2">
        <div className="flex rounded-lg p-1" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
          {(['apps', 'sites'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              className="h-8 rounded-md px-4 text-xs font-medium transition-all duration-150"
              style={{
                background: view === item ? 'var(--color-accent)' : 'transparent',
                color: view === item ? '#fff' : 'var(--color-text-secondary)',
              }}
            >
              {item === 'apps' ? '程序' : '网站'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (confirmClear) void clearAll();
            else {
              setConfirmClear(true);
              window.setTimeout(() => setConfirmClear(false), 3000);
            }
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition-all duration-150 hover:opacity-85"
          style={{
            background: confirmClear ? '#e5484d' : 'var(--color-bg-card)',
            border: '1px solid ' + (confirmClear ? '#e5484d' : 'var(--color-border)'),
            color: confirmClear ? '#fff' : 'var(--color-text-secondary)',
          }}
        >
          <Trash2 size={13} />
          <span>{confirmClear ? '确认清空' : '清空记录'}</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {entries.length === 0 ? (
          <EmptyState
            icon={view === 'apps' ? 'shortcut' : 'search'}
            title={view === 'apps' ? '还没有程序记录' : '还没有网站记录'}
            description={enabled ? '程序运行后会在这里累计时长' : '当前记录已暂停，恢复后继续累计'}
          />
        ) : entries.map((entry) => (
          <EntryRow key={entry.key} entry={entry} total={totalSeconds} view={view} />
        ))}
      </div>

      <div className="mt-4 shrink-0">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>忽略名单</span>
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>输入进程名或网站域名</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(data?.ignored || []).map((key) => (
            <span
              key={key}
              className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              {key}
              <button type="button" onClick={() => void removeIgnore(key)} className="opacity-60 transition-opacity hover:opacity-100" title="移除忽略">
                <X size={12} />
              </button>
            </span>
          ))}
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <input
              value={ignoreInput}
              onChange={(event) => setIgnoreInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addIgnore();
                }
              }}
              placeholder={view === 'apps' ? '例如 steam.exe' : '例如 bilibili.com'}
              className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
              style={{ color: 'var(--color-text)' }}
            />
            <button type="button" onClick={() => void addIgnore()} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-80" style={{ color: 'var(--color-accent)' }} title="添加忽略">
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
