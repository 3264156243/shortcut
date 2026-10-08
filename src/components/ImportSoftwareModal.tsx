import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Check, Loader2, AppWindow } from 'lucide-react';

interface Software {
  name: string;
  path: string;
  icon: string;
}

export default function ImportSoftwareModal() {
  const closeImportSoftware = useStore((s) => s.closeImportSoftware);
  const addMultipleShortcuts = useStore((s) => s.addMultipleShortcuts);
  const activeTabId = useStore((s) => s.activeTabId);
  const config = useStore((s) => s.config);
  const addToast = useStore((s) => s.addToast);
  const { t } = useTranslation();

  const [softwareList, setSoftwareList] = useState<Software[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetGroupId, setTargetGroupId] = useState<string>('');

  const activeTab = config.tabs.find((tab) => tab.id === activeTabId);
  const groups = activeTab?.groups || [];

  // Load software list
  useEffect(() => {
    const loadSoftware = async () => {
      const api = window.electronAPI;
      if (!api) {
        setLoading(false);
        return;
      }
      try {
        const list = await api.getInstalledSoftware();
        setSoftwareList(list);
      } catch (e) {
        console.error('Failed to load software:', e);
      }
      setLoading(false);
    };
    loadSoftware();
  }, []);

  // Set default group
  useEffect(() => {
    if (groups.length > 0 && !targetGroupId) {
      setTargetGroupId(groups[0].id);
    }
  }, [groups, targetGroupId]);

  // Filter software
  const filteredSoftware = useMemo(() => {
    if (!searchQuery) return softwareList;
    const query = searchQuery.toLowerCase();
    return softwareList.filter(
      (s) => s.name.toLowerCase().includes(query) || s.path.toLowerCase().includes(query)
    );
  }, [softwareList, searchQuery]);

  const handleToggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selected.size === filteredSoftware.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredSoftware.map((s) => s.path)));
    }
  };

  const handleImport = () => {
    if (!targetGroupId || selected.size === 0) return;

    const shortcuts = softwareList
      .filter((s) => selected.has(s.path))
      .map((s) => ({
        name: s.name,
        type: 'app' as const,
        targetPath: s.path,
        icon: s.icon || undefined,
      }));

    addMultipleShortcuts(activeTabId, targetGroupId, shortcuts);
    addToast(t('import.success', { count: String(shortcuts.length) }), 'success');
    closeImportSoftware();
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
        className="fixed inset-0 z-[1000] flex items-center justify-center"
        style={{ background: 'var(--color-overlay)' }}
        onClick={closeImportSoftware}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 20px 60px var(--color-shadow)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 pb-3 shrink-0">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {t('import.title')}
            </h2>
            <button
              onClick={closeImportSoftware}
              className="p-1.5 rounded-lg hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Search and target group */}
          <div className="px-5 pb-3 flex gap-3 shrink-0">
            <div
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
              }}
            >
              <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                placeholder={t('import.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-sm"
                style={{ color: 'var(--color-text)' }}
              />
            </div>
            <select
              value={targetGroupId}
              onChange={(e) => setTargetGroupId(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm"
              style={{
                ...inputStyle,
                width: 'auto',
                minWidth: '120px',
              }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Software list */}
          <div className="flex-1 overflow-y-auto px-5 pb-3">
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-3">
                <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                <span style={{ color: 'var(--color-text-muted)' }}>{t('import.loading')}</span>
              </div>
            ) : filteredSoftware.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <span style={{ color: 'var(--color-text-muted)' }}>{t('import.empty')}</span>
              </div>
            ) : (
              <div className="grid gap-2">
                {/* Select all */}
                <button
                  onClick={handleSelectAll}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 hover:opacity-80"
                  style={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center"
                    style={{
                      background: selected.size === filteredSoftware.length ? 'var(--color-accent)' : 'transparent',
                      border: `2px solid ${selected.size === filteredSoftware.length ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    }}
                  >
                    {selected.size === filteredSoftware.length && <Check size={12} color="white" />}
                  </div>
                  <span>{selected.size === filteredSoftware.length ? '取消全选' : '全选'}</span>
                </button>

                {/* Software items */}
                {filteredSoftware.map((software) => (
                  <button
                    key={software.path}
                    onClick={() => handleToggleSelect(software.path)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 hover:opacity-80"
                    style={{
                      background: selected.has(software.path) ? 'var(--color-accent-soft)' : 'var(--color-bg-card)',
                      border: `1px solid ${selected.has(software.path) ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      color: 'var(--color-text)',
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                      style={{
                        background: selected.has(software.path) ? 'var(--color-accent)' : 'transparent',
                        border: `2px solid ${selected.has(software.path) ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      }}
                    >
                      {selected.has(software.path) && <Check size={12} color="white" />}
                    </div>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: 'var(--color-bg-card-hover)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      {software.icon ? (
                        <img src={software.icon} alt="" className="w-6 h-6 object-contain" />
                      ) : (
                        <AppWindow size={16} style={{ color: 'var(--color-text-muted)' }} />
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-medium truncate">{software.name}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {software.path}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-4 border-t shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {t('import.selected', { count: String(selected.size) })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={closeImportSoftware}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 hover:opacity-80"
                style={{
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {t('import.cancel')}
              </button>
              <button
                onClick={handleImport}
                disabled={selected.size === 0 || !targetGroupId}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                  boxShadow: '0 2px 8px var(--color-accent-glow)',
                }}
              >
                {t('import.confirm')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
