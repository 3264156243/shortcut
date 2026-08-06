import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './reminder.css';

interface ReminderData {
  boardId: string;
  taskId: string;
  title: string;
}

function ReminderApp() {
  const [data, setData] = useState<ReminderData | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onReminderData?.((raw) => {
      if (raw) setData(raw as ReminderData);
    });
    void window.electronAPI?.getReminderData?.().then((raw) => {
      if (raw) setData(raw as ReminderData);
    });
    return unsubscribe;
  }, []);

  const confirm = () => {
    if (!data) return;
    void window.electronAPI?.confirmReminder?.(data.boardId, data.taskId);
  };

  const view = () => {
    if (!data) return;
    void window.electronAPI?.viewReminder?.(data.boardId, data.taskId);
  };

  return (
    <div className="reminder-root">
      <div className="reminder-tape" />
      <div className="reminder-body">
        <div className="reminder-label">任务提醒</div>
        <div className="reminder-title">{data?.title || '任务提醒'}</div>
        <div className="reminder-actions">
          <button className="reminder-button view" onClick={view}>查看</button>
          <button className="reminder-button confirm" onClick={confirm}>确认</button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ReminderApp />);
