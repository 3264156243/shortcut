import { useEffect, useState } from 'react';
import { CheckCircle2, Mic, Save } from 'lucide-react';
import { useStore } from '../store';
import type { VoiceInputConfig } from '../types';

export default function VoiceInputPanel() {
  const config = useStore((s) => s.config);
  const [apiKey, setApiKey] = useState(config.voiceInput?.apiKey || '');
  const [workspaceId, setWorkspaceId] = useState(config.voiceInput?.workspaceId || '');
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    setApiKey(config.voiceInput?.apiKey || '');
    setWorkspaceId(config.voiceInput?.workspaceId || '');
  }, [config.voiceInput?.apiKey, config.voiceInput?.workspaceId]);

  const save = () => {
    useStore.setState((s) => ({
      config: {
        ...s.config,
        voiceInput: {
          enabled: true,
          polishMode: 'asr',
          ...(s.config.voiceInput || {}),
          apiKey: apiKey.trim(),
          workspaceId: workspaceId.trim(),
        },
      },
    }));
    void useStore.getState().saveConfig();
    setSavedTick(Date.now());
  };

  const toggleEnabled = (enabled: boolean) => {
    useStore.setState((s) => ({
      config: { ...s.config, voiceInput: { ...(s.config.voiceInput || {}), enabled } },
    }));
    void useStore.getState().saveConfig();
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <Mic size={16} style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>语音输入</span>
      </div>

      <div style={cardStyle}>
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>使用说明</h3>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          按下 <b>Alt+H</b> 弹出麦克风小窗，对着麦克风说话，识别原文会实时打入当前输入框光标处；小窗实时展示润色文本，点「采纳」用润色版覆盖刚输入的文段，「回车」或「×」结束。
        </p>
        <button
          type="button"
          onClick={() => void window.electronAPI?.voiceOpen?.()}
          className="mt-3 flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
          style={{ background: 'var(--color-accent)', color: 'white' }}
        >
          <Mic size={15} /> 打开语音输入（Alt+H）
        </button>
      </div>

      <div style={cardStyle}>
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>配置</h3>
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>启用语音输入（Alt+H）</span>
            <input
              type="checkbox"
              checked={config.voiceInput?.enabled !== false}
              onChange={(e) => toggleEnabled(e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
          </label>
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>百炼 API Key（阿里云百炼控制台获取）</div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-xxxxxxxx"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none transition-all duration-150"
              style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>Workspace ID（百炼工作区 ID，qwen-audio 模型专属接入点）</div>
            <input
              type="text"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value.trim())}
              placeholder="llm-xxxxxx"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none transition-all duration-150"
              style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色模式</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['asr', '模型内置润色'],
                ['off', '关闭润色（仅识别）'],
              ] as Array<['asr' | 'off', string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    useStore.setState((s) => ({
                      config: { ...s.config, voiceInput: { ...(s.config.voiceInput || {}), polishMode: value } },
                    }));
                    void useStore.getState().saveConfig();
                  }}
                  className="flex items-center justify-center py-2 rounded-xl text-xs transition-all duration-150"
                  style={{
                    background: (config.voiceInput?.polishMode || 'asr') === value ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                    border: '1px solid ' + ((config.voiceInput?.polishMode || 'asr') === value ? 'var(--color-accent)' : 'var(--color-border)'),
                    color: (config.voiceInput?.polishMode || 'asr') === value ? 'white' : 'var(--color-text-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={save}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
              style={{ background: 'var(--color-accent)', color: 'white' }}
            >
              <Save size={14} /> 保存配置
            </button>
            {savedTick > 0 && (
              <span className="flex items-center gap-1 text-xs" style={{ color: '#63d391' }}>
                <CheckCircle2 size={13} /> 已保存
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
