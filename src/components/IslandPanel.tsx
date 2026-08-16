import { useEffect, useState } from 'react';
import { Film, Smartphone } from 'lucide-react';
import { useStore } from '../store';
import { BalanceProvider, IslandDisplayState, IslandStyle, IslandPosition } from '../types';

export default function IslandPanel() {
  const config = useStore((s) => s.config);
  const licenseFeatureAccess = useStore((s) => s.licenseFeatureAccess);
  const island = config.island || {
    enabled: true,
    style: 'capsule' as IslandStyle,
    position: 'top-center' as IslandPosition,
    autoHideFullscreen: true,
    musicEnabled: true,
    tasksEnabled: true,
    cockpitEnabled: false,
    deepseekEnabled: false,
    balanceProvider: 'none' as BalanceProvider,
    lyricBounce: true,
    orbitGlow: true,
    barsEnabled: true,
    displayState: 'collapsed' as IslandDisplayState,
  };
  const [deepseekKey, setDeepseekKey] = useState('');
  const [opencodeKey, setOpencodeKey] = useState('');

  useEffect(() => {
    setDeepseekKey(island.deepseekApiKey || '');
  }, [island.deepseekApiKey]);

  useEffect(() => {
    setOpencodeKey(island.opencodeApiKey || '');
  }, [island.opencodeApiKey]);

  const balanceProvider = (island.balanceProvider || (island.deepseekEnabled === true ? 'deepseek' : 'none')) as BalanceProvider;

  const updateIsland = async (updates: Partial<typeof island>) => {
    const next = { ...island, ...updates };
    useStore.setState((s) => ({ config: { ...s.config, island: next } }));
    const nextProvider = (next.balanceProvider || (next.deepseekEnabled === true ? 'deepseek' : 'none')) as BalanceProvider;
    const result = await window.electronAPI?.setIsland(next.enabled, next.style, next.position, next.autoHideFullscreen, next.musicEnabled !== false, next.lyricBounce !== false, next.displayState || 'collapsed', next.orbitGlow !== false, next.barsEnabled !== false, next.tasksEnabled !== false, next.cockpitEnabled === true, nextProvider);
    if (result && !result.success && result.error) {
      console.error(result.error);
    }
  };

  const saveBalanceKey = async (provider: BalanceProvider) => {
    await window.electronAPI?.setBalanceKey?.(provider, provider === 'opencode' ? opencodeKey : deepseekKey);
    await useStore.getState().loadConfig();
  };

  const sectionStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: '14px 16px',
  };
  const titleStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-text)',
    marginBottom: 10,
  };
  const toggleRow = (label: string, checked: boolean, onChange: (value: boolean) => void, locked = false) => (
    <label className={locked ? 'flex items-center justify-between cursor-not-allowed opacity-55' : 'flex items-center justify-between cursor-pointer'}>
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
        {locked && <span className="ml-1.5 text-[10px]" style={{ color: '#fb923c' }}>未授权</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={locked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-indigo-500" />
    </label>
  );
  const featureOk = (key: string) => licenseFeatureAccess[key] !== false;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <Smartphone size={16} style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>SC球设置</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
        {/* SC球设置 */}
        <div style={sectionStyle}>
          <div style={titleStyle}>SC球设置</div>
          <div className="flex flex-col gap-3">
            {toggleRow('启用SC球', island.enabled, (v) => void updateIsland({ enabled: v }))}
            {toggleRow('全屏时自动隐藏', island.autoHideFullscreen, (v) => void updateIsland({ autoHideFullscreen: v }))}
            <div>
              <div className="mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>展示样式</div>
              <div className="grid grid-cols-3 gap-2">
                {(['capsule', 'glass', 'paper'] as IslandStyle[]).map((style) => (
                  <button
                    key={style}
                    onClick={() => void updateIsland({ style })}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs transition-all duration-150"
                    style={{
                      background: island.style === style ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                      border: '1px solid ' + (island.style === style ? 'var(--color-accent)' : 'var(--color-border)'),
                      color: island.style === style ? 'white' : 'var(--color-text-secondary)',
                    }}
                  >
                    <Smartphone size={14} /> {style === 'capsule' ? '胶囊' : style === 'glass' ? '玻璃' : '纸张'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>显示状态</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['collapsed', '收起'],
                  ['mini', '迷你'],
                  ['expanded', '展开'],
                ] as Array<[IslandDisplayState, string]>).map(([displayState, label]) => (
                  <button
                    key={displayState}
                    onClick={() => void updateIsland({ displayState })}
                    className="flex items-center justify-center py-2 rounded-xl text-xs transition-all duration-150"
                    style={{
                      background: (island.displayState || 'collapsed') === displayState ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                      border: '1px solid ' + ((island.displayState || 'collapsed') === displayState ? 'var(--color-accent)' : 'var(--color-border)'),
                      color: (island.displayState || 'collapsed') === displayState ? 'white' : 'var(--color-text-secondary)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              <Film size={14} /> 按住SC球拖动移动位置，Alt+I 显示或隐藏
            </div>
          </div>
        </div>

        {/* 音乐板块设置 */}
        <div style={sectionStyle}>
          <div style={titleStyle}>音乐板块设置</div>
          <div className="flex flex-col gap-3">
            {toggleRow('音乐模块', island.musicEnabled !== false, (v) => void updateIsland({ musicEnabled: v }), !featureOk('island.music'))}
            {toggleRow('歌词逐字跳动', island.lyricBounce !== false, (v) => void updateIsland({ lyricBounce: v }))}
            {toggleRow('播放时光效环绕', island.orbitGlow !== false, (v) => void updateIsland({ orbitGlow: v }))}
            {toggleRow('播放时柱条跳动', island.barsEnabled !== false, (v) => void updateIsland({ barsEnabled: v }))}
          </div>
        </div>

        {/* 任务板块设置 */}
        <div style={sectionStyle}>
          <div style={titleStyle}>任务板块设置</div>
          <div className="flex flex-col gap-3">
            {toggleRow('任务模块', island.tasksEnabled !== false, (v) => void updateIsland({ tasksEnabled: v }), !featureOk('island.tasks'))}
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              <Film size={14} /> Alt+U 可隐藏或显示任务清单球
            </div>
          </div>
        </div>

        {/* 驾驶舱板块设置 */}
        <div style={sectionStyle}>
          <div style={titleStyle}>驾驶舱板块设置</div>
          <div className="flex flex-col gap-3">
            {toggleRow('驾驶舱数据', island.cockpitEnabled === true, (v) => void updateIsland({ cockpitEnabled: v }), !featureOk('island.cockpit'))}
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              <Film size={14} /> 显示 CPU / GPU / 内存占用与温度
            </div>
          </div>
        </div>

        {/* 余额板块设置 */}
        <div style={sectionStyle}>
          <div style={titleStyle}>余额板块设置</div>
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>余额数据源</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['none', '不显示'],
                  ['deepseek', 'DeepSeek'],
                  ['opencode', 'OpenCode Go'],
                ] as Array<[BalanceProvider, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    disabled={!featureOk('island.balance')}
                    onClick={() => void updateIsland({ balanceProvider: value })}
                    className="flex items-center justify-center py-2 rounded-xl text-xs transition-all duration-150 disabled:opacity-40"
                    style={{
                      background: balanceProvider === value ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                      border: '1px solid ' + (balanceProvider === value ? 'var(--color-accent)' : 'var(--color-border)'),
                      color: balanceProvider === value ? 'white' : 'var(--color-text-secondary)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {balanceProvider !== 'none' ? (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={balanceProvider === 'opencode' ? opencodeKey : deepseekKey}
                  onChange={(e) => (balanceProvider === 'opencode' ? setOpencodeKey(e.target.value) : setDeepseekKey(e.target.value))}
                  placeholder={balanceProvider === 'opencode' ? '填写 OpenCode Go API Key' : '填写 DeepSeek API Key'}
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl text-sm outline-none transition-all duration-150"
                  style={{
                    background: 'var(--color-bg-card-hover)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
                <button
                  onClick={() => void saveBalanceKey(balanceProvider)}
                  className="px-4 py-2 rounded-xl text-sm transition-all duration-150"
                  style={{ background: 'var(--color-accent)', color: 'white' }}
                >
                  保存
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              <Film size={14} /> 每分钟自动刷新，播放音乐时右侧分离小球
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
