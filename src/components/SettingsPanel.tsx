import { useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { Locale, PanelAnimation } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Moon, Sun, Monitor, Download, Upload, Keyboard, Globe, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Maximize } from 'lucide-react';

export default function SettingsPanel() {
  const closeSettings = useStore((s) => s.closeSettings);
  const config = useStore((s) => s.config);
  const setTheme = useStore((s) => s.setTheme);
  const setLocale = useStore((s) => s.setLocale);
  const setPanelAnimation = useStore((s) => s.setPanelAnimation);
  const exportConfig = useStore((s) => s.exportConfig);
  const importConfig = useStore((s) => s.importConfig);
  const { t } = useTranslation();

  const themes: { value: 'dark' | 'light' | 'system'; labelKey: string; icon: typeof Moon }[] = [
    { value: 'dark', labelKey: 'settings.theme.dark', icon: Moon },
    { value: 'light', labelKey: 'settings.theme.light', icon: Sun },
    { value: 'system', labelKey: 'settings.theme.system', icon: Monitor },
  ];

  const locales: { value: Locale; label: string }[] = [
    { value: 'zh-CN', label: t('settings.language.zhCN') },
    { value: 'en', label: t('settings.language.en') },
  ];

  const animations: { value: PanelAnimation; labelKey: string; icon: typeof ArrowDown }[] = [
    { value: 'bottom', labelKey: 'settings.animation.bottom', icon: ArrowDown },
    { value: 'top', labelKey: 'settings.animation.top', icon: ArrowUp },
    { value: 'left', labelKey: 'settings.animation.left', icon: ArrowLeft },
    { value: 'right', labelKey: 'settings.animation.right', icon: ArrowRight },
    { value: 'center', labelKey: 'settings.animation.center', icon: Maximize },
  ];

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

            {/* Language */}
            <div style={sectionStyle}>
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>{t('settings.language')}</h3>
              <div className="flex gap-2">
                {locales.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setLocale(value)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all duration-150"
                    style={{
                      background: (config.locale || 'zh-CN') === value ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
                      border: `1px solid ${(config.locale || 'zh-CN') === value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      color: (config.locale || 'zh-CN') === value ? 'white' : 'var(--color-text-secondary)',
                    }}
                  >
                    <Globe size={16} /> {label}
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

            {/* Hotkey */}
            <div style={sectionStyle}>
              <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>{t('settings.hotkey')}</h3>
              <div className="flex items-center gap-2">
                <Keyboard size={16} style={{ color: 'var(--color-text-muted)' }} />
                <span className="text-sm px-3 py-1 rounded-lg font-mono" style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-accent)' }}>
                  {config.globalHotkey}
                </span>
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
            <div className="text-center py-2">
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('settings.version')}</p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
