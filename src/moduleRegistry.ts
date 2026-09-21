import {
  BarChart3,
  Bot,
  CheckSquare,
  Gauge,
  Grid2X2,
  KeyRound,
  Languages,
  Mic,
  MonitorSmartphone,
  Send,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { AppConfig, ModuleConfigItem, ModuleId } from './types';

export interface ModuleMeta {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  group: 'primary' | 'more';
  defaultEnabled: boolean;
  defaultVisible: boolean;
}

export const MODULE_REGISTRY: ModuleMeta[] = [
  { id: 'shortcuts', label: '快捷', icon: Grid2X2, group: 'primary', defaultEnabled: true, defaultVisible: true },
  { id: 'tasks', label: '任务', icon: CheckSquare, group: 'primary', defaultEnabled: true, defaultVisible: true },
  { id: 'cockpit', label: '驾驶舱', icon: Gauge, group: 'primary', defaultEnabled: true, defaultVisible: true },
  { id: 'translate', label: '翻译', icon: Languages, group: 'primary', defaultEnabled: true, defaultVisible: true },
  { id: 'fileTransfer', label: '快传', icon: Send, group: 'primary', defaultEnabled: true, defaultVisible: true },
  { id: 'usage', label: '统计', icon: BarChart3, group: 'more', defaultEnabled: true, defaultVisible: true },
  { id: 'island', label: 'SC球', icon: Smartphone, group: 'more', defaultEnabled: true, defaultVisible: true },
  { id: 'codexProvider', label: '供应商', icon: Bot, group: 'more', defaultEnabled: true, defaultVisible: true },
  { id: 'activation', label: '激活', icon: KeyRound, group: 'more', defaultEnabled: true, defaultVisible: true },
  { id: 'voiceInput', label: '语音', icon: Mic, group: 'more', defaultEnabled: true, defaultVisible: true },
  { id: 'control', label: '控制', icon: MonitorSmartphone, group: 'more', defaultEnabled: true, defaultVisible: true },
];

export const CORE_MODULE_IDS: ModuleId[] = ['shortcuts', 'tasks'];

const MODULE_IDS: ModuleId[] = MODULE_REGISTRY.map((item) => item.id);

export function normalizeModuleConfig(raw?: ModuleConfigItem[]): ModuleConfigItem[] {
  const items = raw || [];
  const seen = new Set<string>();
  const list: ModuleConfigItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const meta = MODULE_REGISTRY.find((entry) => entry.id === item.id);
    list.push({
      id: item.id,
      enabled: item.enabled !== false,
      visible: item.visible !== false,
      group: item.group === 'primary' || item.group === 'more' ? item.group : meta?.group,
    });
  }
  for (const meta of MODULE_REGISTRY) {
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    const item: ModuleConfigItem = {
      id: meta.id,
      enabled: meta.defaultEnabled,
      visible: meta.defaultVisible,
      group: meta.group,
    };
    if (meta.id === 'fileTransfer') {
      const translateIndex = list.findIndex((entry) => entry.id === 'translate');
      list.splice(translateIndex >= 0 ? translateIndex + 1 : list.length, 0, item);
    } else {
      list.push(item);
    }
  }
  return list;
}

export function getModuleGroup(config: AppConfig, id: ModuleId): 'primary' | 'more' {
  const meta = MODULE_REGISTRY.find((entry) => entry.id === id);
  const item = normalizeModuleConfig(config?.modules).find((entry) => entry.id === id);
  return (item?.group === 'primary' || item?.group === 'more') ? item.group : (meta?.group || 'more');
}

export function getAvailableModuleIds(config: AppConfig): ModuleId[] {
  const configured = normalizeModuleConfig(config?.modules);
  return configured
    .filter((item) => item.id !== 'usageManage' && item.enabled !== false && item.visible !== false)
    .map((item) => item.id);
}

export function getModuleConfigItem(config: AppConfig, id: ModuleId): ModuleConfigItem | undefined {
  return normalizeModuleConfig(config?.modules).find((item) => item.id === id);
}

export function reorderModuleConfig(items: ModuleConfigItem[], orderedIds: ModuleId[]): ModuleConfigItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is ModuleConfigItem => !!item);
  for (const item of items) {
    if (!ordered.some((entry) => entry.id === item.id)) ordered.push(item);
  }
  return ordered;
}

export { MODULE_IDS };
