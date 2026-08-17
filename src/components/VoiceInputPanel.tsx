import { useEffect, useState } from 'react';
import { CheckCircle2, Mic, Save } from 'lucide-react';
import { useStore } from '../store';
import type { VoiceInputConfig } from '../types';

const SCENARIO_OPTIONS: Array<[string, string, string]> = [
  ['general', '通用校对', '纠正错别字、优化用词、多要点自动排布，不改变原意和风格'],
  ['code', '技术需求校对', '纠正错别字、模糊技术词汇精确化、多点自动分列，不添加需求'],
  ['writing', '文字校对', '纠正错别字、不通顺处调顺，保持原有意境和语感'],
  ['custom', '自定义提示词', '使用你自己填写的 system 提示词'],
];

const SCENARIO_PROMPTS: Record<string, string> = {
  general: '你是一位语音输入校对助手。用户的语音输入可能包含错别字、不精确的用词或松散的口语。请在完全不改变原意和整体表述的前提下，做以下处理：1) 纠正明显的错别字或听写错误；2) 把不精确的用词替换为更准确的词汇；3) 如果用户提出了多个要点，自动用标点或换行进行组织排列。不要重写用户的话，不要改变用户的语调和风格，不要添加用户没说过的内容。直接输出处理后的文本。',
  code: '你是一位技术需求校对助手。用户的语音输入可能包含错别字或不精确的技术描述。请在不改变原意的前提下：1) 纠正错别字；2) 将模糊的描述替换为更准确的技术词汇；3) 如果用户列出了多条，自动用分点格式整理。不要重写用户的话，不要添加用户没提过的需求。直接输出处理后的文本。',
  writing: '你是一位写作校对助手。用户的语音输入可能包含错别字或不通顺的口语表达。请在保持原意、风格和语感的前提下：1) 纠正错别字；2) 将口语化的不通顺之处调整为书面语；3) 保持整体表述和文风不变。不要重写，不要添加内容。直接输出处理后文本。',
  custom: '（自定义提示词）',
};

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

  const currentScenario = form.polishScenario || 'general';

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <Mic size={16} style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>语音输入</span>
      </div>

      <div style={cardStyle}>
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>使用说明</h3>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          先把光标放到要输入的输入框内，再按 <b>Alt+H</b> 弹出麦克风小窗；识别原文会像系统自带语音一样<strong>实时流式追加</strong>到光标处（说了什么就写什么）。<br />
          <b>空格</b> = 暂停/继续识别；<b>回车</b> = 确认识别并关闭；
          <b>采纳</b> = 用润色文本替换刚输入的整段。弹窗可拖动，位置自动记忆。<br />
          光标不在输入框时不会启动识别并会提示。润色结果只展示在弹窗里，采不采纳由你决定。
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
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>润色</h3>
        <div className="mt-2 flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色模式</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['llm', 'LLM 润色（推荐）'],
                ['off', '关闭润色'],
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
          </div>
          {(form.polishMode || 'llm') === 'llm' && (
            <>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色接口地址（OpenAI 兼容，如 https://dashscope.aliyuncs.com/compatible-mode/v1，程序自动拼 /chat/completions）</div>
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
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色 API 密钥</div>
                <input type="password" value={form.polishProvider?.apiKey || ''} onChange={(e) => set({ polishProvider: { ...(form.polishProvider || {}), apiKey: e.target.value } })} placeholder="sk-xxxx" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <div className="mb-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>润色模型名（建议选非推理模型，延迟低）</div>
                <input type="text" value={form.polishProvider?.model || ''} onChange={(e) => set({ polishProvider: { ...(form.polishProvider || {}), model: e.target.value.trim() } })} placeholder="qwen-plus / deepseek-chat" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
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
                        background: currentScenario === value ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                        border: '1px solid ' + (currentScenario === value ? 'var(--color-accent)' : 'var(--color-border)'),
                        color: currentScenario === value ? 'white' : 'var(--color-text-secondary)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 rounded-xl px-3 py-2" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>
                  <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    该场景实际使用的提示词：
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    {currentScenario === 'custom' ? (form.polishCustomPrompt?.trim() || '（未填写，保存后生效）') : SCENARIO_PROMPTS[currentScenario]}
                  </div>
                </div>
              </div>
              {currentScenario === 'custom' && (
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
