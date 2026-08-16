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
import CockpitPanel from './components/CockpitPanel';
import IslandPanel from './components/IslandPanel';
import UsagePanel from './components/UsagePanel';
import UsageManagePanel from './components/UsageManagePanel';
import CodexProviderPanel from './components/CodexProviderPanel';
import ActivationGate from './components/ActivationGate';
import ActivationPanel from './components/ActivationPanel';
import { ModuleId, PanelAnimation, UpdateState } from './types';
import { useTranslation } from './hooks/useTranslation';
import { getAvailableModuleIds } from './moduleRegistry';
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
  const licenseModuleAccess = useStore((s) => s.licenseModuleAccess);
  const loadConfig = useStore((s) => s.loadConfig);
  const showAddModal = useStore((s) => s.showAddModal);
  const showSettings = useStore((s) => s.showSettings);
  const showImportSoftware = useStore((s) => s.showImportSoftware);
  const activeModule = useStore((s) => s.activeModule);
  const setActiveModule = useStore((s) => s.setActiveModule);
  const addToast = useStore((s) => s.addToast);
  const [animKey, setAnimKey] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [licenseGate, setLicenseGate] = useState<{
    required: boolean;
    activated: boolean;
    checking: boolean;
    machineCode?: string;
    message?: string;
    activationPolicy?: string;
    guestEnabled?: boolean;
    tier?: string;
    contactLine?: string;
  } | null>({ required: true, activated: false, checking: true });
  const [initialLicenseCode, setInitialLicenseCode] = useState('');
  const [activationPromptDismissed, setActivationPromptDismissed] = useState(false);
  const spaceDownAt = useRef<number | null>(null);
  const longSpaceTimer = useRef<number | null>(null);
  const shortSpaceTimer = useRef<number | null>(null);
  const longSpaceTriggered = useRef(false);
  const moduleIdsRef = useRef<Array<ModuleId>>([]);

  const { t } = useTranslation();
  const animationDirection = config.panelAnimation || 'bottom';
  const variants = useMemo(() => getAnimationVariants(animationDirection), [animationDirection]);
  const availableModuleIds = useMemo(
    () => getAvailableModuleIds(config).filter((id) => licenseModuleAccess[id] !== false),
    [config, licenseModuleAccess],
  );

  useEffect(() => {
    moduleIdsRef.current = availableModuleIds;
  }, [availableModuleIds]);

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
  }, [api]);
  useEffect(() => {
    if (!api?.getLicenseGate) {
      setLicenseGate({ required: false, activated: true, checking: false });
      return;
    }
    api.getLicenseState().then((state) => {
      setInitialLicenseCode((state as any)?.code || '');
    }).catch(() => undefined);
    const applyGate = (gateInfo: any) => {
      setLicenseGate(gateInfo);
      if (gateInfo && (gateInfo.success === true || gateInfo.activationPolicy || gateInfo.moduleAccess)) {
        useStore.getState().setLicenseAccess({
          activationPolicy: gateInfo.activationPolicy,
          moduleAccess: gateInfo.moduleAccess,
          featureAccess: gateInfo.featureAccess,
          tier: gateInfo.tier,
          guestEnabled: gateInfo.guestEnabled,
          contactLine: gateInfo.contactLine,
        });
      }
      if (!gateInfo?.required) {
        void api.licenseGatePassed?.();
      }
    };
    api.getLicenseGate().then(applyGate).catch(() => {
      const stored = useStore.getState().config.license;
      const policy = stored?.activationPolicy || 'none';
      setLicenseGate({
        required: policy !== 'none',
        activated: false,
        checking: false,
        message: '无法连接激活服务器，请检查网络后重试',
        activationPolicy: policy,
      });
      if (policy === 'none') {
        void api?.licenseGatePassed?.();
      }
    });
    const unsub = api.onLicenseChanged?.((next) => {
      applyGate(next as any);
    });
    return () => unsub?.();
  }, [api]);
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);
  useEffect(() => {
    if (!api?.onUpdateState) return;
    api.getUpdateState().then(setUpdateState).catch(() => undefined);
    const unsubscribe = api.onUpdateState((nextState) => {
      setUpdateState(nextState);
      if (nextState.status === 'available' || (nextState.status === 'error' && !!nextState.manual)) {
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
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const state = useStore.getState();
      const isModalOpen = state.showAddModal || state.showSettings || state.showImportSoftware || !!document.querySelector('[data-task-modal], [data-update-modal], [data-keyboard-shortcuts-modal]');
      if (isEditableTarget(event.target) || isModalOpen) return;

      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'x') {
        event.preventDefault();
        const moduleIds = moduleIdsRef.current;
        if (moduleIds.length === 0) return;
        const currentModule = state.activeModule === 'usageManage' ? 'usage' : state.activeModule;
        const currentIndex = Math.max(0, moduleIds.indexOf(currentModule));
        const direction = key === 'z' ? -1 : 1;
        state.setActiveModule(moduleIds[(currentIndex + direction + moduleIds.length) % moduleIds.length]);
        return;
      }

      if (!(event.code === 'Space' || event.key === ' ')) return;
      event.preventDefault();
      if (spaceDownAt.current !== null) return;
      spaceDownAt.current = performance.now();
      longSpaceTriggered.current = false;
      clearLongPress();
      longSpaceTimer.current = window.setTimeout(() => {
        const latest = useStore.getState();
        const moduleIds = moduleIdsRef.current;
        if (moduleIds.length === 0) return;
        const currentModule = latest.activeModule === 'usageManage' ? 'usage' : latest.activeModule;
        const currentIndex = Math.max(0, moduleIds.indexOf(currentModule));
        latest.setActiveModule(moduleIds[(currentIndex + 1) % moduleIds.length]);
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
        } else if (latest.activeModule === 'translate') {
          window.dispatchEvent(new Event('translate:toggle-input'));
        } else if (latest.activeModule === 'usage') {
          window.dispatchEvent(new Event('usage:toggle-view'));
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
    if (!api?.onTaskLocate) return;
    const unsubscribe = api.onTaskLocate((data) => {
      const locate = data as { boardId?: string; taskId?: string };
      if (!locate?.boardId || !locate.taskId) return;
      useStore.getState().setActiveModule('tasks');
      useStore.getState().setActiveTaskBoard(locate.boardId);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('task:locate-request', { detail: { taskId: locate.taskId } }));
      }, 150);
    });
    return unsubscribe;
  }, [api]);
  useEffect(() => {
    if (!api?.onConfigChanged) return;
    const unsubscribe = api.onConfigChanged(() => {
      void useStore.getState().loadConfig();
    });
    return unsubscribe;
  }, [api]);
  useEffect(() => {
    if (!api?.onShortcutFailed) return;
    const unsubscribe = api.onShortcutFailed((data) => {
      const info = data as { accelerator?: string; name?: string };
      addToast(`${info.name || '快捷键'} ${info.accelerator || ''} 注册失败，可能被其他软件占用`, 'error');
    });
    return unsubscribe;
  }, [api, addToast]);
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

  if (licenseGate?.required) {
    return (
      <ActivationGate
        checking={licenseGate.checking}
        machineCode={licenseGate.machineCode}
        initialCode={initialLicenseCode}
        message={licenseGate.message}
        onActivated={(result) => {
          const license = (result || {}) as any;
          setLicenseGate({ required: false, activated: true, checking: false });
          setActivationPromptDismissed(true);
          useStore.getState().setLicenseAccess({
            activationPolicy: license?.activationPolicy,
            moduleAccess: license?.moduleAccess,
            featureAccess: license?.featureAccess,
            tier: license?.tier,
            guestEnabled: license?.guestEnabled,
            contactLine: license?.contactLine,
          });
          void api?.licenseGatePassed?.();
        }}
      />
    );
  }

  const showActivationBanner = !!licenseGate
    && licenseGate.activationPolicy !== undefined
    && licenseGate.activationPolicy !== 'none'
    && !licenseGate.activated
    && licenseGate.guestEnabled
    && !activationPromptDismissed;

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
            {licenseGate && licenseGate.activationPolicy !== undefined && (
              <button
                type="button"
                onClick={() => setActiveModule('activation')}
                className="no-drag flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-75"
                style={{
                  background: licenseGate.activated ? 'rgba(99,211,145,.16)' : 'rgba(251,146,60,.16)',
                  color: licenseGate.activated ? '#63d391' : '#fb923c',
                  border: `1px solid ${licenseGate.activated ? 'rgba(99,211,145,.4)' : 'rgba(251,146,60,.4)'}`,
                }}
                title="激活状态，点击打开激活板块"
              >
                {licenseGate.activated ? `已激活${licenseGate.tier ? ' · ' + licenseGate.tier : ''}` : '未激活'}
              </button>
            )}
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

        {showActivationBanner && (
          <div
            className="no-drag flex items-center justify-between gap-3 px-4 py-1.5 shrink-0"
            style={{
              background: 'linear-gradient(90deg, rgba(124,58,237,.28), rgba(37,99,235,.28))',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
              当前为未激活模式，仅可使用已开放的板块。{licenseGate?.contactLine || '激活码请联系管理员获取'}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setActiveModule('activation')}
                className="rounded-md px-2 py-0.5 text-[11px] font-medium hover:opacity-80"
                style={{ background: 'var(--color-accent)', color: 'white' }}
              >
                去激活
              </button>
              <button
                type="button"
                onClick={() => setActivationPromptDismissed(true)}
                className="rounded-md px-1.5 py-0.5 text-[11px] hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
                title="关闭提示"
              >
                ✕
              </button>
            </div>
          </div>
        )}

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
            ) : activeModule === 'cockpit' ? (
              <CockpitPanel />
            ) : activeModule === 'usage' ? (
              <UsagePanel />
            ) : activeModule === 'usageManage' ? (
              <UsageManagePanel />
            ) : activeModule === 'island' ? (
              <IslandPanel />
            ) : activeModule === 'codexProvider' ? (
              <CodexProviderPanel />
            ) : activeModule === 'activation' ? (
              <ActivationPanel />
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
