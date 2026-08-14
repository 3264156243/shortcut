import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown, KeyRound, X } from 'lucide-react';
import { useStore } from '../store';
import { CodexPreset, CodexWireApi } from '../types';

const wireOptions: Array<{ value: CodexWireApi; label: string }> = [
  { value: 'chat', label: 'chat（OpenAI 兼容）' },
  { value: 'responses', label: 'responses（OpenAI / DeepSeek 新版）' },
  { value: 'anthropic', label: 'anthropic（Anthropic 兼容）' },
];

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
  const [providerId, setProviderId] = useState(preset?.providerId || '');
  const [baseUrl, setBaseUrl] = useState(preset?.baseUrl || '');
  const [wireApi, setWireApi] = useState<CodexWireApi>(preset?.wireApi || 'chat');
  const [model, setModel] = useState(preset?.model || '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [wireMenuOpen, setWireMenuOpen] = useState(false);

  useEffect(() => {
    if (!preset && !providerId && name.trim()) {
      setProviderId(name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
    }
  }, [name, preset, providerId]);

  const submit = async () => {
    const title = name.trim();
    const url = baseUrl.trim();
    const slug = model.trim();
    if (!title || !url || !slug) {
      addToast('请填写名称、请求地址和模型名', 'error');
      return;
    }
    const finalProviderId = providerId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '')
      || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!finalProviderId) {
      addToast('请填写供应商 ID', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await window.electronAPI?.saveCodexPreset?.({
        id: preset?.id,
        name: title,
        providerId: finalProviderId,
        baseUrl: url,
        wireApi,
        model: slug,
        apiKey: apiKey.trim() || undefined,
      });
      if (result?.success) {
        addToast(preset ? '方案已更新' : '方案已添加', 'success');
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
  const labelClass = 'mb-2 block text-xs font-medium';
  const labelStyle = { color: 'var(--color-text-secondary)' };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'var(--color-overlay)' }} onClick={onClose}>
      <motion.section
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', boxShadow: '0 24px 70px var(--color-shadow)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{preset ? '编辑方案' : '新增方案'}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md"><X size={18} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block">
            <span className={labelClass} style={labelStyle}>名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} style={inputStyle} placeholder="例如 DeepSeek" />
          </label>
          <label className="block">
            <span className={labelClass} style={labelStyle}>供应商 ID</span>
            <input value={providerId} onChange={(event) => setProviderId(event.target.value)} className={inputClass} style={inputStyle} placeholder="例如 deepseek，会写入 model_providers" />
          </label>
          <label className="block">
            <span className={labelClass} style={labelStyle}>请求地址</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className={inputClass} style={inputStyle} placeholder="https://api.example.com/" />
          </label>
          <label className="block">
            <span className={labelClass} style={labelStyle}>协议类型</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setWireMenuOpen((open) => !open)}
                className="flex h-10 w-full items-center justify-between rounded-md border px-3 text-sm"
                style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <span className="truncate">{wireOptions.find((item) => item.value === wireApi)?.label || wireApi}</span>
                <ChevronDown size={14} className="shrink-0" style={{ color: 'var(--color-text-muted)' }} />
              </button>
              {wireMenuOpen ? (
                <>
                  <div className="fixed inset-0 z-[210]" onClick={() => setWireMenuOpen(false)} />
                  <div
                    className="absolute left-0 right-0 top-[calc(100%+4px)] z-[211] overflow-hidden rounded-md border py-1"
                    style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', boxShadow: '0 14px 40px var(--color-shadow)' }}
                  >
                    {wireOptions.map((item) => {
                      const active = item.value === wireApi;
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => { setWireApi(item.value); setWireMenuOpen(false); }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:opacity-85"
                          style={{ background: active ? 'var(--color-accent-soft, var(--color-bg-card-hover))' : 'transparent', color: 'var(--color-text)' }}
                        >
                          <span className="truncate">{item.label}</span>
                          {active ? <Check size={14} style={{ color: 'var(--color-accent)' }} /> : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          </label>
          <label className="block">
            <span className={labelClass} style={labelStyle}>模型名</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} className={inputClass} style={inputStyle} placeholder="例如 deepseek-v4-flash" />
          </label>
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-xs font-medium" style={labelStyle}>
              <KeyRound size={13} />
              密钥{preset?.apiKey ? '（留空则保留原密钥）' : ''}
            </span>
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className={inputClass} style={inputStyle} placeholder="sk-..." autoComplete="off" />
          </label>
        </div>

        <footer className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>取消</button>
          <button onClick={() => void submit()} disabled={saving} className="rounded-md px-5 py-2 text-sm text-white disabled:opacity-60" style={{ background: 'var(--color-accent)' }}>
            {saving ? '保存中...' : (preset ? '保存修改' : '添加')}
          </button>
        </footer>
      </motion.section>
    </div>
  );
}
