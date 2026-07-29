import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { Shortcut, ShortcutType } from '../types';
import { executeShortcut } from '../utils/openShortcut';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AppWindow, Folder, File, Globe, Pencil, Trash2,
  Copy, MoreVertical, AlertTriangle, GripVertical,
  FolderOpen, Layers3, SquareTerminal
} from 'lucide-react';

interface Props {
  shortcut: Shortcut;
  groupId: string;
  tabId: string;
  isDraggable?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
}

const TYPE_ICONS: Record<ShortcutType, typeof AppWindow> = {
  app: AppWindow,
  folder: Folder,
  file: File,
  url: Globe,
  group: Layers3,
  bat: SquareTerminal,
};

const TYPE_COLORS: Record<ShortcutType, string> = {
  app: '#6366f1',
  folder: '#f59e0b',
  file: '#22c55e',
  url: '#3b82f6',
  group: '#a855f7',
  bat: '#64748b',
};

// Cache for file icons
const iconCache: Map<string, string> = new Map();
const websiteIconCache: Map<string, string> = new Map();
const MENU_WIDTH = 152;

const hasUrlScheme = (value: string) => /^https?:\/\//i.test(value.trim());

const looksLikeWebUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) return false;
  return hasUrlScheme(trimmed) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i.test(trimmed);
};

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  return hasUrlScheme(trimmed) ? trimmed : `https://${trimmed}`;
};

function clampMenuPosition(left: number, top: number) {
  const maxLeft = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
  const maxTop = Math.max(8, window.innerHeight - 180);
  return {
    left: Math.min(Math.max(8, left), maxLeft),
    top: Math.min(Math.max(8, top), maxTop),
  };
}

