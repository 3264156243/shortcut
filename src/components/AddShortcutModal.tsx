import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AppWindow, File, Folder, Globe, ImagePlus, Layers3, Plus, ShieldCheck, SquareTerminal, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { ShortcutTarget, ShortcutTargetType, ShortcutType } from '../types';

const types: Array<{ type: ShortcutType; label: string; icon: typeof AppWindow }> = [
  { type: 'app', label: '程序', icon: AppWindow }, { type: 'folder', label: '文件夹', icon: Folder },
  { type: 'file', label: '文件', icon: File }, { type: 'url', label: '网页', icon: Globe },
  { type: 'group', label: '快捷方式组', icon: Layers3 }, { type: 'bat', label: 'BAT 文件', icon: SquareTerminal },
];
const targetTypes: Array<{ type: ShortcutTargetType; label: string }> = [
  { type: 'app', label: '程序' }, { type: 'folder', label: '文件夹' }, { type: 'file', label: '文件' }, { type: 'url', label: '网页' },
];
const hasScheme = (value: string) => /^https?:\/\//i.test(value.trim());
const normalizeUrl = (value: string) => hasScheme(value) ? value.trim() : `https://${value.trim()}`;
const looksLikeUrl = (value: string) => hasScheme(value) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i.test(value.trim());
const newTarget = (): ShortcutTarget => ({ id: crypto.randomUUID(), name: '', type: 'app', targetPath: '' });

