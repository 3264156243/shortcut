import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store';
import { motion, AnimatePresence } from 'framer-motion';
import { Minus, Square, X, Maximize2, Minimize2 } from 'lucide-react';
import TopBar from './components/TopBar';
import TabBar from './components/TabBar';
import PanelBody from './components/PanelBody';
import AddShortcutModal from './components/AddShortcutModal';
import SettingsPanel from './components/SettingsPanel';
import ImportSoftwareModal from './components/ImportSoftwareModal';
import ToastContainer from './components/Toast';
import ModuleSidebar from './components/ModuleSidebar';
import TaskBoard from './components/TaskBoard';
import UpdateModal from './components/UpdateModal';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import TranslatePanel from './components/TranslatePanel';
import { PanelAnimation, UpdateState } from './types';
import { useTranslation } from './hooks/useTranslation';
import appIcon from './assets/app-icon.png';

// Animation variants based on direction
const getAnimationVariants = (direction: PanelAnimation) => {
  const variants = {
    bottom: {
      initial: { opacity: 0, y: 60, scale: 0.98 },
      animate: { opacity: 1, y: 0, scale: 1 },
    },
    top: {
      initial: { opacity: 0, y: -60, scale: 0.98 },
      animate: { opacity: 1, y: 0, scale: 1 },
    },
    left: {
      initial: { opacity: 0, x: -60, scale: 0.98 },
      animate: { opacity: 1, x: 0, scale: 1 },
    },
    right: {
      initial: { opacity: 0, x: 60, scale: 0.98 },
      animate: { opacity: 1, x: 0, scale: 1 },
    },
    center: {
      initial: { opacity: 0, scale: 0.85 },
      animate: { opacity: 1, scale: 1 },
    },
  };
  return variants[direction] || variants.bottom;
};

