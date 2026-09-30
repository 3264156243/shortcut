import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Trash2 } from 'lucide-react';
import './tasklist.css';

interface TaskListItem {
  boardId: string;
  taskId: string;
  title: string;
  done: boolean;
  addedAt: string;
}

function TaskListApp() {
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [typingIds, setTypingIds] = useState<string[]>([]);
  const prevIdsRef = useRef<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  // 窗口高度跟随内容（不留透明空白区挡鼠标；宽度固定 340，高度钳制在 header~430）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => {
      const h = Math.min(430, Math.max(34, Math.ceil(el.getBoundingClientRect().height)));
      void window.electronAPI?.resizeWindow?.(340, h);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    <div className="tasklist-root" ref={rootRef}>
      <div className="tasklist-header">SC任务清单</div>
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
