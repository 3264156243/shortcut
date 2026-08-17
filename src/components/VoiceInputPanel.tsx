import { useEffect, useState } from 'react';
import { CheckCircle2, Mic, Save } from 'lucide-react';
import { useStore } from '../store';
import type { VoiceInputConfig } from '../types';

const SCENARIO_OPTIONS: Array<[string, string]> = [
  ['general', '通用提示词优化'],
  ['code', '代码开发需求'],
  ['writing', '写作润色'],
  ['custom', '自定义提示词'],
];

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
      polishScenario: config.voiceInput?.polishScenario || 'general',
      polishCustomPrompt: config.voiceInput?.polishCustomPrompt || '',
      sentenceGapMs: config.voiceInput?.sentenceGapMs || 1000,
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
          按下 <b>Alt+H</b> 弹出麦克风小窗，说话时识别原文实时打入当前输入框光标处。<br />
          <b>空格</b> = 暂停/继续识别（暂停期间不产生识别费用）；<b>回车</b> = 确认识别并关闭；
          <b>采纳</b> = 用润色文本覆盖刚输入的文段。弹窗可拖动，位置自动记忆。
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
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>断句间隔（毫秒）：停顿超过该时长才把当前句定稿，避免一句话没说完就断句</div>
            <input type="number" min={100} max={5000} step={100} value={form.sentenceGapMs || 1000} onChange={(e) => set({ sentenceGapMs: Math.max(100, Number(e.target.value) || 1000) })} className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>润色</h3>
        <div className="mt-2 flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色模式</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['llm', 'LLM 润色（推荐）'],
                ['asr', '识别内置润色'],
                ['off', '关闭润色'],
              ] as Array<['llm' | 'asr' | 'off', string]>).map(([value, label]) => (
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
          </div>
          {(form.polishMode || 'llm') === 'llm' && (
            <>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色接口地址（OpenAI 兼容，如 https://dashscope.aliyuncs.com/compatible-mode/v1，程序自动拼 /chat/completions）</div>
                <input
                  type="text"
                  value={form.polishProvider?.baseUrl || ''}
                  onChange={(e) => set({ polishProvider: { ...(form.polishProvider || {}), baseUrl: e.target.value.trim() } })}
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={inputStyle}
                />
              </div>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色 API 密钥</div>
                <input type="password" value={form.polishProvider?.apiKey || ''} onChange={(e) => set({ polishProvider: { ...(form.polishProvider || {}), apiKey: e.target.value } })} placeholder="sk-xxxx" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色模型名</div>
                <input type="text" value={form.polishProvider?.model || ''} onChange={(e) => set({ polishProvider: { ...(form.polishProvider || {}), model: e.target.value.trim() } })} placeholder="qwen-plus" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色场景</div>
                <div className="grid grid-cols-2 gap-2">
                  {SCENARIO_OPTIONS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => set({ polishScenario: value as VoiceInputConfig['polishScenario'] })}
                      className="flex items-center justify-center py-2 rounded-xl text-xs transition-all duration-150"
                      style={{
                        background: (form.polishScenario || 'general') === value ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                        border: '1px solid ' + ((form.polishScenario || 'general') === value ? 'var(--color-accent)' : 'var(--color-border)'),
                        color: (form.polishScenario || 'general') === value ? 'white' : 'var(--color-text-secondary)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {(form.polishScenario || 'general') === 'custom' && (
                <div>
                  <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>自定义润色提示词（system 角色）</div>
                  <textarea
                    rows={4}
                    value={form.polishCustomPrompt || ''}
                    onChange={(e) => set({ polishCustomPrompt: e.target.value })}
                    placeholder="例如：你是提示词优化专家，把口语转成结构清晰、可直接执行的提示词……"
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
                    style={inputStyle}
                  />
                </div>
              )}
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
