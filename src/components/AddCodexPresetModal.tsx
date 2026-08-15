import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useStore } from '../store';
import { CodexPreset } from '../types';

export default function AddCodexPresetModal({
  preset,
  onClose,
  onSaved,
}: {
  preset: CodexPreset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const addToast = useStore((state) => state.addToast);
  const [name, setName] = useState(preset?.name || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const title = name.trim();
    if (!title) {
      addToast('请填写方案名称', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await window.electronAPI?.saveCurrentCodexPreset?.({
        name: title,
        id: preset?.id,
      });
      if (result?.success) {
        addToast(preset ? '方案已重命名' : '当前配置已保存为方案', 'success');
        onSaved();
      } else {
        addToast(result?.error || '保存失败', 'error');
      }
    } catch (error: any) {
      addToast(error?.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';
  const inputStyle = { background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'var(--color-overlay)' }} onClick={onClose}>
      <motion.section
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', boxShadow: '0 24px 70px var(--color-shadow)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{preset ? '重命名方案' : '保存当前配置'}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md"><X size={18} /></button>
        </header>

        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-2 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>方案名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submit();
                }
              }}
              className={inputClass}
              style={inputStyle}
              placeholder="例如 DeepSeek 主用"
              autoFocus
            />
          </label>
          {!preset ? (
            <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              将当前 config.toml、auth.json、models.json 完整保存为该方案，切换时整包覆盖，聊天记录统一保留
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>取消</button>
          <button onClick={() => void submit()} disabled={saving} className="rounded-md px-5 py-2 text-sm text-white disabled:opacity-60" style={{ background: 'var(--color-accent)' }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </footer>
      </motion.section>
    </div>
  );
}