export default function AddShortcutModal() {
  const close = useStore((state) => state.closeAddModal);
  const addShortcut = useStore((state) => state.addShortcut);
  const updateShortcut = useStore((state) => state.updateShortcut);
  const editing = useStore((state) => state.editingShortcut);
  const groupId = useStore((state) => state.editingGroupId) || '';
  const tabId = useStore((state) => state.activeTabId);
  const addToast = useStore((state) => state.addToast);
  const [type, setType] = useState<ShortcutType>(editing?.type || 'app');
  const [name, setName] = useState(editing?.name || '');
  const [targetPath, setTargetPath] = useState(editing?.targetPath || '');
  const [remark, setRemark] = useState(editing?.remark || '');
  const [icon, setIcon] = useState(editing?.icon || '');
  const [manualIcon, setManualIcon] = useState(!!editing?.icon);
  const [targets, setTargets] = useState<ShortcutTarget[]>(editing?.targets?.length ? editing.targets : [newTarget()]);
  const [batContent, setBatContent] = useState(editing?.batContent || '');
  const [runAsAdmin, setRunAsAdmin] = useState(!!editing?.runAsAdmin);

  useEffect(() => {
    if (manualIcon || !targetPath.trim() || type === 'group' || type === 'bat') return;
    if (type === 'url') {
      const timer = window.setTimeout(() => {
        const normalized = normalizeUrl(targetPath);
        const iconUrl = (() => {
          try { return new URL(normalized).origin; } catch { return normalized; }
        })();
        window.electronAPI?.getWebsiteIcon(iconUrl).then((value) => value && setIcon(value)).catch(() => undefined);
      }, 350);
      return () => window.clearTimeout(timer);
    }
    window.electronAPI?.getFileIcon(targetPath.trim()).then((value) => value && setIcon(value)).catch(() => undefined);
  }, [manualIcon, targetPath, type]);

  const browse = async (targetType: ShortcutTargetType = type as ShortcutTargetType, targetId?: string) => {
    if (targetType === 'url') return;
    const path = targetType === 'folder' ? await window.electronAPI?.openFolder() : await window.electronAPI?.openFile();
    if (!path) return;
    if (targetId) setTargets((items) => items.map((item) => item.id === targetId ? { ...item, targetPath: path, name: item.name || path.split(/[\\/]/).pop() || '' } : item));
    else { setTargetPath(path); setName((current) => current || path.split(/[\\/]/).pop() || ''); setManualIcon(false); }
  };
  const chooseIcon = async () => { const value = await window.electronAPI?.openIconFile(); if (value) { setIcon(value); setManualIcon(true); } };
  const updateTarget = (id: string, updates: Partial<ShortcutTarget>) => setTargets((items) => items.map((item) => item.id === id ? { ...item, ...updates } : item));

  const submit = () => {
    const title = name.trim();
    if (!title || !groupId) { addToast('请填写名称', 'error'); return; }
    let finalType = type;
    let finalPath = targetPath.trim();
    let finalTargets: ShortcutTarget[] | undefined;
    if (type === 'group') {
      finalTargets = targets.map((item) => ({ ...item, name: item.name.trim() || item.targetPath.trim(), targetPath: item.type === 'url' ? normalizeUrl(item.targetPath) : item.targetPath.trim() })).filter((item) => item.targetPath);
      if (!finalTargets.length) { addToast('请至少添加一个有效目标', 'error'); return; }
      finalPath = '快捷方式组';
    } else if (type === 'bat') {
      if (!batContent.trim()) { addToast('请填写 BAT 内容', 'error'); return; }
      finalPath = 'BAT 脚本';
    } else {
      if (!finalPath) { addToast('请填写目标路径或网址', 'error'); return; }
      if (type === 'url' || looksLikeUrl(finalPath)) { finalType = 'url'; finalPath = normalizeUrl(finalPath); }
    }
    const data = { name: title, type: finalType, targetPath: finalPath, targets: finalTargets, batContent: type === 'bat' ? batContent : undefined, runAsAdmin: type === 'bat' ? runAsAdmin : undefined, remark: remark.trim() || undefined, icon: icon || undefined };
    if (editing) updateShortcut(tabId, groupId, editing.id, data); else addShortcut(tabId, groupId, data);
    addToast(editing ? '快捷方式已更新' : '快捷方式已添加', 'success'); close();
  };
  const inputClass = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';
  const inputStyle = { background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" style={{ background: 'var(--color-overlay)' }} onClick={close}>
    <motion.section initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', boxShadow: '0 24px 70px var(--color-shadow)' }} onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--color-border)' }}><h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{editing ? '编辑快捷方式' : '新增快捷方式'}</h2><button onClick={close} className="flex h-8 w-8 items-center justify-center rounded-md"><X size={18} /></button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <div><label className="mb-2 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>类型</label><div className="grid grid-cols-3 gap-2">{types.map(({ type: value, label, icon: Icon }) => <button key={value} onClick={() => setType(value)} className="flex h-10 items-center justify-center gap-2 rounded-md text-sm" style={{ background: type === value ? 'var(--color-accent)' : 'var(--color-bg-card)', border: `1px solid ${type === value ? 'var(--color-accent)' : 'var(--color-border)'}`, color: type === value ? 'white' : 'var(--color-text-secondary)' }}><Icon size={15} />{label}</button>)}</div></div>
        <label className="block"><span className="mb-2 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>名称</span><input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} style={inputStyle} placeholder={type === 'group' ? '例如：开始工作' : type === 'bat' ? '例如：清理缓存' : '快捷方式名称'} /></label>
        {type === 'group' ? <div><div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>组内目标</span><button onClick={() => setTargets((items) => [...items, newTarget()])} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs" style={{ color: 'var(--color-accent)' }}><Plus size={13} />添加</button></div><div className="space-y-2">{targets.map((item) => <div key={item.id} className="grid grid-cols-[90px_1fr_34px_34px] gap-2 rounded-md p-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><select value={item.type} onChange={(event) => updateTarget(item.id, { type: event.target.value as ShortcutTargetType })} className="rounded-md border px-2 text-xs outline-none" style={inputStyle}>{targetTypes.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}</select><input value={item.targetPath} onChange={(event) => updateTarget(item.id, { targetPath: event.target.value })} className={inputClass} style={inputStyle} placeholder={item.type === 'url' ? '网址' : '目标路径'} />{item.type !== 'url' ? <button onClick={() => void browse(item.type, item.id)} className="flex items-center justify-center rounded-md" title="浏览"><Folder size={15} /></button> : <span /> }<button onClick={() => setTargets((items) => items.filter((target) => target.id !== item.id))} className="flex items-center justify-center rounded-md" style={{ color: 'var(--color-danger)' }} title="移除"><Trash2 size={15} /></button></div>)}</div></div> : type === 'bat' ? <div className="space-y-3"><label className="block"><span className="mb-2 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>BAT 内容</span><textarea value={batContent} onChange={(event) => setBatContent(event.target.value)} rows={10} spellCheck={false} className={`${inputClass} resize-y font-mono leading-6`} style={inputStyle} placeholder={'例如：\necho Hello\npause'} /></label><label className="flex cursor-pointer items-center justify-between rounded-md p-3" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><span className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}><ShieldCheck size={17} />一键管理员运行</span><input type="checkbox" checked={runAsAdmin} onChange={(event) => setRunAsAdmin(event.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /></label></div> : <label className="block"><span className="mb-2 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{type === 'url' ? '网址' : '目标路径'}</span><div className="flex gap-2"><input value={targetPath} onChange={(event) => setTargetPath(event.target.value)} onBlur={() => { if (type === 'url' && targetPath.trim()) setTargetPath(normalizeUrl(targetPath)); }} className={inputClass} style={inputStyle} placeholder={type === 'url' ? 'example.com' : '选择或输入路径'} />{type !== 'url' && <button onClick={() => void browse()} className="shrink-0 rounded-md px-3 text-sm" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>浏览</button>}</div></label>}
        <div><span className="mb-2 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>图标</span><div className="flex items-center gap-2"><div className="flex h-10 w-10 items-center justify-center rounded-md" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>{icon ? <img src={icon} alt="" className="h-7 w-7 object-contain" /> : <ImagePlus size={18} />}</div><button onClick={() => void chooseIcon()} className="rounded-md px-3 py-2 text-xs" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>选择图标</button>{icon && <button onClick={() => { setIcon(''); setManualIcon(false); }} className="text-xs" style={{ color: 'var(--color-accent)' }}>恢复自动</button>}</div></div>
        <label className="block"><span className="mb-2 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>备注</span><input value={remark} onChange={(event) => setRemark(event.target.value)} className={inputClass} style={inputStyle} placeholder="可选" /></label>
      </div>
      <footer className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--color-border)' }}><button onClick={close} className="rounded-md px-4 py-2 text-sm" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>取消</button><button onClick={submit} className="rounded-md px-5 py-2 text-sm text-white" style={{ background: 'var(--color-accent)' }}>{editing ? '保存修改' : '添加'}</button></footer>
    </motion.section>
  </div>;
}
