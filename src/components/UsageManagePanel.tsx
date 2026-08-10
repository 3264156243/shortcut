import { useCallback, useEffect, useState } from 'react';
import { Ban, Headphones, ListFilter, Plus, X } from 'lucide-react';
import { useStore } from '../store';
import type { UsageData } from '../types';

function KeyList({
  title,
  icon,
  items,
  placeholder,
  onAdd,
  onRemove,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  placeholder: string;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const [input, setInput] = useState('');

  const submit = () => {
    const key = input.trim().toLowerCase();
    if (!key) return;
    onAdd(key);
    setInput('');
  };

  return (
    <section
      className="flex min-h-0 flex-col rounded-xl p-5"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', boxShadow: '0 4px 18px rgba(0,0,0,.14)' }}
    >
      <div className="mb-4 flex shrink-0 items-center gap-2">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-accent)' }}
        >
          {icon}
        </div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
          style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-muted)' }}
        >
          {items.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[80px] items-center justify-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
            暂无
          </div>
        ) : (
          <div className="flex flex-wrap content-start gap-2">
            {items.map((key) => (
              <span
                key={key}
                className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs"
                style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                {key}
                <button type="button" onClick={() => onRemove(key)} className="opacity-60 transition-opacity hover:opacity-100" title="移除">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
          style={{ color: 'var(--color-text)' }}
        />
        <button type="button" onClick={submit} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-80" style={{ color: 'var(--color-accent)' }} title="添加">
          <Plus size={14} />
        </button>
      </div>
    </section>
  );
}

export default function UsageManagePanel() {
  const addToast = useStore((state) => state.addToast);
  const [data, setData] = useState<UsageData | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI?.getUsageData?.();
      if (next) setData(next as UsageData);
    } catch {}
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const addBackground = async (key: string) => {
    const next = await window.electronAPI?.addUsageBackgroundApp?.(key);
    if (next) setData(next as UsageData);
    addToast(`已加入后台常驻：${key}`, 'success');
  };

  const removeBackground = async (key: string) => {
    const next = await window.electronAPI?.removeUsageBackgroundApp?.(key);
    if (next) setData(next as UsageData);
  };

  const addIgnored = async (key: string) => {
    const next = await window.electronAPI?.addUsageIgnored?.(key);
    if (next) setData(next as UsageData);
    addToast(`已忽略：${key}`, 'success');
  };

  const removeIgnored = async (key: string) => {
    const next = await window.electronAPI?.removeUsageIgnored?.(key);
    if (next) setData(next as UsageData);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: 'var(--color-accent)', color: '#fff', boxShadow: '0 4px 14px var(--color-accent-glow)' }}
        >
          <ListFilter size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>名单管理</div>
          <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>后台常驻与忽略</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 md:flex-row">
        <div className="flex min-h-[260px] flex-1 md:min-h-0">
          <KeyList
            title="后台常驻"
            icon={<Headphones size={16} />}
            items={data?.backgroundApps || []}
            placeholder="进程名，如 cloudmusic"
            onAdd={(key) => void addBackground(key)}
            onRemove={(key) => void removeBackground(key)}
          />
        </div>
        <div className="flex min-h-[260px] flex-1 md:min-h-0">
          <KeyList
            title="忽略名单"
            icon={<Ban size={16} />}
            items={data?.ignored || []}
            placeholder="进程名或域名"
            onAdd={(key) => void addIgnored(key)}
            onRemove={(key) => void removeIgnored(key)}
          />
        </div>
      </div>
    </div>
  );
}
