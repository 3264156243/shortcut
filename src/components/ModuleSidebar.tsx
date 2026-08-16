import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Keyboard,
  MoreHorizontal,
  RefreshCw,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { MODULE_REGISTRY, getAvailableModuleIds, type ModuleMeta } from '../moduleRegistry';
import { useStore } from '../store';
import { ModuleId, UpdateState } from '../types';
import { useTranslation } from '../hooks/useTranslation';

interface SidebarButtonProps {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  badge?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}

function SidebarButton({ label, icon: Icon, active, badge, busy, disabled, onClick, title }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] transition-all duration-150 hover:opacity-85 disabled:cursor-wait"
      style={{
        background: active ? 'var(--color-accent)' : 'var(--color-bg-card)',
        border: '1px solid ' + (active ? 'var(--color-accent)' : 'var(--color-border)'),
        color: active ? 'white' : 'var(--color-text-secondary)',
        boxShadow: active ? '0 4px 14px var(--color-accent-glow)' : 'none',
      }}
      title={title || label}
    >
      <Icon size={17} className={busy ? 'animate-spin' : ''} />
      <span className="max-w-full truncate px-0.5">{label}</span>
      {badge && (
        <span
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
          style={{ background: '#63d391' }}
        />
      )}
    </button>
  );
}

interface ModuleSidebarProps {
  updateState: UpdateState | null;
  onUpdateClick: () => void;
  onShowKeyboardShortcuts: () => void;
}

export default function ModuleSidebar({ updateState, onUpdateClick, onShowKeyboardShortcuts }: ModuleSidebarProps) {
  const activeModule = useStore((state) => state.activeModule);
  const config = useStore((state) => state.config);
  const licenseModuleAccess = useStore((state) => state.licenseModuleAccess);
  const setActiveModule = useStore((state) => state.setActiveModule);
  const openSettings = useStore((state) => state.openSettings);
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  const visibleIds = getAvailableModuleIds(config).filter((id) => licenseModuleAccess[id] !== false);
  const metaById = new Map(MODULE_REGISTRY.map((item) => [item.id, item]));
  const primaryModules = visibleIds
    .map((id) => metaById.get(id))
    .filter((meta): meta is ModuleMeta => !!meta && meta.group === 'primary');
  const moreModules = visibleIds
    .map((id) => metaById.get(id))
    .filter((meta): meta is ModuleMeta => !!meta && meta.group === 'more');
  const moreActive = moreModules.some((item) => item.id === activeModule);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  const updateStatus = updateState?.status || 'idle';
  const updateHighlighted = updateStatus === 'available' || updateStatus === 'downloaded';
  const updateBusy = updateStatus === 'checking' || updateStatus === 'downloading';
  const updateProgress = Math.round(updateState?.progress || 0);
  const UpdateIcon = updateStatus === 'downloaded'
    ? CheckCircle2
    : updateStatus === 'available'
      ? Download
      : RefreshCw;
  const updateLabel = updateStatus === 'downloaded'
    ? t('update.sidebarReady')
    : updateStatus === 'available'
      ? t('update.sidebarAvailable')
      : updateStatus === 'downloading'
        ? t('update.sidebarDownloading', { progress: String(updateProgress) })
        : updateStatus === 'checking'
          ? t('update.sidebarChecking')
          : t('update.sidebar');
  const updateTitle = updateStatus === 'available'
    ? t('update.availableTitle')
    : updateStatus === 'downloaded'
      ? t('update.ready', { version: updateState?.version || '' })
      : updateStatus === 'downloading'
        ? t('update.downloading')
        : t('update.checkTitle');

  return (
    <aside
      className="no-drag flex w-16 shrink-0 flex-col items-center gap-2 px-2 py-3"
      style={{ borderRight: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
    >
      <div className="flex flex-col gap-2">
        {primaryModules.map(({ id, label, icon }) => (
          <SidebarButton
            key={id}
            label={label}
            icon={icon}
            active={activeModule === id}
            onClick={() => setActiveModule(id)}
          />
        ))}
      </div>

      <div className="mt-auto flex w-full flex-col items-center gap-2">
        <div ref={moreRef} className="relative">
          <SidebarButton
            label="更多"
            icon={MoreHorizontal}
            active={moreOpen || moreActive}
            onClick={() => setMoreOpen((open) => !open)}
            title="更多功能"
          />
          {moreOpen && (
            <div
              className="absolute bottom-0 left-full z-50 ml-2 flex w-40 flex-col gap-1 overflow-hidden rounded-xl p-1.5"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 12px 32px var(--color-shadow)',
              }}
            >
              {moreModules.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveModule(id);
                    setMoreOpen(false);
                  }}
                  className="flex h-10 items-center gap-2 rounded-lg px-2.5 text-[12px] transition-colors duration-150"
                  style={{
                    background: activeModule === id ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                    color: activeModule === id ? 'white' : 'var(--color-text-secondary)',
                  }}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
              {moreModules.length > 0 && (
                <div className="mx-2 my-0.5" style={{ borderTop: '1px solid var(--color-border)' }} />
              )}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onShowKeyboardShortcuts();
                }}
                className="flex h-10 items-center gap-2 rounded-lg px-2.5 text-[12px] transition-colors duration-150"
                style={{
                  background: 'var(--color-bg-card-hover)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <Keyboard size={15} />
                快捷键
              </button>
            </div>
          )}
        </div>

        <SidebarButton
          label={updateLabel}
          icon={UpdateIcon}
          active={updateHighlighted}
          badge={updateHighlighted}
          busy={updateBusy}
          disabled={updateStatus === 'checking'}
          onClick={onUpdateClick}
          title={updateTitle}
        />

        <button
          onClick={openSettings}
          className="flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 hover:opacity-80"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          title="设置"
        >
          <Settings size={17} />
        </button>
      </div>
    </aside>
  );
}