export default function ShortcutCard({ shortcut, groupId, tabId, isDraggable = true, isSelected = false, onSelect }: Props) {
  const openAddModal = useStore((s) => s.openAddModal);
  const deleteShortcut = useStore((s) => s.deleteShortcut);
  const addToast = useStore((s) => s.addToast);
  const searchQuery = useStore((s) => s.searchQuery);
  const { t } = useTranslation();
  const [fileIcon, setFileIcon] = useState<string | null>(shortcut.icon || null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setFileIcon(shortcut.icon || null);
    if (shortcut.icon || (shortcut.type !== 'url' && !looksLikeWebUrl(shortcut.targetPath))) return;
    const normalizedUrl = normalizeUrl(shortcut.targetPath);
    const cached = websiteIconCache.get(normalizedUrl);
    if (cached) {
      setFileIcon(cached);
      return;
    }
    window.electronAPI?.getWebsiteIcon(normalizedUrl).then((iconDataUrl) => {
      if (iconDataUrl) {
        websiteIconCache.set(normalizedUrl, iconDataUrl);
        setFileIcon(iconDataUrl);
      }
    }).catch(() => undefined);
  }, [shortcut.icon, shortcut.targetPath, shortcut.type]);

  useEffect(() => {
    if (shortcut.type === 'url' || shortcut.type === 'group' || shortcut.type === 'bat' || looksLikeWebUrl(shortcut.targetPath) || shortcut.icon || !shortcut.targetPath) return;

    const cached = iconCache.get(shortcut.targetPath);
    if (cached) {
      setFileIcon(cached);
      return;
    }

    const api = window.electronAPI;
    if (api?.getFileIcon) {
      api.getFileIcon(shortcut.targetPath).then((iconDataUrl) => {
        if (iconDataUrl) {
          iconCache.set(shortcut.targetPath, iconDataUrl);
          setFileIcon(iconDataUrl);
        }
      }).catch(() => {
        // Type icon remains as the visual fallback.
      });
    }
  }, [shortcut.type, shortcut.icon, shortcut.targetPath]);
  // Sortable for drag and drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: shortcut.id,
    data: {
      type: 'shortcut',
      shortcut,
      groupId,
      tabId,
    },
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isSelected ? 'var(--color-accent-soft)' : 'var(--color-bg-card)',
    border: `1px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
    boxShadow: isSelected ? '0 0 0 3px var(--color-accent-glow)' : 'none',
  };

  const Icon = TYPE_ICONS[shortcut.type];
  const iconColor = shortcut.missing ? 'var(--color-danger)' : TYPE_COLORS[shortcut.type];

  const handleOpen = async () => {
    if (shortcut.missing && shortcut.type !== 'group' && shortcut.type !== 'bat') {
      addToast(`${t('shortcut.missing')}: ${shortcut.targetPath}`, 'error');
      return;
    }
    try {
      const result = await executeShortcut(shortcut);
      if (result.success) addToast(t('shortcut.opened', { name: shortcut.name }), 'success');
      else addToast(t('shortcut.openFailed', { error: result.error || '' }), 'error');
    } catch (err: any) {
      addToast(t('shortcut.openFailed', { error: err.message }), 'error');
    }
  };
  const handleCopyPath = () => {
    navigator.clipboard.writeText(shortcut.targetPath);
    addToast(t('shortcut.pathCopied'), 'info');
    setShowMenu(false);
  };

  const handleDelete = () => {
    setShowMenu(false);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    deleteShortcut(tabId, groupId, shortcut.id);
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleShowInFolder = async () => {
    const api = window.electronAPI;
    if (api?.showInFolder) {
      await api.showInFolder(shortcut.targetPath);
    }
    setShowMenu(false);
  };

  // Right click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition(clampMenuPosition(e.clientX, e.clientY));
    setShowMenu(true);
  }, []);

  const handleOpenMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPosition(clampMenuPosition(rect.right - MENU_WIDTH, rect.bottom + 6));
    setShowMenu((visible) => !visible);
  };

  // Highlight matching text
  const highlightText = (text: string) => {
    if (!searchQuery) return text;
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)', borderRadius: 2, padding: '0 2px' }}>
          {text.slice(idx, idx + searchQuery.length)}
        </mark>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      whileHover={{ y: -2, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onMouseDown={() => { setIsPressed(true); onSelect?.(); }}
      onMouseUp={() => setIsPressed(false)}
      onMouseLeave={() => setIsPressed(false)}
      onContextMenu={handleContextMenu}
      className="relative flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-all duration-200 group"
      data-shortcut-card="true"
      data-shortcut-id={shortcut.id}
      data-dragging={isDragging}
      {...attributes}
      {...listeners}
      onClick={() => { onSelect?.(); handleOpen(); }}
    >
      {/* Drag handle indicator */}
      {isDraggable && (
        <div
          className="absolute top-1 left-1 p-0.5 rounded opacity-0 group-hover:opacity-50 transition-opacity"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <GripVertical size={10} />
        </div>
      )}

      {/* Missing indicator */}
      {shortcut.missing && (
        <div
          className="absolute top-2 left-2 p-0.5 rounded-full"
          style={{ background: 'var(--color-danger)', color: 'white' }}
          title={t('shortcut.missing')}
        >
          <AlertTriangle size={10} />
        </div>
      )}

      {/* Icon */}
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200"
        style={{
          background: `${iconColor}15`,
          border: `1px solid ${iconColor}30`,
        }}
      >
        {fileIcon ? (
          <img src={fileIcon} alt="" className="w-8 h-8 object-contain" onError={() => setFileIcon(null)} />
        ) : (
          <Icon size={24} style={{ color: iconColor }} />
        )}
      </div>

      {/* Name */}
      <span className="text-xs font-medium text-center w-full truncate" style={{ color: 'var(--color-text)' }}>
        {highlightText(shortcut.name)}
      </span>

      {/* Remark (truncated) */}
      {shortcut.remark && (
        <span className="text-[10px] text-center w-full truncate opacity-60" style={{ color: 'var(--color-text-muted)' }}>
          {shortcut.remark}
        </span>
      )}

      {/* Context menu button */}
      <button
        onClick={handleOpenMenu}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-card-hover)' }}
      >
        <MoreVertical size={12} />
      </button>

      {/* Context menu */}
      {showMenu && menuPosition && createPortal(
        <>
          <button
            className="fixed inset-0 z-[170] cursor-default"
            style={{ background: 'transparent' }}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
            }}
            aria-label={t('shortcut.deleteCancel')}
          />
          <div
            className="fixed z-[180] py-1 rounded-lg shadow-lg"
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: MENU_WIDTH,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 24px var(--color-shadow)',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { openAddModal(groupId, shortcut); setShowMenu(false); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-text)' }}
            >
              <Pencil size={12} /> {t('shortcut.edit')}
            </button>
            {shortcut.type !== 'group' && shortcut.type !== 'bat' && (
            <button
              onClick={handleCopyPath}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-text)' }}
            >
              <Copy size={12} /> {t('shortcut.copyPath')}
            </button>
            )}
            {shortcut.type !== 'url' && shortcut.type !== 'group' && shortcut.type !== 'bat' && (
              <button
                onClick={handleShowInFolder}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:opacity-80 transition-opacity"
                style={{ color: 'var(--color-text)' }}
              >
                <FolderOpen size={12} /> {t('shortcut.showInFolder')}
              </button>
            )}
            <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-danger)' }}
            >
              <Trash2 size={12} /> {t('shortcut.delete')}
            </button>
          </div>
        </>,
        document.body
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'var(--color-overlay)' }}
          onClick={handleCancelDelete}
        >
          <div
            className="p-5 rounded-2xl max-w-[300px] w-full"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 20px 60px var(--color-shadow)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
              {t('shortcut.deleteTitle')}
            </h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
              {t('shortcut.deleteMessage', { name: shortcut.name })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCancelDelete}
                className="flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-150 hover:opacity-80"
                style={{
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {t('shortcut.deleteCancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: 'var(--color-danger)',
                  color: 'white',
                }}
              >
                {t('shortcut.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

