import { useState, useRef, useEffect, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { Search, Plus, Settings, X, Download } from 'lucide-react';

export default function TopBar() {
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const activeTabId = useStore((s) => s.activeTabId);
  const config = useStore((s) => s.config);
  const openAddModal = useStore((s) => s.openAddModal);
  const openSettings = useStore((s) => s.openSettings);
  const openImportSoftware = useStore((s) => s.openImportSoftware);
  const addGroup = useStore((s) => s.addGroup);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const { t } = useTranslation();

  // Get first group of active tab for quick-add
  const activeTab = config.tabs.find((tab) => tab.id === activeTabId);
  const firstGroupId = activeTab?.groups[0]?.id || '';

  // Handle add shortcut - create group if needed
  const handleAddShortcut = () => {
    if (firstGroupId) {
      openAddModal(firstGroupId);
    } else if (activeTabId) {
      // Create a default group first
      const groupName = t('group.default');
      addGroup(activeTabId, groupName);
      // Get the newly created group id
      const updatedTab = useStore.getState().config.tabs.find((tab) => tab.id === activeTabId);
      const newGroupId = updatedTab?.groups[updatedTab.groups.length - 1]?.id;
      if (newGroupId) {
        openAddModal(newGroupId);
      }
    }
  };

  // Keyboard shortcut: Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus search on panel open
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      if (searchQuery) {
        setSearchQuery('');
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className="flex items-center gap-2 no-drag">
      {/* Search */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-200"
        style={{
          background: 'var(--color-bg-card)',
          border: `1px solid ${focused ? 'var(--color-accent)' : 'var(--color-border)'}`,
          boxShadow: focused ? '0 0 0 3px var(--color-accent-glow)' : 'none',
          minWidth: '220px',
        }}
      >
        <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
        <input
          ref={inputRef}
          type="text"
          placeholder={`${t('search.placeholder')} (Ctrl+K)`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none outline-none text-sm"
          style={{ color: 'var(--color-text)', caretColor: 'var(--color-accent)' }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="p-0.5 rounded-md hover:opacity-80 transition-opacity"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Import software button */}
      <button
        onClick={openImportSoftware}
        className="p-2 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}
        title={t('import.title')}
      >
        <Download size={16} />
      </button>

      {/* Add button - always visible */}
      <button
        onClick={handleAddShortcut}
        className="p-2 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: 'var(--color-accent)',
          color: 'white',
          boxShadow: '0 2px 8px var(--color-accent-glow)',
        }}
        title={t('add.button')}
      >
        <Plus size={16} />
      </button>

      {/* Settings */}
      <button
        onClick={openSettings}
        className="p-2 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}
        title={t('settings.button')}
      >
        <Settings size={16} />
      </button>
    </div>
  );
}
