import { Film, Smartphone } from 'lucide-react';
import { useStore } from '../store';
import { IslandDisplayState, IslandStyle, IslandPosition } from '../types';

export default function IslandPanel() {
  const config = useStore((s) => s.config);
  const island = config.island || {
    enabled: true,
    style: 'capsule' as IslandStyle,
    position: 'top-center' as IslandPosition,
    autoHideFullscreen: true,
    musicEnabled: true,
    tasksEnabled: true,
    cockpitEnabled: false,
    lyricBounce: true,
    orbitGlow: true,
    barsEnabled: true,
    displayState: 'collapsed' as IslandDisplayState,
  };

  const updateIsland = async (updates: Partial<typeof island>) => {
    const next = { ...island, ...updates };
    useStore.setState((s) => ({ config: { ...s.config, island: next } }));
    const result = await window.electronAPI?.setIsland(next.enabled, next.style, next.position, next.autoHideFullscreen, next.musicEnabled !== false, next.lyricBounce !== false, next.displayState || 'collapsed', next.orbitGlow !== false, next.barsEnabled !== false, next.tasksEnabled !== false, next.cockpitEnabled === true);
    if (result && !result.success && result.error) {
      console.error(result.error);
    }
  };

  const sectionStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: '14px 16px',
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <Smartphone size={16} style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>SC球设置</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
        <div style={sectionStyle}>
          <div className="mb-3 flex flex-col gap-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>启用SC球</span>
              <input type="checkbox" checked={island.enabled} onChange={(e) => void updateIsland({ enabled: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>音乐模块</span>
              <input type="checkbox" checked={island.musicEnabled !== false} onChange={(e) => void updateIsland({ musicEnabled: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>任务模块</span>
              <input type="checkbox" checked={island.tasksEnabled !== false} onChange={(e) => void updateIsland({ tasksEnabled: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>驾驶舱数据</span>
              <input type="checkbox" checked={island.cockpitEnabled === true} onChange={(e) => void updateIsland({ cockpitEnabled: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>歌词逐字跳动</span>
              <input type="checkbox" checked={island.lyricBounce !== false} onChange={(e) => void updateIsland({ lyricBounce: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>播放时光效环绕</span>
              <input type="checkbox" checked={island.orbitGlow !== false} onChange={(e) => void updateIsland({ orbitGlow: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>播放时柱条跳动</span>
              <input type="checkbox" checked={island.barsEnabled !== false} onChange={(e) => void updateIsland({ barsEnabled: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>全屏时自动隐藏</span>
              <input type="checkbox" checked={island.autoHideFullscreen} onChange={(e) => void updateIsland({ autoHideFullscreen: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
            </label>
          </div>
        </div>

        <div style={sectionStyle}>
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

        <div style={sectionStyle}>
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
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs transition-all duration-150"
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
          <Film size={14} /> 直接按住SC球拖动即可移动位置，Alt+I 可显示或隐藏
        </div>
      </div>
    </div>
  );
}
