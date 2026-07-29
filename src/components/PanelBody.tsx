import { useCallback, useEffect, useState, useMemo } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { Shortcut, Tab, Group } from '../types';
import { executeShortcut } from '../utils/openShortcut';
import GroupSection from './GroupSection';
import EmptyState from './EmptyState';
import { Plus, AppWindow, Folder, File, Globe, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';

const TYPE_ICONS: Record<string, typeof AppWindow> = {
  app: AppWindow,
  folder: Folder,
  file: File,
  url: Globe,
};

const TYPE_COLORS: Record<string, string> = {
  app: '#6366f1',
  folder: '#f59e0b',
  file: '#22c55e',
  url: '#3b82f6',
};

interface SearchResult {
  tab: Tab;
  groups: Group[];
}

export default function PanelBody() {
  const config = useStore((s) => s.config);
  const activeTabId = useStore((s) => s.activeTabId);
  const searchQuery = useStore((s) => s.searchQuery);
  const selectedShortcutId = useStore((s) => s.selectedShortcutId);
  const setSelectedShortcut = useStore((s) => s.setSelectedShortcut);
  const showAddModal = useStore((s) => s.showAddModal);
  const showSettings = useStore((s) => s.showSettings);
  const showImportSoftware = useStore((s) => s.showImportSoftware);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const addGroup = useStore((s) => s.addGroup);
  const reorderShortcuts = useStore((s) => s.reorderShortcuts);
  const moveShortcut = useStore((s) => s.moveShortcut);
  const addToast = useStore((s) => s.addToast);
  const { t } = useTranslation();
  const [activeShortcut, setActiveShortcut] = useState<Shortcut | null>(null);
  const [collapsedTabs, setCollapsedTabs] = useState<Set<string>>(new Set());

  const activeTab = config.tabs.find((tab) => tab.id === activeTabId);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Find which group a shortcut belongs to
  const findGroupOfShortcut = useCallback((shortcutId: string) => {
    if (!activeTab) return null;
    for (const group of activeTab.groups) {
      if (group.shortcuts.find((s) => s.id === shortcutId)) {
        return group;
      }
    }
    return null;
  }, [activeTab]);

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const activeId = active.id as string;
    const group = findGroupOfShortcut(activeId);
    if (group) {
      const shortcut = group.shortcuts.find((s) => s.id === activeId);
      if (shortcut) {
        setActiveShortcut(shortcut);
      }
    }
  }, [findGroupOfShortcut]);

  // Handle drag over (for cross-group movement)
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !activeTab) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Find the groups
    const activeGroup = findGroupOfShortcut(activeId);
    if (!activeGroup) return;

    // Check if dropping on a group area
    const overData = over.data.current;
    if (overData?.type === 'group') {
      const overGroupId = overData.groupId;
      if (activeGroup.id !== overGroupId) {
        // Move shortcut to new group
        const activeIndex = activeGroup.shortcuts.findIndex((s) => s.id === activeId);
        moveShortcut(activeTabId, activeGroup.id, activeTabId, overGroupId, activeId, 0);
      }
    }
  }, [activeTab, activeTabId, findGroupOfShortcut, moveShortcut]);

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !activeTab) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    const activeGroup = findGroupOfShortcut(activeId);
    const overGroup = findGroupOfShortcut(overId);

    if (!activeGroup) return;

    // Same group reorder
    if (overGroup && activeGroup.id === overGroup.id) {
      const oldIndex = activeGroup.shortcuts.findIndex((s) => s.id === activeId);
      const newIndex = overGroup.shortcuts.findIndex((s) => s.id === overId);
      if (oldIndex !== newIndex) {
        reorderShortcuts(activeTabId, activeGroup.id, oldIndex, newIndex);
      }
    }

    // Clear active shortcut
    setActiveShortcut(null);
  }, [activeTab, activeTabId, findGroupOfShortcut, reorderShortcuts]);

  // Toggle tab collapse in search results
  const toggleTabCollapse = useCallback((tabId: string) => {
    setCollapsedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return next;
    });
  }, []);

  // Search across all tabs
  const searchResults = useMemo((): SearchResult[] => {
    if (!searchQuery) return [];

    const query = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    for (const tab of config.tabs) {
      const matchedGroups: Group[] = [];

      for (const group of tab.groups) {
        const matchedShortcuts = group.shortcuts.filter(
          (sc) =>
            sc.name.toLowerCase().includes(query) ||
            sc.targetPath.toLowerCase().includes(query) ||
            (sc.remark && sc.remark.toLowerCase().includes(query))
        );

        if (matchedShortcuts.length > 0) {
          matchedGroups.push({
            ...group,
            shortcuts: matchedShortcuts,
          });
        }
      }

      if (matchedGroups.length > 0) {
        results.push({ tab, groups: matchedGroups });
      }
    }

    return results;
  }, [config.tabs, searchQuery]);

  const visibleShortcuts = useMemo(() => {
    if (searchQuery) {
      return searchResults.flatMap((result) => result.groups.flatMap((group) => group.shortcuts));
    }

    return activeTab?.groups
      .filter((group) => !group.collapsed)
      .flatMap((group) => group.shortcuts) || [];
  }, [activeTab, searchQuery, searchResults]);

  const openShortcut = useCallback(async (shortcut: Shortcut) => {
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
  }, [addToast, t]);
  const moveSelection = useCallback((direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-shortcut-card="true"]'));
    if (cards.length === 0) return;

    const cardItems = cards
      .map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          id: card.dataset.shortcutId || '',
          rect,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      })
      .filter((item) => item.id);

    if (cardItems.length === 0) return;

    const current = selectedShortcutId
      ? cardItems.find((item) => item.id === selectedShortcutId)
      : null;

    if (!current) {
      setSelectedShortcut(cardItems[0].id);
      return;
    }

    const rowTolerance = Math.max(24, current.rect.height / 2);
    const rows = cardItems.reduce<Array<typeof cardItems>>((acc, item) => {
      const row = acc.find((items) => Math.abs(items[0].centerY - item.centerY) <= rowTolerance);
      if (row) {
        row.push(item);
      } else {
        acc.push([item]);
      }
      return acc;
    }, []);

    rows.sort((a, b) => a[0].centerY - b[0].centerY);
    rows.forEach((row) => row.sort((a, b) => a.centerX - b.centerX));

    const currentRowIndex = rows.findIndex((row) => row.some((item) => item.id === current.id));
    if (currentRowIndex === -1) return;

    const currentRow = rows[currentRowIndex];
    const currentColumnIndex = currentRow.findIndex((item) => item.id === current.id);
    let nextId: string | null = null;

    if (direction === 'ArrowLeft' || direction === 'ArrowRight') {
      const offset = direction === 'ArrowLeft' ? -1 : 1;
      const nextIndex = (currentColumnIndex + offset + currentRow.length) % currentRow.length;
      nextId = currentRow[nextIndex]?.id || null;
    } else {
      const offset = direction === 'ArrowUp' ? -1 : 1;
      const nextRowIndex = (currentRowIndex + offset + rows.length) % rows.length;
      const nextRow = rows[nextRowIndex];
      const next = nextRow.reduce((closest, item) => {
        return Math.abs(item.centerX - current.centerX) < Math.abs(closest.centerX - current.centerX)
          ? item
          : closest;
      }, nextRow[0]);
      nextId = next?.id || null;
    }

    if (nextId) {
      setSelectedShortcut(nextId);
    }
  }, [selectedShortcutId, setSelectedShortcut]);

  useEffect(() => {
    if (visibleShortcuts.length === 0) {
      setSelectedShortcut(null);
      return;
    }
    if (!selectedShortcutId || !visibleShortcuts.some((shortcut) => shortcut.id === selectedShortcutId)) {
      setSelectedShortcut(visibleShortcuts[0].id);
    }
  }, [selectedShortcutId, setSelectedShortcut, visibleShortcuts]);

  useEffect(() => {
    const selectedCard = document.querySelector<HTMLElement>(`[data-shortcut-id="${selectedShortcutId}"]`);
    selectedCard?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedShortcutId]);

  useEffect(() => {
    if (!window.electronAPI?.onWindowWillShow) return;
    return window.electronAPI.onWindowWillShow(() => {
      setSelectedShortcut(visibleShortcuts[0]?.id || null);
    });
  }, [setSelectedShortcut, visibleShortcuts]);

  useEffect(() => {
    const handler = () => {
      window.requestAnimationFrame(() => {
        setSelectedShortcut(visibleShortcuts[0]?.id || null);
      });
    };
    window.addEventListener('shortcut:select-first-visible', handler);
    return () => window.removeEventListener('shortcut:select-first-visible', handler);
  }, [setSelectedShortcut, visibleShortcuts]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (showAddModal || showSettings || showImportSoftware) return;
      const target = event.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        moveSelection(event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
        return;
      }

      if (event.key === 'Enter' && selectedShortcutId) {
        const selected = visibleShortcuts.find((shortcut) => shortcut.id === selectedShortcutId);
        if (selected) {
          event.preventDefault();
          openShortcut(selected);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [moveSelection, openShortcut, selectedShortcutId, showAddModal, showImportSoftware, showSettings, visibleShortcuts]);
  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
        {t('tab.default')}
      </div>
    );
  }

  // Non-search view: show active tab groups
  const filteredGroups = activeTab.groups;
  const hasShortcuts = filteredGroups.some((g) => g.shortcuts.length > 0);

  // Custom collision detection
  const collisionDetectionStrategy = useCallback((args: any) => {
    // First check for direct pointer collisions
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    // Then check for rect intersections
    const rectCollisions = rectIntersection(args);
    if (rectCollisions.length > 0) {
      return rectCollisions;
    }

    // Finally fall back to closest center
    return closestCenter(args);
  }, []);

  // Search mode - show results from all tabs
  if (searchQuery) {
    if (searchResults.length === 0) {
      return (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <EmptyState
            icon="search"
            title={t('search.noResults')}
            description={t('search.noResultsDesc', { query: searchQuery })}
          />
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-4">
          {searchResults.map((result) => {
            const isCollapsed = collapsedTabs.has(result.tab.id);
            const isCurrentTab = result.tab.id === activeTabId;
            const totalShortcuts = result.groups.reduce((sum, g) => sum + g.shortcuts.length, 0);

            return (
              <div key={result.tab.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                {/* Tab header */}
                <button
                  onClick={() => {
                    if (isCurrentTab) {
                      toggleTabCollapse(result.tab.id);
                    } else {
                      setActiveTab(result.tab.id);
                    }
                  }}
                  className="flex items-center gap-2 w-full px-4 py-3 transition-all duration-150 hover:opacity-80"
                  style={{ background: isCurrentTab ? 'var(--color-accent-soft)' : 'transparent' }}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {result.tab.name}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-muted)' }}>
                    {totalShortcuts}
                  </span>
                  {!isCurrentTab && (
                    <span className="text-xs ml-auto" style={{ color: 'var(--color-accent)' }}>
                      {t('search.switchTab')}
                    </span>
                  )}
                </button>

                {/* Groups */}
                {!isCollapsed && (
                  <div className="px-2 pb-2">
                    {result.groups.map((group) => (
                      <GroupSection key={group.id} group={group} tabId={result.tab.id} isSearchResult />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Normal mode - show active tab
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!hasShortcuts ? (
          <EmptyState
            icon="shortcut"
            title={t('panel.empty.title')}
            description={t('panel.empty.desc')}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {filteredGroups.map((group) => (
              <GroupSection key={group.id} group={group} tabId={activeTabId} />
            ))}

            {/* Add group button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => addGroup(activeTabId, `${t('group.default')} ${activeTab.groups.length + 1}`)}
              className="flex items-center justify-center gap-2 py-3 rounded-xl transition-all duration-200"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px dashed var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              <Plus size={16} />
              <span className="text-sm">{t('panel.addGroup')}</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* Drag overlay for animation */}
      <DragOverlay>
        {activeShortcut ? (
          <div
            className="flex flex-col items-center gap-2 p-4 rounded-xl shadow-2xl"
            style={{
              background: 'var(--color-bg-card)',
              border: '2px solid var(--color-accent)',
              opacity: 0.9,
              transform: 'rotate(3deg)',
              width: '140px',
            }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: `${TYPE_COLORS[activeShortcut.type] || '#6366f1'}15`,
                border: `1px solid ${TYPE_COLORS[activeShortcut.type] || '#6366f1'}30`,
              }}
            >
              {(() => {
                const Icon = TYPE_ICONS[activeShortcut.type] || AppWindow;
                return <Icon size={24} style={{ color: TYPE_COLORS[activeShortcut.type] || '#6366f1' }} />;
              })()}
            </div>
            <span className="text-xs font-medium text-center w-full truncate" style={{ color: 'var(--color-text)' }}>
              {activeShortcut.name}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}



