import { useState, useRef, useEffect, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { Search, Plus, Settings, X, Download, History, Trash2 } from 'lucide-react';

export default function TopBar() {
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const addSearchHistory = useStore((s) => s.addSearchHistory);
  const deleteSearchHistory = useStore((s) => s.deleteSearchHistory);
  const activeTabId = useStore((s) => s.activeTabId);
  const config = useStore((s) => s.config);
  const openAddModal = useStore((s) => s.openAddModal);
  const openSettings = useStore((s) => s.openSettings);
  const openImportSoftware = useStore((s) => s.openImportSoftware);
  const addGroup = useStore((s) => s.addGroup);
  const inputRef = useRef<HTMLInputElement>(null);
  const spaceTimer = useRef<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { t } = useTranslation();

  const activeTab = config.tabs.find((tab) => tab.id === activeTabId);
  const firstGroupId = activeTab?.groups[0]?.id || '';
  const searchHistory = config.searchHistory || [];

  const focusSearch = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
    setShowHistory(true);
  };

  const handleAddShortcut = () => {
    if (firstGroupId) {
      openAddModal(firstGroupId);
    } else if (activeTabId) {
      const groupName = t('group.default');
      addGroup(activeTabId, groupName);
      const updatedTab = useStore.getState().config.tabs.find((tab) => tab.id === activeTabId);
      const newGroupId = updatedTab?.groups[updatedTab.groups.length - 1]?.id;
      if (newGroupId) {
        openAddModal(newGroupId);
      }
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const state = useStore.getState();
      const isModalOpen = state.showAddModal || state.showSettings || state.showImportSoftware;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusSearch();
        return;
      }

      if (!isTyping && !isModalOpen && e.key === ' ') {
        e.preventDefault();
        if (spaceTimer.current) {
          window.clearTimeout(spaceTimer.current);
          spaceTimer.current = null;
          e.preventDefault();
          focusSearch();
        } else {
          spaceTimer.current = window.setTimeout(() => {
            const latest = useStore.getState();
            const tabs = latest.config.tabs;
            if (tabs.length > 1) {
              const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === latest.activeTabId));
              latest.setActiveTab(tabs[(currentIndex + 1) % tabs.length].id);
            }
            spaceTimer.current = null;
          }, 280);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (spaceTimer.current) {
        window.clearTimeout(spaceTimer.current);
      }
    };
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      if (searchQuery) {
        setSearchQuery('');
      } else {
        inputRef.current?.blur();
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      addSearchHistory(searchQuery);
      setShowHistory(false);
      inputRef.current?.blur();
      window.dispatchEvent(new Event('shortcut:select-first-visible'));
    }
  };

  const pickHistory = (query: string) => {
    setSearchQuery(query);
    addSearchHistory(query);
    focusSearch();
  };

  return (
    <div className="flex items-center gap-2 no-drag">
      <div className="relative">
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
            onFocus={() => { setFocused(true); setShowHistory(true); }}
            onBlur={() => {
              setFocused(false);
              window.setTimeout(() => setShowHistory(false), 120);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none outline-none text-sm"
            style={{ color: 'var(--color-text)', caretColor: 'var(--color-accent)' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="p-0.5 rounded-md hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-text-muted)' }}
              title={t('search.clear')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {showHistory && searchHistory.length > 0 && (
          <div
            className="absolute top-full left-0 right-0 z-50 mt-2 py-1 rounded-xl shadow-lg overflow-hidden"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 12px 32px var(--color-shadow)',
            }}
          >
            {searchHistory.map((item) => (
              <div key={item} className="flex items-center gap-2 px-2 py-1">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickHistory(item)}
                  className="flex flex-1 items-center gap-2 min-w-0 px-2 py-1.5 rounded-lg text-left text-xs transition-colors hover:opacity-80"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <History size={12} style={{ color: 'var(--color-text-muted)' }} />
                  <span className="truncate">{item}</span>
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => deleteSearchHistory(item)}
                  className="p-1.5 rounded-lg transition-opacity hover:opacity-80"
                  style={{ color: 'var(--color-danger)' }}
                  title={t('search.historyDelete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
