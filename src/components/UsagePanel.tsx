import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWindow, BarChart3, ChevronLeft, ChevronRight, Globe, Monitor, Pause, Play, Plus, Trash2, X } from 'lucide-react';
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

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateKey: string, offset: number) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function UsageDonut({ appPercent, totalSeconds }: { appPercent: number; totalSeconds: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const gap = circumference * 4 / 360;
  const appLength = Math.max(0, circumference * appPercent / 100 - gap);
  const siteLength = totalSeconds > 0 ? Math.max(0, circumference * (100 - appPercent) / 100 - gap) : 0;

  return (
    <svg viewBox="0 0 112 112" className="block h-full w-full" role="img">
      <circle cx="56" cy="56" r={radius} fill="none" stroke="var(--color-bg-card-hover)" strokeWidth="16" />
      {totalSeconds > 0 && appLength > 0 ? (
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke="#6366f1"
          strokeDasharray={`${appLength} ${circumference - appLength}`}
          strokeDashoffset={-circumference / 4}
          strokeWidth="16"
          transform="rotate(-90 56 56)"
          strokeLinecap="round"
        />
      ) : null}
      {totalSeconds > 0 && siteLength > 0 ? (
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke="#3b82f6"
          strokeDasharray={`${siteLength} ${circumference - siteLength}`}
          strokeDashoffset={-circumference / 4 - appLength}
          strokeWidth="16"
          transform="rotate(-90 56 56)"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function HourlyBars({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-end gap-[3px]">
        {hourly.map((value, hour) => {
          const height = value > 0 ? Math.max(8, (value / max) * 100) : 2;
          return (
            <div
              key={hour}
              className="min-w-0 flex-1 rounded-t-sm transition-[height] duration-300"
              title={`${String(hour).padStart(2, '0')}:00 · ${formatDuration(value)}`}
              style={{
                height: `${height}%`,
                background: value > 0 ? 'linear-gradient(180deg, #6366f1, #8b5cf6)' : 'var(--color-bg-card-hover)',
              }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
        <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  );
}

function EntryRow({ entry, total, view }: { entry: UsageEntry; total: number; view: 'apps' | 'sites' }) {
  const ratio = total > 0 ? Math.min(100, (entry.seconds / total) * 100) : 0;
  const color = view === 'apps' ? fallbackColor(entry.key) : '#3b82f6';
  const realIcon = view === 'apps' && entry.icon ? (
    <img src={entry.icon} alt="" className="h-full w-full object-contain" draggable={false} />
  ) : view === 'sites' ? (
    <Globe size={20} />
  ) : null;

  return (
    <div
      className="flex items-center justify-between rounded-[10px] border px-3.5 py-3 transition-colors duration-150"
      style={{
        background: 'var(--color-bg-elevated, var(--color-bg-card))',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border p-2"
          style={{
            background: 'var(--color-bg-card-hover)',
            borderColor: `${color}35`,
            boxShadow: `0 0 0 2px ${color}22`,
            color,
          }}
        >
          {realIcon || <span className="text-xs font-bold">{entry.name.slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{entry.name}</div>
          <div className="mt-0.5 text-[10px] font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
            {ratio.toFixed(0)}% · {entry.count} 次
          </div>
        </div>
      </div>
      <div className="ml-4 shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{formatDuration(entry.seconds)}</div>
        <div className="mt-2 h-1.5 w-20 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-card-hover)' }}>
          <div className="h-full rounded-full" style={{ width: `${ratio}%`, background: color }} />
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
  const todayKey = localDateKey();
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [confirmDeleteDay, setConfirmDeleteDay] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI?.getUsageData?.(selectedDate);
      if (next) setData(next as UsageData);
    } catch {}
  }, [selectedDate]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const toggleView = () => setView((current) => current === 'apps' ? 'sites' : 'apps');
    setConfirmDeleteDay(false);
    window.addEventListener('usage:toggle-view', toggleView);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('usage:toggle-view', toggleView);
    };
  }, [refresh]);

  const appSeconds = useMemo(() => (data?.day?.apps || []).reduce((sum, entry) => sum + entry.seconds, 0), [data]);
  const siteSeconds = useMemo(() => (data?.day?.sites || []).reduce((sum, entry) => sum + entry.seconds, 0), [data]);
  const totalSeconds = appSeconds + siteSeconds;
  const appPercent = totalSeconds > 0 ? (appSeconds / totalSeconds) * 100 : 0;
  const hourly = useMemo(() => Array.isArray(data?.day?.hourly) ? data.day!.hourly : Array(24).fill(0), [data]);

  const entries = useMemo(() => {
    const list = data?.day?.[view] || [];
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

  const deleteDay = async () => {
    const next = await window.electronAPI?.deleteUsageDay?.(selectedDate);
    if (next) setData(next as UsageData);
    setConfirmDeleteDay(false);
    if (selectedDate !== todayKey) setSelectedDate(todayKey);
    addToast(`已删除 ${selectedDate} 的记录`, 'success');
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: 'var(--color-accent)', color: '#fff', boxShadow: '0 4px 14px var(--color-accent-glow)' }}
        >
          <BarChart3 size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>应用使用记录</div>
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: data?.current ? '#34d399' : 'var(--color-text-muted)' }}
            />
            <span className="truncate">
              {selectedDate === todayKey && data?.current
                ? `正在记录 ${data.current.name} · ${formatDuration(data.current.seconds)}`
                : `${selectedDate} · ${selectedDate === todayKey ? '未在计时' : '历史数据'}`}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggleEnabled()}
          className="flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-all duration-150 hover:opacity-85"
          style={{
            background: enabled ? 'var(--color-bg-card)' : 'var(--color-accent)',
            border: '1px solid ' + (enabled ? 'var(--color-border)' : 'var(--color-accent)'),
            color: enabled ? 'var(--color-text-secondary)' : '#fff',
          }}
        >
          {enabled ? <Pause size={13} /> : <Play size={13} />}
          <span>{enabled ? '记录中' : '已暂停'}</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-4 pt-4">
        <div className="flex w-2/5 min-w-[230px] min-h-0 flex-col gap-4">
          <div className="shrink-0 rounded-xl p-5" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', boxShadow: '0 4px 18px rgba(0,0,0,.14)' }}>
            <div className="mb-4 flex items-center gap-2">
              <Monitor size={15} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>占比</h3>
              <div className="flex-1" />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedDate(addDays(selectedDate, -1))}
                  className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:opacity-80"
                  style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-card-hover)' }}
                  title="前一天"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="min-w-[76px] text-center text-[11px] font-medium tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                  {selectedDate}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDate(addDays(selectedDate, 1))}
                  disabled={selectedDate >= todayKey}
                  className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:opacity-80 disabled:opacity-30"
                  style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-card-hover)' }}
                  title="后一天"
                >
                  <ChevronRight size={14} />
                </button>
                {selectedDate !== todayKey ? (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(todayKey)}
                    className="ml-1 h-6 rounded-md px-2 text-[11px] font-medium transition-colors hover:opacity-80"
                    style={{ color: 'var(--color-accent)', background: 'var(--color-bg-card-hover)' }}
                  >
                    今天
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirmDeleteDay) void deleteDay();
                  else {
                    setConfirmDeleteDay(true);
                    window.setTimeout(() => setConfirmDeleteDay(false), 3000);
                  }
                }}
                className="ml-2 flex h-6 items-center gap-1 rounded-md px-2 text-[11px] transition-colors hover:opacity-80"
                style={{
                  background: confirmDeleteDay ? '#e5484d' : 'var(--color-bg-card-hover)',
                  color: confirmDeleteDay ? '#fff' : 'var(--color-text-secondary)',
                }}
                title="删除这一天"
              >
                <Trash2 size={11} />
                <span>{confirmDeleteDay ? '确认删除' : '删除'}</span>
              </button>
            </div>
            <div className="flex items-center gap-5">
              <div className="relative h-[132px] w-[132px] shrink-0">
                <UsageDonut appPercent={appPercent} totalSeconds={totalSeconds} />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{formatDuration(totalSeconds)}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>总时长</span>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: '#6366f1' }} />
                  <span className="truncate text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>程序</span>
                  <span className="ml-auto text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{formatDuration(appSeconds)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: '#3b82f6' }} />
                  <span className="truncate text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>网站</span>
                  <span className="ml-auto text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{formatDuration(siteSeconds)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-xl p-5" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', boxShadow: '0 4px 18px rgba(0,0,0,.14)' }}>
            <div className="mb-3 flex items-center gap-2">
              <Monitor size={15} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>每小时活动</h3>
            </div>
            <HourlyBars hourly={hourly} />
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl p-5" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', boxShadow: '0 4px 18px rgba(0,0,0,.14)' }}>
          <header className="mb-4 flex shrink-0 items-center gap-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>排行</h3>
            <div className="flex rounded-lg p-0.5" style={{ background: 'var(--color-bg-card-hover)' }}>
              {(['apps', 'sites'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setView(item)}
                  className="h-7 rounded-md px-3 text-xs font-medium transition-all duration-150"
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
              className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-all duration-150 hover:opacity-85"
              style={{
                background: confirmClear ? '#e5484d' : 'var(--color-bg-card-hover)',
                border: '1px solid ' + (confirmClear ? '#e5484d' : 'var(--color-border)'),
                color: confirmClear ? '#fff' : 'var(--color-text-secondary)',
              }}
            >
              <Trash2 size={12} />
              <span>{confirmClear ? '确认清空' : '清空'}</span>
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1 custom-scrollbar">
            {entries.length === 0 ? (
              <EmptyState
                icon={view === 'apps' ? 'shortcut' : 'search'}
                title={view === 'apps' ? '还没有程序记录' : '还没有网站记录'}
                description={enabled ? '前台使用后会在这里累计' : '当前记录已暂停'}
              />
            ) : entries.map((entry) => (
              <EntryRow key={entry.key} entry={entry} total={viewTotal} view={view} />
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t px-5 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>忽略</span>
          {(data?.ignored || []).map((key) => (
            <span
              key={key}
              className="flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px]"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              {key}
              <button type="button" onClick={() => void removeIgnore(key)} className="opacity-60 transition-opacity hover:opacity-100" title="移除">
                <X size={11} />
              </button>
            </span>
          ))}
          <div className="flex h-7 min-w-[140px] flex-1 items-center gap-1.5 rounded-lg px-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <input
              value={ignoreInput}
              onChange={(event) => setIgnoreInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addIgnore();
                }
              }}
              placeholder={view === 'apps' ? '进程名' : '域名'}
              className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
              style={{ color: 'var(--color-text)' }}
            />
            <button type="button" onClick={() => void addIgnore()} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-80" style={{ color: 'var(--color-accent)' }} title="添加">
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
