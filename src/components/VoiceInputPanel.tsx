import { useEffect, useState } from 'react';
import { CheckCircle2, Mic, Save } from 'lucide-react';
import { useStore } from '../store';
import type { VoiceInputConfig } from '../types';

export default function VoiceInputPanel() {
  const config = useStore((s) => s.config);
  const [form, setForm] = useState<VoiceInputConfig>({});
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    setForm({
      enabled: config.voiceInput?.enabled !== false,
      apiKey: config.voiceInput?.apiKey || '',
      workspaceId: config.voiceInput?.workspaceId || '',
      polishMode: config.voiceInput?.polishMode || 'llm',
      polishProvider: { ...(config.voiceInput?.polishProvider || {}) },
    });
  }, [config.voiceInput]);

  const save = () => {
    useStore.setState((s) => ({
      config: { ...s.config, voiceInput: { enabled: true, polishMode: 'llm' as const, ...form } },
    }));
    void useStore.getState().saveConfig();
    setSavedTick(Date.now());
  };

  const set = (patch: Partial<VoiceInputConfig>) => setForm((f) => ({ ...f, ...patch }));

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
  };
  const inputStyle: React.CSSProperties = {
    background: 'var(--color-bg-card-hover)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
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
          按 <b>Alt+H</b> 弹出胶囊麦克风，说话时识别文字<strong>暂存进胶囊</strong>（不再实时写入光标，说多少句都不会断）。<br />
          · 中间文字随说话持续累加，超出宽度向左滚动；左侧圆点显示状态（绿=识别中，黄=已暂停）。<br />
          · <b>✓ / 回车</b>：对所有识别文字做<strong>结构整理</strong>（修正确定无疑的错别字、提取要点并按 1. 2. 3. 排列），完成后统一在光标处输入。<br />
          · <b>✗ / ESC</b>：取消，不输入。 <b>空格</b>：暂停/继续识别。<br />
          · 胶囊可拖动，位置自动记忆。
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
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>语音识别</h3>
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>启用语音输入（Alt+H）</span>
            <input
              type="checkbox"
              checked={form.enabled !== false}
              onChange={(e) => set({ enabled: e.target.checked })}
              className="w-4 h-4 accent-indigo-500"
            />
          </label>
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>百炼 API Key（阿里云百炼控制台获取）</div>
            <input type="password" value={form.apiKey || ''} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-xxxxxxxx" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
          </div>
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>Workspace ID（百炼工作区 ID，qwen-audio 模型专属接入点）</div>
            <input type="text" value={form.workspaceId || ''} onChange={(e) => set({ workspaceId: e.target.value.trim() })} placeholder="llm-xxxxxx" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>结构整理（勾选时调用）</h3>
        <div className="mt-2 flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>结构整理模式</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['llm', 'LLM 结构整理'],
                ['off', '直接输入（不整理）'],
              ] as Array<['llm' | 'off', string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set({ polishMode: value })}
                  className="flex items-center justify-center py-2 rounded-xl text-xs transition-all duration-150"
                  style={{
                    background: (form.polishMode || 'llm') === value ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                    border: '1px solid ' + ((form.polishMode || 'llm') === value ? 'var(--color-accent)' : 'var(--color-border)'),
                    color: (form.polishMode || 'llm') === value ? 'white' : 'var(--color-text-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              结构整理只做两件事：修正确定无疑的错别字、把多个要点排成 1. 2. 3.。不会改动词语本身。
            </div>
          </div>
          {(form.polishMode || 'llm') === 'llm' && (
            <>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>接口地址（OpenAI 兼容，程序自动拼 /chat/completions）</div>
                <input
                  type="text"
                  value={form.polishProvider?.baseUrl || ''}
                  onChange={(e) => set({ polishProvider: { ...(form.polishProvider || {}), baseUrl: e.target.value.trim() } })}
                  placeholder="https://api.siliconflow.cn/v1"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={inputStyle}
                />
              </div>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>API 密钥</div>
                <input type="password" value={form.polishProvider?.apiKey || ''} onChange={(e) => set({ polishProvider: { ...(form.polishProvider || {}), apiKey: e.target.value } })} placeholder="sk-xxxx" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>模型名（建议选非推理模型，延迟低）</div>
                <input type="text" value={form.polishProvider?.model || ''} onChange={(e) => set({ polishProvider: { ...(form.polishProvider || {}), model: e.target.value.trim() } })} placeholder="qwen-plus / deepseek-chat" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
              </div>
            </>
          )}
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
  );
}
