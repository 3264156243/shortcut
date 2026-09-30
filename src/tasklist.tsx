import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Film, Settings, Trash2 } from 'lucide-react';
import './tasklist.css';

interface TaskListItem {
  boardId: string;
  taskId: string;
  title: string;
  done: boolean;
  addedAt: string;
}

interface IslandConfig {
  enabled?: boolean;
  style?: string;
  position?: string;
  autoHideFullscreen?: boolean;
  musicEnabled?: boolean;
  lyricBounce?: boolean;
  displayState?: string;
  orbitGlow?: boolean;
  barsEnabled?: boolean;
  tasksEnabled?: boolean;
  cockpitEnabled?: boolean;
  balanceProvider?: string;
}

function TaskListApp() {
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [typingIds, setTypingIds] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [tasksEnabled, setTasksEnabled] = useState(true);
  const prevIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const applyData = (raw: unknown) => {
      const next = (Array.isArray(raw) ? raw : []) as TaskListItem[];
      const prev = prevIdsRef.current;
      const newIds = next
        .map((item) => item.taskId)
        .filter((id) => !prev.includes(id));
      setItems(next);
      prevIdsRef.current = next.map((item) => item.taskId);
      if (newIds.length) {
        setTypingIds(newIds);
        const timer = window.setTimeout(() => setTypingIds([]), 1600);
        return () => window.clearTimeout(timer);
      }
    };
    const unsubscribe = window.electronAPI?.onTaskListData?.((data: unknown) => {
      applyData(data);
    });
    void window.electronAPI?.getTaskList?.().then((data: unknown) => applyData(data));
    return unsubscribe;
  }, []);

  // 打开设置浮层时拉取当前岛配置（含 tasksEnabled）
  const toggleSettings = () => {
    if (!showSettings) {
      void window.electronAPI?.getIslandState?.().then((cfg: IslandConfig) => {
        setTasksEnabled(cfg?.tasksEnabled !== false);
      });
    }
    setShowSettings((v) => !v);
  };

  // 任务模块开关：写入配置。禁用 → Rust 销毁任务墙（本设置浮层随之关闭）
  const setTasksModule = (v: boolean) => {
    setTasksEnabled(v);
    void window.electronAPI?.getIslandState?.().then((cfg: IslandConfig) => {
      void window.electronAPI?.setIsland(
        cfg?.enabled !== false,
        cfg?.style || 'capsule',
        cfg?.position || 'top-center',
        cfg?.autoHideFullscreen !== false,
        cfg?.musicEnabled !== false,
        cfg?.lyricBounce !== false,
        cfg?.displayState || 'collapsed',
        cfg?.orbitGlow !== false,
        cfg?.barsEnabled !== false,
        v,
        cfg?.cockpitEnabled === true,
        cfg?.balanceProvider || 'none',
      );
    });
  };

  const remove = (item: TaskListItem) => {
    void window.electronAPI?.removeTaskFromList?.(item.boardId, item.taskId);
  };

  const complete = (item: TaskListItem) => {
    void window.electronAPI?.completeTaskInList?.(item.boardId, item.taskId);
  };

  const locate = (item: TaskListItem) => {
    void window.electronAPI?.locateTaskFromList?.(item.boardId, item.taskId);
  };

  return (
    <div className="tasklist-root">
      <div className="tasklist-header">
        <span>SC任务清单</span>
        <button
          className="tasklist-settings-btn"
          onClick={toggleSettings}
          title="任务清单设置"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 2, borderRadius: 6, display: 'flex', alignItems: 'center',
            color: showSettings ? 'var(--color-accent, #6366f1)' : 'inherit',
          }}
        >
          <Settings size={13} />
        </button>
      </div>
      <AnimatePresence>
        {showSettings && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                margin: '6px 10px 2px', padding: '10px 12px', borderRadius: 12,
                background: 'rgba(20,20,26,0.92)', border: '1px solid rgba(255,255,255,0.10)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)' }}>任务模块</span>
                <input
                  type="checkbox"
                  checked={tasksEnabled}
                  onChange={(e) => setTasksModule(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#6366f1', cursor: 'pointer' }}
                />
              </label>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Film size={12} /> 禁用后按 Alt+U 重新启用
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="tasklist-items">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.taskId}
              initial={{ opacity: 0, y: -18, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 260 }}
              className={`tasklist-item ${item.done ? 'done' : ''} ${typingIds.includes(item.taskId) ? 'typing' : ''}`}
              onClick={() => locate(item)}
            >
              <span className="tasklist-title">{item.title || '无标题任务'}</span>
              <div className="tasklist-actions" onClick={(e) => e.stopPropagation()}>
                <button className="tasklist-button complete" onClick={() => complete(item)} title="完成">
                  {item.done ? <Check size={13} strokeWidth={3} /> : null}
                </button>
                <button className="tasklist-button remove" onClick={() => remove(item)} title="从清单移除">
                  <Trash2 size={12} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<TaskListApp />);
