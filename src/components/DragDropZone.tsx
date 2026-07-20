import { useState, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { Upload } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

export default function DragDropZone({ children }: Props) {
  const addShortcut = useStore((s) => s.addShortcut);
  const addToast = useStore((s) => s.addToast);
  const activeTabId = useStore((s) => s.activeTabId);
  const config = useStore((s) => s.config);
  const addGroup = useStore((s) => s.addGroup);
  const { t } = useTranslation();
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const activeTab = config.tabs.find((tab) => tab.id === activeTabId);

  // Get or create first group
  const getTargetGroupId = (): string | null => {
    if (!activeTab) return null;
    if (activeTab.groups.length > 0) {
      return activeTab.groups[0].id;
    }
    // Create a default group
    const groupName = t('group.default');
    addGroup(activeTabId, groupName);
    const updatedTab = useStore.getState().config.tabs.find((tab) => tab.id === activeTabId);
    return updatedTab?.groups[updatedTab.groups.length - 1]?.id || null;
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if leaving the container
    if (e.currentTarget === e.target) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const groupId = getTargetGroupId();
    if (!groupId) {
      addToast(t('modal.error.noGroup'), 'error');
      return;
    }

    const api = window.electronAPI;
    if (!api) {
      addToast('Drag and drop is only available in Electron', 'info');
      return;
    }

    let addedCount = 0;
    for (const file of files) {
      try {
        // Get file info from main process
        const filePath = (file as any).path;
        if (!filePath) continue;

        const fileInfo = await api.getFileInfo(filePath);
        if (fileInfo) {
          addShortcut(activeTabId, groupId, {
            name: fileInfo.name,
            type: fileInfo.type,
            targetPath: fileInfo.path,
          });
          addedCount++;
        }
      } catch (err) {
        console.error('Failed to add dropped file:', err);
      }
    }

    if (addedCount > 0) {
      addToast(t('import.success', { count: String(addedCount) }), 'success');
    }
  }, [activeTabId, addShortcut, addToast, addGroup, t]);

  return (
    <div
      className="relative flex-1 flex flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Drop overlay */}
      {isDraggingOver && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{
            background: 'var(--color-overlay)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            className="flex flex-col items-center gap-4 p-8 rounded-2xl"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '2px dashed var(--color-accent)',
              boxShadow: '0 20px 60px var(--color-shadow)',
            }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: 'var(--color-accent-soft)',
                border: '1px solid var(--color-accent)',
              }}
            >
              <Upload size={32} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                {t('add.button')}
              </h3>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {t('modal.type.app')}, {t('modal.type.folder')}, {t('modal.type.file')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
