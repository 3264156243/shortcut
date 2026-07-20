import { useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { Plus, X, Pencil, MoreHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TabBar() {
  const config = useStore((s) => s.config);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const addTab = useStore((s) => s.addTab);
  const renameTab = useStore((s) => s.renameTab);
  const deleteTab = useStore((s) => s.deleteTab);
  const { t } = useTranslation();

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  const handleStartRename = (tabId: string, currentName: string) => {
    setEditingTabId(tabId);
    setEditName(currentName);
  };

  const handleConfirmRename = () => {
    if (editingTabId && editName.trim()) {
      renameTab(editingTabId, editName.trim());
    }
    setEditingTabId(null);
  };

  const handleAddTab = () => {
    const name = `${t('tab.default')} ${config.tabs.length + 1}`;
    addTab(name);
  };

  const handleDeleteTab = (tabId: string, name: string) => {
    if (window.confirm(t('tab.deleteMessage', { name }))) {
      deleteTab(tabId);
    }
  };

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 shrink-0 overflow-x-auto"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <AnimatePresence mode="popLayout">
        {config.tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isHovered = tab.id === hoveredTabId;

          return (
            <motion.div
              key={tab.id}
              layout
              initial={{ opacity: 0, scale: 0.9, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              transition={{
                type: 'spring',
                damping: 20,
                stiffness: 300,
                duration: 0.2,
              }}
              className="relative group"
              onMouseEnter={() => setHoveredTabId(tab.id)}
              onMouseLeave={() => setHoveredTabId(null)}
            >
              <div
                className="flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer transition-all duration-200"
                style={{
                  background: isActive
                    ? 'var(--color-accent)'
                    : isHovered
                    ? 'var(--color-bg-card-hover)'
                    : 'var(--color-bg-card)',
                  border: `1px solid ${isActive ? 'var(--color-accent)' : isHovered ? 'var(--color-border-hover)' : 'var(--color-border)'}`,
                  boxShadow: isActive
                    ? '0 4px 12px var(--color-accent-glow)'
                    : isHovered
                    ? '0 2px 8px var(--color-shadow)'
                    : '0 1px 4px var(--color-shadow)',
                  transform: isActive ? 'translateY(-1px)' : 'none',
                  minWidth: '80px',
                }}
                onClick={() => setActiveTab(tab.id)}
              >
                {/* Tab index indicator */}
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                  style={{
                    background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--color-bg-card-hover)',
                    color: isActive ? 'white' : 'var(--color-text-muted)',
                  }}
                >
                  {index + 1}
                </div>

                {/* Tab name */}
                {editingTabId === tab.id ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmRename();
                      if (e.key === 'Escape') setEditingTabId(null);
                    }}
                    onBlur={handleConfirmRename}
                    autoFocus
                    className="bg-transparent border-none outline-none text-sm font-medium w-20"
                    style={{ color: isActive ? 'white' : 'var(--color-text)' }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="text-sm font-medium whitespace-nowrap"
                    style={{ color: isActive ? 'white' : 'var(--color-text)' }}
                  >
                    {tab.name}
                  </span>
                )}

                {/* Tab actions */}
                <div
                  className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleStartRename(tab.id, tab.name)}
                    className="p-1 rounded-md hover:opacity-80 transition-opacity"
                    style={{ color: isActive ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}
                  >
                    <Pencil size={10} />
                  </button>
                  {config.tabs.length > 1 && (
                    <button
                      onClick={() => handleDeleteTab(tab.id, tab.name)}
                      className="p-1 rounded-md hover:opacity-80 transition-opacity"
                      style={{ color: isActive ? 'rgba(255,255,255,0.7)' : 'var(--color-danger)' }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>

              {/* Active indicator dot */}
              {isActive && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--color-accent)' }}
                  transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Add tab button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleAddTab}
        className="flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-200"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px dashed var(--color-border)',
          color: 'var(--color-text-muted)',
        }}
        title={t('tab.add')}
      >
        <Plus size={14} />
      </motion.button>
    </div>
  );
}
