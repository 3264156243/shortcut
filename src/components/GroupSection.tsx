import { useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { Group } from '../types';
import ShortcutCard from './ShortcutCard';
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, MoreHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';

interface Props {
  group: Group;
  tabId: string;
  isSearchResult?: boolean;
}

export default function GroupSection({ group, tabId, isSearchResult = false }: Props) {
  const toggleGroupCollapse = useStore((s) => s.toggleGroupCollapse);
  const renameGroup = useStore((s) => s.renameGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const openAddModal = useStore((s) => s.openAddModal);
  const searchQuery = useStore((s) => s.searchQuery);
  const { t } = useTranslation();

  // Make group a droppable area
  const { setNodeRef, isOver } = useDroppable({
    id: `group-${group.id}`,
    data: {
      type: 'group',
      groupId: group.id,
      tabId,
    },
  });

  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [showMenu, setShowMenu] = useState(false);

  const handleRename = () => {
    if (editName.trim()) {
      renameGroup(tabId, group.id, editName.trim());
    }
    setIsRenaming(false);
  };

  const handleDeleteGroup = () => {
    if (window.confirm(t('group.deleteMessage', { name: group.name }))) {
      deleteGroup(tabId, group.id);
    }
  };

  // Auto-expand when searching
  const isCollapsed = searchQuery ? false : group.collapsed;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Group header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg mb-2 group cursor-pointer"
        style={{ background: 'var(--color-bg-card)' }}
      >
        <button
          onClick={() => toggleGroupCollapse(tabId, group.id)}
          className="p-0.5 rounded hover:opacity-80 transition-opacity"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>

        {isRenaming ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            onBlur={handleRename}
            autoFocus
            className="flex-1 bg-transparent border-none outline-none text-sm font-medium"
            style={{ color: 'var(--color-text)' }}
          />
        ) : (
          <span
            className="flex-1 text-sm font-medium"
            style={{ color: 'var(--color-text)' }}
            onDoubleClick={() => setIsRenaming(true)}
          >
            {group.name}
          </span>
        )}

        <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-muted)' }}>
          {group.shortcuts.length}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => openAddModal(group.id)}
            className="p-1 rounded hover:opacity-80 transition-opacity"
            style={{ color: 'var(--color-accent)' }}
            title={t('group.add')}
          >
            <Plus size={13} />
          </button>
          <button
            onClick={() => setIsRenaming(true)}
            className="p-1 rounded hover:opacity-80 transition-opacity"
            style={{ color: 'var(--color-text-muted)' }}
            title={t('group.rename')}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={handleDeleteGroup}
            className="p-1 rounded hover:opacity-80 transition-opacity"
            style={{ color: 'var(--color-danger)' }}
            title={t('group.delete')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Shortcuts grid */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              ref={setNodeRef}
              className="grid gap-3 pb-2 min-h-[60px] rounded-lg transition-colors duration-200"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                background: isOver ? 'var(--color-accent-soft)' : 'transparent',
                border: isOver ? '2px dashed var(--color-accent)' : '2px dashed transparent',
              }}
            >
              <SortableContext
                items={group.shortcuts.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {group.shortcuts.map((shortcut) => (
                  <ShortcutCard key={shortcut.id} shortcut={shortcut} groupId={group.id} tabId={tabId} />
                ))}
              </SortableContext>
              {group.shortcuts.length === 0 && (
                <div className="col-span-full flex items-center justify-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {t('panel.empty.title')}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
