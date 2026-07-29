import { CheckCircle2, CheckSquare, Download, Grid2X2, RefreshCw, Settings, Keyboard } from 'lucide-react';
import { useStore } from '../store';
import { ModuleId, UpdateState } from '../types';
import { useTranslation } from '../hooks/useTranslation';

const modules: Array<{ id: ModuleId; label: string; icon: typeof Grid2X2 }> = [
  { id: 'shortcuts', label: '快捷', icon: Grid2X2 },
  { id: 'tasks', label: '任务', icon: CheckSquare },
];

interface ModuleSidebarProps {
  updateState: UpdateState | null;
  onUpdateClick: () => void;
  onShowKeyboardShortcuts: () => void;
}

export default function ModuleSidebar({ updateState, onUpdateClick, onShowKeyboardShortcuts }: ModuleSidebarProps) {
  const activeModule = useStore((state) => state.activeModule);
  const setActiveModule = useStore((state) => state.setActiveModule);
  const openSettings = useStore((state) => state.openSettings);
  const { t } = useTranslation();

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
        {modules.map(({ id, label, icon: Icon }) => {
          const active = activeModule === id;
          return (
            <button
              key={id}
              onClick={() => setActiveModule(id)}
              className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] transition-all duration-150"
              style={{
                background: active ? 'var(--color-accent)' : 'var(--color-bg-card)',
                border: '1px solid ' + (active ? 'var(--color-accent)' : 'var(--color-border)'),
                color: active ? 'white' : 'var(--color-text-secondary)',
                boxShadow: active ? '0 4px 14px var(--color-accent-glow)' : 'none',
              }}
              title={label}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onShowKeyboardShortcuts}
          className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] transition-all duration-150 hover:opacity-85"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          title="查看快捷键"
        >
          <Keyboard size={17} />
          <span>快捷键</span>
        </button>
        <button
          type="button"
          onClick={onUpdateClick}
          disabled={updateStatus === 'checking'}
          className="relative flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] transition-all duration-150 hover:opacity-85 disabled:cursor-wait"
          style={{
            background: updateHighlighted ? 'var(--color-accent)' : 'var(--color-bg-card)',
            border: '1px solid ' + (updateHighlighted ? 'var(--color-accent)' : 'var(--color-border)'),
            color: updateHighlighted ? 'white' : 'var(--color-text-secondary)',
            boxShadow: updateHighlighted ? '0 4px 14px var(--color-accent-glow)' : 'none',
          }}
          title={updateTitle}
        >
          <UpdateIcon size={17} className={updateBusy ? 'animate-spin' : ''} />
          <span className="max-w-full truncate px-0.5">{updateLabel}</span>
          {updateHighlighted && (
            <span
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
              style={{ background: updateStatus === 'downloaded' ? '#63d391' : '#ffffff' }}
            />
          )}
        </button>

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
