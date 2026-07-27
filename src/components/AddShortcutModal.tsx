import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { ShortcutType } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AppWindow, Folder, File, Globe, FolderOpen, ImagePlus } from 'lucide-react';

const SHORTCUT_TYPES: { type: ShortcutType; labelKey: string; icon: typeof AppWindow }[] = [
  { type: 'app', labelKey: 'modal.type.app', icon: AppWindow },
  { type: 'folder', labelKey: 'modal.type.folder', icon: Folder },
  { type: 'file', labelKey: 'modal.type.file', icon: File },
  { type: 'url', labelKey: 'modal.type.url', icon: Globe },
];

export default function AddShortcutModal() {
  const closeAddModal = useStore((s) => s.closeAddModal);
  const addShortcut = useStore((s) => s.addShortcut);
  const updateShortcut = useStore((s) => s.updateShortcut);
  const editingShortcut = useStore((s) => s.editingShortcut);
  const editingGroupId = useStore((s) => s.editingGroupId);
  const activeTabId = useStore((s) => s.activeTabId);
  const addToast = useStore((s) => s.addToast);
  const { t } = useTranslation();

  const isEditing = !!editingShortcut;

  const [type, setType] = useState<ShortcutType>(editingShortcut?.type || 'app');
  const [name, setName] = useState(editingShortcut?.name || '');
  const [targetPath, setTargetPath] = useState(editingShortcut?.targetPath || '');
  const [remark, setRemark] = useState(editingShortcut?.remark || '');
  const [icon, setIcon] = useState(editingShortcut?.icon || '');
  const [iconManuallySet, setIconManuallySet] = useState(!!editingShortcut?.icon);

  useEffect(() => {
    // Auto-detect type from pasted URL
    if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
      setType('url');
      if (!name) {
        try {
          setName(new URL(targetPath).hostname);
        } catch {}
      }
    }
  }, [targetPath]);
  useEffect(() => {
    if (!targetPath.trim() || iconManuallySet) return;

    if (type === 'url') {
      try {
        const url = new URL(targetPath.trim());
        setIcon(`https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`);
      } catch {}
      return;
    }

    const api = window.electronAPI;
    if (api?.getFileIcon) {
      api.getFileIcon(targetPath.trim()).then((iconDataUrl) => {
        if (iconDataUrl) setIcon(iconDataUrl);
      }).catch(() => {
        // The card type icon remains as fallback.
      });
    }
  }, [iconManuallySet, targetPath, type]);

  const handleChooseIcon = async () => {
    const api = window.electronAPI;
    if (!api?.openIconFile) return;
    const iconDataUrl = await api.openIconFile();
    if (iconDataUrl) {
      setIcon(iconDataUrl);
      setIconManuallySet(true);
    }
  };

  const handleClearIcon = () => {
    setIcon('');
    setIconManuallySet(false);
  };

  const handleBrowse = async () => {
    const api = window.electronAPI;
    if (!api) return;
    const path = type === 'folder' ? await api.openFolder() : await api.openFile();
    if (path) {
      setTargetPath(path);
      if (!name) {
        const parts = path.split(/[\\/]/);
        setName(parts[parts.length - 1] || '');
      }
      setIconManuallySet(false);
    }
  };

  const handleSubmit = () => {
    if (!name.trim() || !targetPath.trim()) {
      addToast(t('modal.error.nameRequired'), 'error');
      return;
    }

    const groupId = editingGroupId || '';
    if (!groupId) {
      addToast(t('modal.error.noGroup'), 'error');
      return;
    }

    if (isEditing && editingShortcut) {
      updateShortcut(activeTabId, groupId, editingShortcut.id, {
        name: name.trim(),
        type,
        targetPath: targetPath.trim(),
        remark: remark.trim() || undefined,
        icon: icon || undefined,
      });
      addToast(t('modal.updated'), 'success');
    } else {
      addShortcut(activeTabId, groupId, {
        name: name.trim(),
        type,
        targetPath: targetPath.trim(),
        remark: remark.trim() || undefined,
        icon: icon || undefined,
      });
      addToast(t('modal.added'), 'success');
    }
    closeAddModal();
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text)',
    padding: '8px 12px',
    fontSize: '14px',
    outline: 'none',
    width: '100%',
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'var(--color-overlay)' }}
        onClick={closeAddModal}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-md p-6 rounded-2xl"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 20px 60px var(--color-shadow)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {isEditing ? t('modal.edit.title') : t('modal.add.title')}
            </h2>
            <button
              onClick={closeAddModal}
              className="p-1.5 rounded-lg hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Type selector */}
          <div className="flex gap-2 mb-4">
            {SHORTCUT_TYPES.map(({ type: t_type, labelKey, icon: Icon }) => (
              <button
                key={t_type}
                onClick={() => setType(t_type)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all duration-150"
                style={{
                  background: type === t_type ? 'var(--color-accent)' : 'var(--color-bg-card)',
                  border: `1px solid ${type === t_type ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  color: type === t_type ? 'white' : 'var(--color-text-secondary)',
                }}
              >
                <Icon size={14} />
                {t(labelKey)}
              </button>
            ))}
          </div>

          {/* Name */}
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('modal.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('modal.namePlaceholder')}
              style={inputStyle}
              autoFocus
            />
          </div>

          {/* Target path */}
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              {type === 'url' ? t('modal.url') : t('modal.path')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder={type === 'url' ? t('modal.urlPlaceholder') : t('modal.pathPlaceholder')}
                style={{ ...inputStyle, flex: 1 }}
              />
              {type !== 'url' && (
                <button
                  onClick={handleBrowse}
                  className="px-3 rounded-lg shrink-0 flex items-center gap-1.5 text-xs"
                  style={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <FolderOpen size={14} /> {t('modal.browse')}
                </button>
              )}
            </div>
          </div>

          {/* Icon */}
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('modal.icon')}</label>
            <div className="flex items-center gap-2">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                {icon ? <img src={icon} alt="" className="w-7 h-7 object-contain" /> : <ImagePlus size={18} style={{ color: 'var(--color-text-muted)' }} />}
              </div>
              <button
                onClick={handleChooseIcon}
                className="px-3 py-2 rounded-lg shrink-0 flex items-center gap-1.5 text-xs"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                <ImagePlus size={14} /> {t('modal.iconChoose')}
              </button>
              {icon && (
                <button
                  onClick={handleClearIcon}
                  className="px-3 py-2 rounded-lg shrink-0 text-xs"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  {t('modal.iconAuto')}
                </button>
              )}
            </div>
          </div>
          {/* Remark */}
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('modal.remark')}</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder={t('modal.remarkPlaceholder')}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={closeAddModal}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 hover:opacity-80"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {t('modal.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: 'var(--color-accent)',
                color: 'white',
                boxShadow: '0 2px 8px var(--color-accent-glow)',
              }}
            >
              {isEditing ? t('modal.save') : t('modal.add')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
