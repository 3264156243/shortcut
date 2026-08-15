import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, Check, FileJson, FileText, FolderOpen, KeyRound, Pencil, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { CodexPreset, CodexPresetState } from '../types';
import AddCodexPresetModal from './AddCodexPresetModal';
import EmptyState from './EmptyState';

export default function CodexProviderPanel() {
  const addToast = useStore((state) => state.addToast);
  const [state, setState] = useState<CodexPresetState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CodexPreset | null>(null);
  const [deletingPreset, setDeletingPreset] = useState<CodexPreset | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI?.getCodexPresetState?.();
      if (next) setState(next);
    } catch {}
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = async (id: string) => {
    const preset = state?.presets.find((item) => item.id === id);
    setApplyingId(id);
    try {
      const result = await window.electronAPI?.applyCodexPreset?.(id);
      if (result?.state) setState(result.state);
      addToast(
        result?.success
          ? `已切换为「${preset?.name || '该'}」方案，重启 Codex 后生效`
          : `切换失败：${result?.error || '未知错误'}`,
        result?.success ? 'success' : 'error',
      );
    } finally {
      setApplyingId(null);
    }
  };

  const restore = async () => {
    const result = await window.electronAPI?.restoreCodexPreset?.();
    if (result?.state) setState(result.state);
    setConfirmRestore(false);
    addToast(result?.success ? '已从备份还原' : `还原失败：${result?.error || '未知错误'}`, result?.success ? 'success' : 'error');
  };

  const remove = async (id: string) => {
    const result = await window.electronAPI?.deleteCodexPreset?.(id);
    if (result?.state) setState(result.state);
    setDeletingPreset(null);
    addToast('方案已删除', 'success');
  };

  const openFile = async (which: 'config' | 'auth' | 'models') => {
    const result = await window.electronAPI?.openCodexFile?.(which);
    if (!result?.success) addToast(result?.error || '打开失败', 'error');
  };

  const openPresetDir = async (id: string) => {
    const result = await window.electronAPI?.openCodexPresetDir?.(id);
    if (!result?.success) addToast(result?.error || '打开失败', 'error');
  };

  const isCurrent = (preset: CodexPreset) =>
    !!state?.currentPresetName && state.currentPresetName === preset.name;

  const fileButtons: Array<{ which: 'config' | 'auth' | 'models'; label: string; icon: typeof FileText }> = [
    { which: 'config', label: 'config.toml', icon: FileText },
    { which: 'auth', label: 'auth.json', icon: KeyRound },
    { which: 'models', label: 'models.json', icon: FileJson },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--color-accent)', color: '#fff', boxShadow: '0 4px 14px var(--color-accent-glow)' }}>
          <Bot size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Codex 供应商</div>
          <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            当前 {state?.currentProvider || '未设置'} · {state?.currentModel || '未知模型'}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {fileButtons.map((item) => (
            <button
              key={item.which}
              type="button"
              onClick={() => void openFile(item.which)}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors hover:opacity-80"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              title={`打开 ${item.label}`}
            >
              <item.icon size={13} />
              <span className="hidden xl:inline">{item.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirmRestore) void restore();
            else {
              setConfirmRestore(true);
              window.setTimeout(() => setConfirmRestore(false), 3000);
            }
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition-colors hover:opacity-80"
          style={{
            background: confirmRestore ? '#e5484d' : 'var(--color-bg-card)',
            border: '1px solid ' + (confirmRestore ? '#e5484d' : 'var(--color-border)'),
            color: confirmRestore ? '#fff' : 'var(--color-text-secondary)',
          }}
          title="从上次切换前的备份还原"
        >
          <RotateCcw size={13} />
          <span>{confirmRestore ? '确认还原' : '还原'}</span>
        </button>
        <button
          type="button"
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-white transition-opacity hover:opacity-85"
          style={{ background: 'var(--color-accent)' }}
        >
          <Save size={14} />
          <span>保存当前配置</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!state?.presets?.length ? (
          <EmptyState icon="shortcut" title="还没有供应商方案" description="保存当前配置后即可一键切换" />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {state.presets.map((preset) => {
              const current = isCurrent(preset);
              const confirmDelete = deletingPreset?.id === preset.id;
              return (
                <div
                  key={preset.id}
                  className="flex min-w-0 flex-col rounded-xl p-4 transition-colors duration-150"
                  style={{
                    background: 'var(--color-bg-card)',
                    border: `1px solid ${current ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    boxShadow: current ? '0 4px 18px var(--color-accent-glow)' : '0 2px 10px rgba(0,0,0,.12)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border p-1.5" style={{ background: 'var(--color-bg-card-hover)', borderColor: 'var(--color-border)' }}>
                      {preset.icon ? <img src={preset.icon} alt="" className="h-full w-full object-contain" draggable={false} /> : <Bot size={20} style={{ color: 'var(--color-text-secondary)' }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{preset.name}</span>
                        {current ? <Check size={13} style={{ color: 'var(--color-accent)' }} /> : null}
                      </div>
                      <div className="truncate text-[11px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{preset.model}</div>
                    </div>
                  </div>

                  <div className="mt-3 min-w-0 space-y-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    <div className="truncate">{preset.baseUrl}</div>
                    <div>{preset.wireApi} · {preset.providerId}</div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void apply(preset.id)}
                      disabled={applyingId === preset.id || current}
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: current ? 'var(--color-bg-card-hover)' : 'var(--color-accent)', color: current ? 'var(--color-text-secondary)' : '#fff' }}
                    >
                      {applyingId === preset.id ? '切换中...' : (current ? '当前方案' : '切换')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openPresetDir(preset.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
                      style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                      title="打开方案文件"
                    >
                      <FolderOpen size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditing(preset); setModalOpen(true); }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
                      style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                      title="重命名"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingPreset(preset)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
                      style={{
                        background: confirmDelete ? '#e5484d' : 'var(--color-bg-card-hover)',
                        border: '1px solid ' + (confirmDelete ? '#e5484d' : 'var(--color-border)'),
                        color: confirmDelete ? '#fff' : 'var(--color-text-secondary)',
                      }}
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen ? (
        <AddCodexPresetModal
          preset={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void refresh();
          }}
        />
      ) : null}

      {deletingPreset ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'var(--color-overlay)' }} onClick={() => setDeletingPreset(null)}>
          <motion.section
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm overflow-hidden rounded-lg"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', boxShadow: '0 24px 70px var(--color-shadow)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="border-b px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>删除方案</h2>
            </header>
            <div className="p-5">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                确定删除「{deletingPreset.name}」吗？该方案快照将被移除。
              </p>
            </div>
            <footer className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setDeletingPreset(null)} className="rounded-md px-4 py-2 text-sm" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>取消</button>
              <button onClick={() => void remove(deletingPreset.id)} className="rounded-md px-5 py-2 text-sm text-white" style={{ background: '#e5484d' }}>删除</button>
            </footer>
          </motion.section>
        </div>
      ) : null}
    </div>
  );
}
