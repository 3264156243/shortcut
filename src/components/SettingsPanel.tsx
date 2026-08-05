import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { PanelAnimation } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Moon, Sun, Monitor, Download, Upload, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Maximize, Power, Smartphone, Move, Film } from 'lucide-react';
import { IslandStyle, IslandPosition } from '../types';

export default function SettingsPanel() {
  const closeSettings = useStore((s) => s.closeSettings);
  const config = useStore((s) => s.config);
  const setTheme = useStore((s) => s.setTheme);
  const setPanelAnimation = useStore((s) => s.setPanelAnimation);
  const setOpenOnStartup = useStore((s) => s.setOpenOnStartup);
  const exportConfig = useStore((s) => s.exportConfig);
  const importConfig = useStore((s) => s.importConfig);
  const { t } = useTranslation();
  const themes: { value: 'dark' | 'light' | 'system'; labelKey: string; icon: typeof Moon }[] = [
    { value: 'dark', labelKey: 'settings.theme.dark', icon: Moon },
    { value: 'light', labelKey: 'settings.theme.light', icon: Sun },
    { value: 'system', labelKey: 'settings.theme.system', icon: Monitor },
  ];


  const animations: { value: PanelAnimation; labelKey: string; icon: typeof ArrowDown }[] = [
    { value: 'bottom', labelKey: 'settings.animation.bottom', icon: ArrowDown },
    { value: 'top', labelKey: 'settings.animation.top', icon: ArrowUp },
    { value: 'left', labelKey: 'settings.animation.left', icon: ArrowLeft },
    { value: 'right', labelKey: 'settings.animation.right', icon: ArrowRight },
    { value: 'center', labelKey: 'settings.animation.center', icon: Maximize },
  ];

  const island = config.island || { enabled: true, style: 'capsule' as IslandStyle, position: 'top-center' as IslandPosition, autoHideFullscreen: true, musicEnabled: true };
  const updateIsland = async (updates: Partial<typeof island>) => {
    const next = { ...island, ...updates };
    useStore.setState((s) => ({ config: { ...s.config, island: next } }));
    await useStore.getState().saveConfig();
    const result = await window.electronAPI?.setIsland(next.enabled, next.style, next.position, next.autoHideFullscreen, next.musicEnabled !== false);
    if (result && !result.success && result.error) {
      console.error(result.error);
    }
  };
  const sectionStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'var(--color-overlay)' }}
        onClick={closeSettings}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 20px 60px var(--color-shadow)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 flex items-center justify-between p-5 pb-3" style={{ background: 'var(--color-bg-secondary)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{t('settings.title')}</h2>
            <button onClick={closeSettings} className="p-1.5 rounded-lg hover:opacity-80 transition-opacity" style={{ color: 'var(--color-text-muted)' }}>
              <X size={18} />
            </button>
          </div>
          <div className="px-5 pb-5 flex flex-col gap-4">
            {/* Theme */}
            <div style={sectionStyle}>
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>{t('settings.theme')}</h3>
              <div className="flex gap-2">
                {themes.map(({ value, labelKey, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all duration-150"
                    style={{
                      background: config.theme === value ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                      border: `1px solid ${config.theme === value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      color: config.theme === value ? 'white' : 'var(--color-text-secondary)',
                    }}
                  >
                    <Icon size={16} /> {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Animation */}
            <div style={sectionStyle}>
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>{t('settings.animation')}</h3>
              <div className="grid grid-cols-3 gap-2">
                {animations.map(({ value, labelKey, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setPanelAnimation(value)}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs transition-all duration-150"
                    style={{
                      background: (config.panelAnimation || 'bottom') === value ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                      border: `1px solid ${(config.panelAnimation || 'bottom') === value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      color: (config.panelAnimation || 'bottom') === value ? 'white' : 'var(--color-text-secondary)',
                    }}
                  >
                    <Icon size={14} /> {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Behavior */}
            <div style={sectionStyle}>
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>{t('settings.behavior')}</h3>
              <div className="flex flex-col gap-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.closeOnBlur')}</span>
                  <input type="checkbox" checked={config.closeOnBlur} onChange={(e) => {
                    useStore.setState((s) => ({ config: { ...s.config, closeOnBlur: e.target.checked } }));
                    useStore.getState().saveConfig();
                  }} className="w-4 h-4 accent-indigo-500" />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.rememberSize')}</span>
                  <input type="checkbox" checked={config.rememberWindowSize} onChange={(e) => {
                    useStore.setState((s) => ({ config: { ...s.config, rememberWindowSize: e.target.checked } }));
                    useStore.getState().saveConfig();
                  }} className="w-4 h-4 accent-indigo-500" />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    <Power size={15} style={{ color: 'var(--color-text-muted)' }} />
                    {t('settings.openOnStartup')}
                  </span>
                  <input
                    type="checkbox"
                    checked={config.openOnStartup}
                    onChange={(e) => setOpenOnStartup(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500"
                  />
                </label>
              </div>
            </div>

            {/* Dynamic island */}
            <div style={sectionStyle}>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Smartphone size={16} style={{ color: 'var(--color-accent)' }} /> 灵动岛
              </h3>
              <div className="flex flex-col gap-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>启用灵动岛</span>
                  <input type="checkbox" checked={island.enabled} onChange={(e) => void updateIsland({ enabled: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>全屏时自动隐藏</span>
                  <input type="checkbox" checked={island.autoHideFullscreen} onChange={(e) => void updateIsland({ autoHideFullscreen: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>音乐模块</span>
                  <input type="checkbox" checked={island.musicEnabled !== false} onChange={(e) => void updateIsland({ musicEnabled: e.target.checked })} className="w-4 h-4 accent-indigo-500" />
                </label>
                <div>
                  <div className="mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>展示样式</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['capsule','glass','paper'] as IslandStyle[]).map((style) => (
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
                  <div className="mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>显示位置</div>
                  <div className="grid grid-cols-3 gap-2">
                    {([['top-center','顶部居中'],['top-left','左上'],['top-right','右上'],['left-center','左侧居中'],['right-center','右侧居中']] as Array<[IslandPosition,string]>).map(([position,label]) => (
                      <button
                        key={position}
                        onClick={() => void updateIsland({ position })}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs transition-all duration-150"
                        style={{
                          background: island.position === position ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                          border: '1px solid ' + (island.position === position ? 'var(--color-accent)' : 'var(--color-border)'),
                          color: island.position === position ? 'white' : 'var(--color-text-secondary)',
                        }}
                      >
                        <Move size={14} /> {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                  <Film size={14} /> 可用 Alt+I 快捷键显示或隐藏
                </div>
              </div>
            </div>

            {/* Data */}
            <div style={sectionStyle}>
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>{t('settings.data')}</h3>
              <div className="flex gap-2">
                <button onClick={exportConfig} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all duration-150 hover:opacity-80" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <Download size={16} /> {t('settings.export')}
                </button>
                <button onClick={importConfig} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all duration-150 hover:opacity-80" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <Upload size={16} /> {t('settings.import')}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