export default function App() {
  const config = useStore((s) => s.config);
  const loadConfig = useStore((s) => s.loadConfig);
  const showAddModal = useStore((s) => s.showAddModal);
  const showSettings = useStore((s) => s.showSettings);
  const showImportSoftware = useStore((s) => s.showImportSoftware);
  const activeModule = useStore((s) => s.activeModule);
  const addToast = useStore((s) => s.addToast);
  const [animKey, setAnimKey] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const spaceDownAt = useRef<number | null>(null);
  const longSpaceTimer = useRef<number | null>(null);
  const shortSpaceTimer = useRef<number | null>(null);
  const longSpaceTriggered = useRef(false);

  const { t } = useTranslation();
  const animationDirection = config.panelAnimation || 'bottom';
  const variants = useMemo(() => getAnimationVariants(animationDirection), [animationDirection]);

  const api = window.electronAPI;

  const handleClose = () => {
    api?.closeWindow();
  };

  const handleMinimize = () => {
    api?.minimizeWindow();
  };

  const handleMaximize = async () => {
    if (api?.maximizeWindow) {
      const maximized = await api.maximizeWindow();
      setIsMaximized(maximized);
    }
  };

  const handleUpdateClick = async () => {
    if (!api?.checkForUpdates) {
      addToast(t('update.unconfigured'), 'error');
      return;
    }

    const status = updateState?.status;
    if (status === 'available' || status === 'downloading' || status === 'downloaded') {
      setUpdateDismissed(false);
      return;
    }
    if (status === 'checking') return;

    setUpdateDismissed(false);
    try {
      const result = await api.checkForUpdates();
      if (result.status === 'not-available') {
        addToast(t('update.latest'), 'success');
      } else if (result.status === 'unconfigured' || result.status === 'idle') {
        addToast(t('update.unconfigured'), 'error');
      } else if (!result.success && result.status !== 'error') {
        addToast(t('update.checkFailed'), 'error');
      }
    } catch {
      addToast(t('update.checkFailed'), 'error');
    }
  };

  useEffect(() => {
    api?.getVersion?.().then(setAppVersion).catch(() => undefined);
  }, [api]);  useEffect(() => {
    loadConfig();
  }, [loadConfig]);
  useEffect(() => {
    if (!api?.onUpdateState) return;
    api.getUpdateState().then(setUpdateState).catch(() => undefined);
    const unsubscribe = api.onUpdateState((nextState) => {
      setUpdateState(nextState);
      if (nextState.status === 'available' || nextState.status === 'downloaded' || (nextState.status === 'error' && !!nextState.manual)) {
        setUpdateDismissed(false);
      }
    });
    return unsubscribe;
  }, [api]);
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable);
    };

    const clearLongPress = () => {
      if (longSpaceTimer.current) {
        window.clearTimeout(longSpaceTimer.current);
        longSpaceTimer.current = null;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.code === 'Space' || event.key === ' ') || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const state = useStore.getState();
      const isModalOpen = state.showAddModal || state.showSettings || state.showImportSoftware || !!document.querySelector('[data-task-modal], [data-update-modal], [data-keyboard-shortcuts-modal]');
      if (isEditableTarget(event.target) || isModalOpen) return;

      event.preventDefault();
      if (spaceDownAt.current !== null) return;
      spaceDownAt.current = performance.now();
      longSpaceTriggered.current = false;
      clearLongPress();
      longSpaceTimer.current = window.setTimeout(() => {
        const latest = useStore.getState();
        const modules = ['shortcuts', 'tasks', 'translate'] as const;
        const currentIndex = Math.max(0, modules.indexOf(latest.activeModule));
        latest.setActiveModule(modules[(currentIndex + 1) % modules.length]);
        longSpaceTriggered.current = true;
        shortSpaceTimer.current && window.clearTimeout(shortSpaceTimer.current);
        shortSpaceTimer.current = null;
      }, 500);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!(event.code === 'Space' || event.key === ' ')) return;
      if (spaceDownAt.current === null) return;
      const pressedFor = performance.now() - spaceDownAt.current;
      spaceDownAt.current = null;
      clearLongPress();
      event.preventDefault();

      if (longSpaceTriggered.current || pressedFor >= 500) {
        longSpaceTriggered.current = false;
        return;
      }

      if (shortSpaceTimer.current) {
        window.clearTimeout(shortSpaceTimer.current);
        shortSpaceTimer.current = null;
        const latest = useStore.getState();
        if (latest.activeModule === 'shortcuts') {
          window.dispatchEvent(new Event('shortcut:focus-search'));
        } else if (latest.activeModule === 'tasks') {
          window.dispatchEvent(new Event('task:focus-input'));
        }
        return;
      }

      shortSpaceTimer.current = window.setTimeout(() => {
        const latest = useStore.getState();
        if (latest.activeModule === 'shortcuts') {
          const tabs = latest.config.tabs;
          if (tabs.length > 1) {
            const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === latest.activeTabId));
            latest.setActiveTab(tabs[(currentIndex + 1) % tabs.length].id);
          }
        } else if (latest.activeModule === 'tasks') {
          const taskBoards = latest.config.taskBoards || [];
          if (taskBoards.length > 1) {
            const currentIndex = Math.max(0, taskBoards.findIndex((board) => board.id === latest.config.activeTaskBoardId));
            latest.setActiveTaskBoard(taskBoards[(currentIndex + 1) % taskBoards.length].id);
          }
        }
        shortSpaceTimer.current = null;
      }, 320);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearLongPress();
      if (shortSpaceTimer.current) {
        window.clearTimeout(shortSpaceTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    let checking = false;

    const checkReminders = async () => {
      if (checking) return;
      checking = true;
      try {
        const state = useStore.getState();
        const now = Date.now();
        for (const board of state.config.taskBoards || []) {
          for (const task of board.notes || []) {
            if (!task.reminderAt || task.remindedAt) continue;
            const reminderTime = new Date(task.reminderAt).getTime();
            if (!Number.isFinite(reminderTime) || reminderTime > now) continue;
            const shown = await window.electronAPI?.showNotification('任务提醒', task.text);
            if (shown) {
              useStore.getState().markTaskReminded(board.id, task.id);
            }
          }
        }
      } finally {
        checking = false;
      }
    };

    void checkReminders();
    const timer = window.setInterval(() => void checkReminders(), 30000);
    return () => window.clearInterval(timer);
  }, []);
  // Check initial maximized state
  useEffect(() => {
    if (api?.isMaximized) {
      api.isMaximized().then(setIsMaximized);
    }
  }, [api]);

  // Apply theme
  useEffect(() => {
    const theme = config.theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : config.theme;
    document.documentElement.setAttribute('data-theme', theme);
  }, [config.theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (config.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [config.theme]);

  // Replay animation when window will show (for show/hide via hotkey)
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.onWindowWillShow) {
      const unsubscribe = api.onWindowWillShow(() => {
        setAnimKey((prev) => prev + 1);
      });
      return unsubscribe;
    }
  }, []);

  // Also replay on focus (fallback)
  useEffect(() => {
    const handleFocus = () => {
      setAnimKey((prev) => prev + 1);
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <motion.div
        key={animKey}
        className="flex flex-col h-full w-full"
        initial={variants.initial}
        animate={variants.animate}
        transition={{
          type: 'spring',
          damping: 25,
          stiffness: 350,
          mass: 0.8,
        }}
      >
        {/* Title bar drag region */}
        <div className="titlebar-drag flex items-center justify-between px-3 pt-2 shrink-0">
          <div className="flex items-center gap-2">
            <img src={appIcon} alt="" className="h-5 w-5 object-contain" />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>ShortCut</span>
            {appVersion && <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>v{appVersion}</span>}
          </div>

          <div className="flex items-center gap-1">
            {activeModule === 'shortcuts' && <TopBar />}

            {/* Window controls */}
            <div className="flex items-center ml-2 no-drag">
              <button
                onClick={handleMinimize}
                className="p-1.5 rounded-lg transition-all duration-150 hover:opacity-80"
                style={{ color: 'var(--color-text-muted)' }}
                title="鏈€灏忓寲"
              >
                <Minus size={14} />
              </button>
              <button
                onClick={handleMaximize}
                className="p-1.5 rounded-lg transition-all duration-150 hover:opacity-80"
                style={{ color: 'var(--color-text-muted)' }}
                title={isMaximized ? '杩樺師' : '鏈€澶у寲'}
              >
                {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg transition-all duration-150 hover:bg-red-500 hover:text-white"
                style={{ color: 'var(--color-text-muted)' }}
                title="鍏抽棴"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <ModuleSidebar
            updateState={updateState}
            onUpdateClick={() => { void handleUpdateClick(); }}
            onShowKeyboardShortcuts={() => setShowKeyboardShortcuts(true)}
          />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {activeModule === 'shortcuts' ? (
              <>
                <TabBar />
                <PanelBody />
              </>
            ) : activeModule === 'tasks' ? (
              <TaskBoard />
            ) : (
              <TranslatePanel />
            )}
          </main>
        </div>
      </motion.div>

      {/* Modals */}
      {showAddModal && <AddShortcutModal />}
      {showSettings && <SettingsPanel />}
      {showImportSoftware && <ImportSoftwareModal />}
      {showKeyboardShortcuts && <KeyboardShortcutsModal onClose={() => setShowKeyboardShortcuts(false)} />}

      {/* Toasts */}
      <ToastContainer />

      {updateState && !updateDismissed && (
        <UpdateModal
          state={updateState}
          onDownload={() => { void api?.downloadUpdate(); }}
          onInstall={() => { void api?.installUpdate(); }}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}
    </div>
  );
}
