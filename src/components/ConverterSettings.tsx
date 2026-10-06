import { useEffect, useState } from 'react';
import { X, FolderTree, CircleDot, FileCog } from 'lucide-react';
import { useStore } from '../store';

/**
 * 转换板块的「设置」弹窗（需求：把这些设置从"总设置"迁到转换板块内）。
 * 迁移范围 = 原总设置里的：资源管理器集成 / SC 球 / 文件转换 三段（含交互逻辑）。
 * 由 ConverterPanel 的齿轮按钮打开。
 */

// 注意：这里必须用**不透明**的颜色。
// 之前用了 `var(--color-bg-panel)`，而 index.css 里根本没有这个变量 → 背景解析失败 = 全透明，
// 弹窗上下两层文字会叠在一起看不清。--color-bg-secondary/tertiary 在两个主题下都是实色。
const sectionStyle: React.CSSProperties = {
  background: 'var(--color-bg-tertiary)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  padding: '12px 14px',
};

const selectStyle: React.CSSProperties = {
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)',
};

export default function ConverterSettings({ onClose }: { onClose: () => void }) {
  // ── 资源管理器集成（仅 Windows；注册表为准，打开时读一次）──
  const [shellMenu, setShellMenu] = useState<{ available: boolean; enabled: boolean; format: string; formats?: string[] }>(
    { available: false, enabled: false, format: 'zip' },
  );
  const [shellMenuBusy, setShellMenuBusy] = useState(false);
  const [shellMenuError, setShellMenuError] = useState('');
  useEffect(() => {
    void window.electronAPI?.shellMenuState?.().then((s) => s && setShellMenu(s));
  }, []);
  const setShellMenuEnabled = async (enabled: boolean, format?: string) => {
    setShellMenuBusy(true);
    setShellMenuError('');
    const fmt = format || shellMenu.format;
    const res = await window.electronAPI?.shellMenuSet?.(enabled, fmt);
    if (res && res.success === false) setShellMenuError(res.error || '设置失败');
    const s = await window.electronAPI?.shellMenuState?.();
    if (s) setShellMenu(s);
    setShellMenuBusy(false);
  };

  // ── SC 球（岛）穿透 ──
  const [ballThrough, setBallThrough] = useState(false);
  const [ballShortcut, setBallShortcut] = useState('Ctrl+Alt+B');
  useEffect(() => {
    void window.electronAPI?.ballState?.().then((s) => {
      if (!s) return;
      setBallThrough(!!s.passthrough);
      if (s.shortcut) setBallShortcut(s.shortcut);
    });
    return window.electronAPI?.onBallPassthrough?.((d) => setBallThrough(!!d?.on));
  }, []);
  const toggleBallThrough = async (on: boolean) => {
    setBallThrough(on);
    const res = await window.electronAPI?.ballPassthrough?.(on);
    if (res && res.success === false) setBallThrough(!on);
  };

  // ── 文件转换默认项（岛按钮与转换面板共用同一份 config.converter.*）──
  const [converterCfg, setConverterCfgState] = useState<{
    defaultCompress: string; defaultImage: string; defaultAudio: string; autoReveal: boolean;
  }>({ defaultCompress: 'zip', defaultImage: 'png', defaultAudio: 'wav', autoReveal: true });
  useEffect(() => {
    void window.electronAPI?.readConfig?.().then((raw) => {
      if (!raw) return;
      try {
        const conv = JSON.parse(raw)?.converter || {};
        setConverterCfgState((c) => ({
          defaultCompress: conv.defaultCompress || c.defaultCompress,
          defaultImage: conv.defaultImage || c.defaultImage,
          defaultAudio: conv.defaultAudio || c.defaultAudio,
          autoReveal: conv.autoReveal !== false,
        }));
      } catch {}
    });
  }, []);
  const setConverterCfg = (patch: Partial<typeof converterCfg>) => {
    setConverterCfgState((c) => {
      const next = { ...c, ...patch };
      useStore.setState((s) => ({ config: { ...s.config, converter: next } }));
      useStore.getState().saveConfig();
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,.5)' }}>
      <div
        className="flex max-h-[86%] w-[520px] max-w-[92%] flex-col overflow-hidden rounded-2xl"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <FileCog size={16} style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>转换设置</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-all duration-150 hover:opacity-80"
            style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {/* 文件转换默认项 */}
          <div style={sectionStyle}>
            <div className="mb-1 flex items-center gap-2">
              <FileCog size={14} style={{ color: 'var(--color-text-muted)' }} />
              <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>文件转换</h3>
            </div>
            <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              拖文件到 SC 球（岛）上时，椭圆按钮里的默认格式取这里的设置。
            </p>
            <label className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>压缩默认格式</span>
              <select value={converterCfg.defaultCompress} onChange={(e) => setConverterCfg({ defaultCompress: e.target.value })}
                className="rounded-lg px-2 py-1.5 text-xs" style={selectStyle}>
                {['zip', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst'].map((f) => (
                  <option key={f} value={f}>{f.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <label className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>图片默认格式</span>
              <select value={converterCfg.defaultImage} onChange={(e) => setConverterCfg({ defaultImage: e.target.value })}
                className="rounded-lg px-2 py-1.5 text-xs" style={selectStyle}>
                {['png', 'jpg', 'webp', 'bmp', 'gif', 'tiff', 'ico'].map((f) => (
                  <option key={f} value={f}>{f.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <label className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>音频默认格式</span>
              <select value={converterCfg.defaultAudio} onChange={(e) => setConverterCfg({ defaultAudio: e.target.value })}
                className="rounded-lg px-2 py-1.5 text-xs" style={selectStyle}>
                {['wav', 'mp3', 'flac', 'opus'].map((f) => (
                  <option key={f} value={f}>{f.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>转换完成后自动打开目录</span>
              <input type="checkbox" checked={converterCfg.autoReveal} onChange={(e) => setConverterCfg({ autoReveal: e.target.checked })}
                className="h-4 w-4 accent-indigo-500" />
            </label>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>打开目录时会自动选中刚生成的产物。</p>
          </div>

          {/* SC 球（岛） */}
          <div style={sectionStyle}>
            <div className="mb-1 flex items-center gap-2">
              <CircleDot size={14} style={{ color: 'var(--color-text-muted)' }} />
              <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>SC 球</h3>
            </div>
            <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              SC 球 = 屏幕上显示余额/歌词/时间的岛。拖文件到岛上可直接转换（松手后岛内出现按钮）。
              「启用穿透」= 点击落在岛下面的窗口上（不挡桌面操作）；旁边小球跟随同一状态。
              不管是否开启穿透，拖文件到岛上都会自动临时解除穿透接收文件。
            </p>
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>启用穿透</span>
              <input type="checkbox" checked={ballThrough} onChange={(e) => void toggleBallThrough(e.target.checked)}
                className="h-4 w-4 accent-indigo-500" />
            </label>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              当前：{ballThrough ? '已穿透（岛 + 旁边小球都不挡鼠标）' : '未穿透（收起态仍按岛的显示状态：收起穿透、展开可交互）'} · 快捷键 {ballShortcut}
            </p>
          </div>

          {/* 资源管理器集成（仅 Windows） */}
          {shellMenu.available && (
            <div style={sectionStyle}>
              <div className="mb-1 flex items-center gap-2">
                <FolderTree size={14} style={{ color: 'var(--color-text-muted)' }} />
                <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>资源管理器集成</h3>
              </div>
              <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                在当前用户下注册右键菜单，无需管理员权限；关闭即删除注册表项。
                点菜单项直接执行，不打开面板：文件/文件夹 → 压缩为所选格式（生成在同目录），压缩包 → 解压到同名文件夹。
              </p>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>右键菜单：压缩 / 解压</span>
                <input type="checkbox" checked={shellMenu.enabled} disabled={shellMenuBusy}
                  onChange={(e) => setShellMenuEnabled(e.target.checked, shellMenu.format)}
                  className="h-4 w-4 accent-indigo-500" />
              </label>
              <label className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>默认压缩格式</span>
                <select value={shellMenu.format} disabled={shellMenuBusy}
                  onChange={(e) => setShellMenuEnabled(shellMenu.enabled || true, e.target.value)}
                  className="rounded-lg px-2 py-1.5 text-xs" style={selectStyle}>
                  {(shellMenu.formats || ['zip']).map((f) => (
                    <option key={f} value={f}>{f.toUpperCase()}</option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                菜单文字会随格式变化（如「压缩为 TAR.GZ（ShortCut）」）。改格式会自动重写菜单项。
              </p>
              {shellMenuError && <p className="mt-2 text-xs" style={{ color: '#f87171' }}>{shellMenuError}</p>}
            </div>
          )}

          <p className="pb-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            这些设置原在「总设置」里，现已迁到转换板块（齿轮按钮）。
          </p>
        </div>
      </div>
    </div>
  );
}
