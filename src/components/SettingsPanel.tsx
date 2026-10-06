import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Moon, Sun, Monitor, Download, Upload, Power, ChevronUp, ChevronDown, Eye, EyeOff, ArrowRightLeft } from 'lucide-react';
import { CORE_MODULE_IDS, MODULE_REGISTRY, getModuleGroup, type ModuleMeta } from '../moduleRegistry';
import type { ModuleConfigItem } from '../types';
import BindCard from './BindCard';

interface ModuleRowProps {
  meta: ModuleMeta;
  item: ModuleConfigItem;
  isCore: boolean;
  groupLength: number;
  index: number;
  canMoveGroup: boolean;
  onMove: (direction: -1 | 1) => void;
  onToggleVisible: () => void;
  onToggleEnabled: () => void;
  onMoveGroup: () => void;
}

function ModuleRow({ meta, item, isCore, groupLength, index, canMoveGroup, onMove, onToggleVisible, onToggleEnabled, onMoveGroup }: ModuleRowProps) {
  const Icon = meta.icon;
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-3 py-2.5"
      style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}
    >
      <Icon size={15} style={{ color: item.enabled === false ? 'var(--color-text-muted)' : 'var(--color-accent)' }} />
      <span className="min-w-0 flex-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {meta.label}
        {isCore && <span className="ml-1.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>核心</span>}
      </span>
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-75 disabled:opacity-30"
        style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)' }}
        title="上移"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        disabled={index === groupLength - 1}
        onClick={() => onMove(1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-75 disabled:opacity-30"
        style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)' }}
        title="下移"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        disabled={isCore || !canMoveGroup}
        onClick={onMoveGroup}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-75 disabled:opacity-30"
        style={{
          background: 'var(--color-bg-card)',
          color: item.group === 'primary' ? 'var(--color-text-secondary)' : 'var(--color-accent)',
        }}
        title={isCore ? '核心板块不能移动分组' : (item.group === 'primary' ? '移到“更多菜单”' : '移到“主界面”')}
      >
        <ArrowRightLeft size={13} />
      </button>
      <button
        type="button"
        onClick={onToggleVisible}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-75"
        style={{
          background: 'var(--color-bg-card)',
          color: item.visible === false ? 'var(--color-text-muted)' : 'var(--color-accent)',
        }}
        title={item.visible === false ? '显示该板块' : '隐藏该板块'}
      >
        {item.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button
        type="button"
        disabled={isCore}
        onClick={onToggleEnabled}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-75 disabled:opacity-40"
        style={{
          background: 'var(--color-bg-card)',
          color: item.enabled === false ? 'var(--color-text-muted)' : '#63d391',
        }}
        title={isCore ? '快捷、任务是基础板块，不能禁用' : (item.enabled === false ? '启用该板块' : '禁用该板块并停止后台服务')}
      >
        <Power size={14} />
      </button>
    </div>
  );
}

export default function SettingsPanel() {
  const closeSettings = useStore((s) => s.closeSettings);
  const config = useStore((s) => s.config);
  const setTheme = useStore((s) => s.setTheme);
  const setOpenOnStartup = useStore((s) => s.setOpenOnStartup);
  const exportConfig = useStore((s) => s.exportConfig);
  const importConfig = useStore((s) => s.importConfig);
  const setModuleEnabled = useStore((s) => s.setModuleEnabled);
  const setModuleVisible = useStore((s) => s.setModuleVisible);
  const setModuleOrder = useStore((s) => s.setModuleOrder);
  const setModuleGroup = useStore((s) => s.setModuleGroup);
  const licenseModuleAccess = useStore((s) => s.licenseModuleAccess);
  const { t } = useTranslation();
  // 资源管理器集成 / SC 球穿透 / 文件转换默认项 —— 已迁到「转换板块 → 齿轮设置」，
  // 见 src/components/ConverterSettings.tsx（总设置里不再保留这三段）。
  const themes: { value: 'dark' | 'light' | 'system'; labelKey: string; icon: typeof Moon }[] = [
    { value: 'dark', labelKey: 'settings.theme.dark', icon: Moon },
    { value: 'light', labelKey: 'settings.theme.light', icon: Sun },
    { value: 'system', labelKey: 'settings.theme.system', icon: Monitor },
  ];
  const moduleItems = (config.modules || [])
    .filter((item) => licenseModuleAccess[item.id] !== false)
    .map((item) => {
      const meta = MODULE_REGISTRY.find((entry) => entry.id === item.id);
      return meta ? { meta, item } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  const moveModuleInGroup = (group: 'primary' | 'more', index: number, direction: -1 | 1) => {
    const groupItems = moduleItems.filter((entry) => getModuleGroup(config, entry.meta.id) === group);
    const target = index + direction;
    if (target < 0 || target >= groupItems.length) return;
    const moved = groupItems.map((entry) => entry.meta.id);
    const [removed] = moved.splice(index, 1);
    moved.splice(target, 0, removed);
    const movedIndex = new Map(moved.map((id, idx) => [id, idx]));
    const orderedIds = moduleItems.map((entry) => {
      const movedId = movedIndex.get(entry.meta.id);
      return movedId === undefined ? entry.meta.id : moved[movedId];
    });
    setModuleOrder(orderedIds);
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

            {/* 资源管理器集成 / SC 球 / 文件转换 已迁到「转换板块 → 齿轮设置」 */}

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

            {/* Module management */}
            <div style={sectionStyle}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>板块管理</h3>
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>显示 / 启用 / 顺序</span>
              </div>
              <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                隐藏后不显示入口，禁用后会停止对应后台服务以节省内存。
              </p>
              <div className="flex flex-col gap-3">
                {([
                  { group: 'primary', title: '主界面板块', description: '直接展示在左侧主栏' },
                  { group: 'more', title: '更多菜单板块', description: '收进左侧“更多”菜单' },
                ] as const).map(({ group, title, description }) => {
                  const groupItems = moduleItems.filter((entry) => getModuleGroup(config, entry.meta.id) === group);
                  return (
                    <div
                      key={group}
                      className="rounded-xl p-3"
                      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{title}</span>
                        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{description}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {groupItems.map(({ meta, item }, index) => (
                          <ModuleRow
                            key={meta.id}
                            meta={meta}
                            item={item}
                            isCore={CORE_MODULE_IDS.includes(meta.id)}
                            groupLength={groupItems.length}
                            index={index}
                            canMoveGroup={!CORE_MODULE_IDS.includes(meta.id)}
                            onMove={(direction) => moveModuleInGroup(group, index, direction)}
                            onToggleVisible={() => setModuleVisible(meta.id, item.visible !== false ? false : true)}
                            onToggleEnabled={() => setModuleEnabled(meta.id, item.enabled !== false ? false : true)}
                            onMoveGroup={() => setModuleGroup(meta.id, group === 'primary' ? 'more' : 'primary')}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 联动绑定 */}
            <BindCard />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
