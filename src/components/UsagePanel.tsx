import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWindow, BarChart3, Globe, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import type { UsageData, UsageEntry } from '../types';
import EmptyState from './EmptyState';

const FALLBACK_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function fallbackColor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

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
  const color = view === 'apps' ? fallbackColor(entry.key) : '#3b82f6';
  const realIcon = view === 'apps' && entry.icon ? (
    <img src={entry.icon} alt="" className="h-6 w-6 object-contain" draggable={false} />
  ) : view === 'sites' ? (
    <Globe size={20} />
  ) : null;

  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 2px 10px rgba(0,0,0,.12)',
      }}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        style={{
          background: realIcon ? 'var(--color-bg-card-hover)' : `linear-gradient(135deg, ${color}30, ${color}18)`,
          border: `1px solid ${color}35`,
          color,
        }}
      >
        {realIcon || <span className="text-sm font-bold">{entry.name.slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium" style={{ color: 'var(--color-text)' }}>{entry.name}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{formatDuration(entry.seconds)}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-card-hover)' }}>
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${ratio}%`, background: color }} />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{entry.count} 次 · {ratio.toFixed(0)}%</span>
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

  const appSeconds = useMemo(() => (data?.today?.apps || []).reduce((sum, entry) => sum + entry.seconds, 0), [data]);
  const siteSeconds = useMemo(() => (data?.today?.sites || []).reduce((sum, entry) => sum + entry.seconds, 0), [data]);
  const totalSeconds = appSeconds + siteSeconds;
  const appPercent = totalSeconds > 0 ? (appSeconds / totalSeconds) * 100 : 0;

  const entries = useMemo(() => {
    const list = data?.today?.[view] || [];
    return [...list].sort((a, b) => b.seconds - a.seconds);
  }, [data, view]);

  const viewTotal = useMemo(() => entries.reduce((sum, entry) => sum + entry.seconds, 0), [entries]);
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
      <div
        className="mb-4 flex shrink-0 flex-wrap items-center gap-5 rounded-xl px-5 py-4"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', boxShadow: '0 4px 18px rgba(0,0,0,.14)' }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
            {data?.today?.date || '--'} · {enabled ? '记录中' : '已暂停'}
          </div>
          <div className="mt-1 text-4xl font-bold tabular-nums" style={{ color: 'var(--color-text)', letterSpacing: 0 }}>
            {formatDuration(totalSeconds)}
          </div>
          <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>今日总使用</div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0 rounded-full" style={{ background: `conic-gradient(#6366f1 0% ${appPercent}%, #3b82f6 ${appPercent}% 100%)` }}>
            <div className="absolute inset-[7px] rounded-full" style={{ background: 'var(--color-bg-card)' }} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{appPercent.toFixed(0)}%</span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>程序</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: '#6366f1' }} />
              <span style={{ color: 'var(--color-text-secondary)' }}>程序 {formatDuration(appSeconds)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: '#3b82f6' }} />
              <span style={{ color: 'var(--color-text-secondary)' }}>网站 {formatDuration(siteSeconds)}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void toggleEnabled()}
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-all duration-150 hover:opacity-85"
          style={{
            background: enabled ? 'var(--color-bg-card-hover)' : 'var(--color-accent)',
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
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{view === 'apps' ? '按程序统计' : '按网站统计'}</span>
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
          <EntryRow key={entry.key} entry={entry} total={viewTotal} view={view} />
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
