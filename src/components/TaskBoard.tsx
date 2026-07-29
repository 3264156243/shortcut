import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, FileText, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { TaskBoardConfig, TaskNote } from '../types';

const tapePositions = ['left', 'right', 'center'];
interface TaskEditorState {
  taskId: string | null;
  title: string;
  longText: boolean;
  details: string;
  reminderEnabled: boolean;
  reminderAt: string;
  originalReminderAt?: string;
  originalRemindedAt?: string;
}

const toDateTimeLocal = (iso?: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return [date.getFullYear(), '-', pad(date.getMonth() + 1), '-', pad(date.getDate()), 'T', pad(date.getHours()), ':', pad(date.getMinutes())].join('');
};

const formatReminder = (iso: string) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '时间无效';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function TaskBoard() {
  const config = useStore((state) => state.config);
  const addTaskBoard = useStore((state) => state.addTaskBoard);
  const renameTaskBoard = useStore((state) => state.renameTaskBoard);
  const deleteTaskBoard = useStore((state) => state.deleteTaskBoard);
  const setActiveTaskBoard = useStore((state) => state.setActiveTaskBoard);
  const addTask = useStore((state) => state.addTask);
  const updateTask = useStore((state) => state.updateTask);
  const toggleTask = useStore((state) => state.toggleTask);
  const deleteTask = useStore((state) => state.deleteTask);
  const moveTask = useStore((state) => state.moveTask);
  const wallRef = useRef<HTMLDivElement>(null);
  const taskInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [longTextEnabled, setLongTextEnabled] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [editor, setEditor] = useState<TaskEditorState | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const taskBoards = config.taskBoards?.length ? config.taskBoards : [];
  const activeBoard = taskBoards.find((board) => board.id === config.activeTaskBoardId) || taskBoards[0];
  const tasks = activeBoard?.notes || [];
  const renamingBoard = taskBoards.find((board) => board.id === renamingBoardId);

  useEffect(() => {
    setConfirmDeleteId(null);
  }, [activeBoard?.id]);
  useEffect(() => {
    const focusInput = () => {
      window.requestAnimationFrame(() => {
        taskInputRef.current?.focus();
        taskInputRef.current?.select();
      });
    };
    window.addEventListener('task:focus-input', focusInput);
    return () => window.removeEventListener('task:focus-input', focusInput);
  }, []);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (!longTextEnabled && !reminderEnabled) {
      addTask(text);
      setDraft('');
      return;
    }
    setEditor({
      taskId: null,
      title: text,
      longText: longTextEnabled,
      details: '',
      reminderEnabled,
      reminderAt: '',
    });
    setDraft('');
  };

  const openTaskEditor = (task: TaskNote) => {
    setConfirmDeleteId(null);
    setEditor({
      taskId: task.id,
      title: task.text,
      longText: !!task.longText,
      details: task.details || '',
      reminderEnabled: !!task.reminderAt,
      reminderAt: toDateTimeLocal(task.reminderAt),
      originalReminderAt: task.reminderAt,
      originalRemindedAt: task.remindedAt,
    });
  };

  const saveTaskEditor = () => {
    if (!editor) return;
    const title = editor.title.trim();
    if (!title || (editor.reminderEnabled && !editor.reminderAt)) return;
    const reminderDate = editor.reminderEnabled ? new Date(editor.reminderAt) : null;
    if (reminderDate && !Number.isFinite(reminderDate.getTime())) return;
    const reminderAt = reminderDate?.toISOString();
    const details = editor.longText ? editor.details.trim() : undefined;
    const reminderChanged = editor.reminderAt !== toDateTimeLocal(editor.originalReminderAt);

    if (editor.taskId) {
      updateTask(editor.taskId, {
        text: title,
        longText: editor.longText || undefined,
        details,
        reminderAt,
        remindedAt: reminderChanged ? undefined : editor.originalRemindedAt,
      });
    } else {
      addTask(title, { longText: editor.longText, details, reminderAt });
    }
    setEditor(null);
  };
  const openRenameBoard = (board: TaskBoardConfig) => {
    setActiveTaskBoard(board.id);
    setNameDraft(board.name);
    setRenamingBoardId(board.id);
  };

  const commitBoardName = () => {
    if (!renamingBoardId) return;
    const nextName = nameDraft.trim();
    if (!nextName) return;
    if (nextName !== renamingBoard?.name) {
      renameTaskBoard(renamingBoardId, nextName);
    }
    setRenamingBoardId(null);
  };

  const createBoard = () => {
    addTaskBoard(`任务墙 ${taskBoards.length + 1}`);
  };

  const removeBoard = () => {
    if (!activeBoard || taskBoards.length <= 1) return;
    const ok = window.confirm(`确定删除“${activeBoard.name}”及其中所有任务吗？`);
    if (ok) {
      deleteTaskBoard(activeBoard.id);
    }
  };

  const startDrag = (task: TaskNote, event: React.PointerEvent<HTMLDivElement>) => {
    const wall = wallRef.current;
    if (!wall) return;

    const target = event.target as HTMLElement;
    if (target.closest('[data-task-action]')) return;

    const rect = wall.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originalX = task.x;
    const originalY = task.y;
    let latestX = task.x;
    let latestY = task.y;
    let moved = false;

    setConfirmDeleteId(null);
    setDraggingId(task.id);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dy = ((moveEvent.clientY - startY) / rect.height) * 100;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 1) return;
      moved = true;
      latestX = Math.max(-6, Math.min(88, originalX + dx));
      latestY = Math.max(-4, Math.min(84, originalY + dy));
      const note = wall.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`);
      if (note) {
        note.style.left = `${latestX}%`;
        note.style.top = `${latestY}%`;
      }
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      setDraggingId(null);
      if (moved) {
        moveTask(task.id, latestX, latestY);
      }
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
  };

  const removeTask = (taskId: string) => {
    setDeletingId(taskId);
    setConfirmDeleteId(null);
    window.setTimeout(() => {
      deleteTask(taskId);
      setDeletingId((current) => current === taskId ? null : current);
    }, 420);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ background: '#171210' }}>
      <style>{`
        .task-wall {
          background-color: #1c1714;
          background-image:
            radial-gradient(ellipse at 20% 40%, rgba(60,40,20,.25), transparent 70%),
            radial-gradient(ellipse at 80% 70%, rgba(40,30,15,.2), transparent 60%),
            repeating-linear-gradient(0deg, transparent, transparent 59px, rgba(120,100,80,.05) 59px, rgba(120,100,80,.05) 60px),
            repeating-linear-gradient(90deg, transparent, transparent 59px, rgba(120,100,80,.03) 59px, rgba(120,100,80,.03) 60px);
        }
        .task-note {
          width: 208px;
          min-height: 78px;
          background: #f5f0e8;
          color: #2c2416;
          box-shadow: 2px 3px 10px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.06);
          font-family: 'Special Elite', 'Noto Serif SC', 'SimSun', serif;
          touch-action: none;
          user-select: none;
        }
        .task-note:hover { box-shadow: 3px 5px 16px rgba(0,0,0,.45); }
        .task-note.dragging { box-shadow: 6px 10px 30px rgba(0,0,0,.5); opacity: .94; cursor: grabbing; }
        .task-note.tearing { animation: taskTearOff .42s cubic-bezier(.5,0,1,1) forwards; pointer-events: none; }
        @keyframes taskTearOff {
          0% { opacity: 1; transform: rotate(var(--r)) scale(1); }
          30% { transform: rotate(var(--r)) translateX(-7px); }
          55% { transform: rotate(var(--r)) translateX(7px); }
          100% { opacity: 0; transform: rotate(calc(var(--r) + 15deg)) translateY(80px) scale(.45); }
        }
        .task-note-text::after {
          content: '';
          position: absolute;
          left: -2px;
          right: -2px;
          top: 50%;
          height: 2px;
          background: #888;
          transform: translateY(-50%) scaleX(0);
          transform-origin: left;
          transition: transform .35s cubic-bezier(.4,0,.2,1);
        }
        .task-note.done .task-note-text::after { transform: translateY(-50%) scaleX(1); }
      `}</style>

      <div className="flex shrink-0 items-center gap-2 px-3 py-2" style={{ background: '#171210', borderBottom: '1px solid rgba(245,240,232,.08)' }}>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {taskBoards.map((board) => {
            const active = board.id === activeBoard?.id;
            return (
              <button
                key={board.id}
                onClick={() => setActiveTaskBoard(board.id)}
                onDoubleClick={() => openRenameBoard(board)}
                className="shrink-0 rounded px-3 py-1.5 text-xs transition-all duration-150"
                style={{
                  background: active ? '#9b2335' : 'rgba(245,240,232,.08)',
                  border: `1px solid ${active ? '#9b2335' : 'rgba(245,240,232,.12)'}`,
                  color: active ? '#f5f0e8' : 'rgba(245,240,232,.72)',
                  fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif",
                }}
                title={`${board.name}（双击重命名）`}
              >
                {board.name}
              </button>
            );
          })}
          <button
            onClick={createBoard}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded transition-all duration-150 hover:opacity-85"
            style={{ background: 'rgba(245,240,232,.1)', border: '1px solid rgba(245,240,232,.14)', color: '#f5f0e8' }}
            title="新增任务墙"
          >
            <Plus size={14} />
          </button>
        </div>
        {activeBoard && (
          <div className="flex shrink-0 items-center">
            <button
              onClick={removeBoard}
              disabled={taskBoards.length <= 1}
              className="flex h-8 w-8 items-center justify-center rounded transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-25 hover:opacity-85"
              style={{ background: 'rgba(155,35,53,.18)', border: '1px solid rgba(155,35,53,.35)', color: '#eaa2ad' }}
              title="删除当前任务墙"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div ref={wallRef} className="task-wall relative min-h-0 flex-1 overflow-hidden">
        {tasks.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center" style={{ color: 'rgba(245,240,232,.16)' }}>
            <div className="text-lg tracking-[.2em]">TASK WALL</div>
            <div className="text-sm tracking-[.08em]">在下方输入任务，把纸条钉到墙上</div>
          </div>
        )}

        <AnimatePresence>
          {tasks.map((task, index) => {
            const tapePosition = tapePositions[index % tapePositions.length];
            const confirming = confirmDeleteId === task.id;
            return (
              <motion.div
                key={task.id}
                data-task-id={task.id}
                initial={{ opacity: 0, y: -24, scale: 0.75 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 60, scale: 0.6 }}
                transition={{ type: 'spring', damping: 18, stiffness: 260 }}
                onPointerDown={(event) => startDrag(task, event)}
                onDoubleClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest('[data-task-action]')) return;
                  event.stopPropagation();
                  openTaskEditor(task);
                }}
                className={`task-note absolute cursor-default px-3 pb-3 pt-6 ${task.done ? 'done' : ''} ${draggingId === task.id ? 'dragging' : ''} ${deletingId === task.id ? 'tearing' : ''}`}
                style={{
                  left: `${task.x}%`,
                  top: `${task.y}%`,
                  transform: `rotate(${task.rotation}deg)`,
                  ['--r' as string]: `${task.rotation}deg`,
                  zIndex: draggingId === task.id ? 10000 : (task.zIndex || 1),
                }}
              >
                <div
                  className={`absolute -top-1 h-4 w-12 opacity-55 ${tapePosition === 'left' ? 'left-3 rotate-[-3deg]' : tapePosition === 'right' ? 'right-3 rotate-[2deg]' : 'left-1/2 -ml-6 rotate-[-1deg]'}`}
                  style={{ background: task.tape, border: '1px solid rgba(255,255,255,.07)' }}
                />
                <div className="absolute bottom-0 left-0 top-0 w-[3px] opacity-30" style={{ background: task.tape }} />
                <div className="flex items-start gap-2">
                  <button
                    data-task-action="toggle"
                    onClick={() => toggleTask(task.id)}
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all duration-150 hover:scale-110"
                    style={{ border: `2px solid ${task.done ? '#27694a' : '#8a7e6c'}`, background: task.done ? '#27694a' : 'transparent', color: '#fff' }}
                    title="完成"
                  >
                    {task.done && <Check size={12} strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="task-note-text relative min-h-[1.55em] break-all text-[15px] leading-relaxed" style={{ color: task.done ? '#8a7e6c' : '#2c2416' }}>
                      {task.text}
                    </div>
                    {task.longText && task.details && (
                      <div
                        className="mt-1 overflow-hidden whitespace-pre-wrap break-all text-xs leading-relaxed opacity-60"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                      >
                        {task.details}
                      </div>
                    )}
                    {(task.longText || task.reminderAt) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: '#756853' }}>
                        {task.longText && <span className="flex items-center gap-1"><FileText size={11} /> 长文本</span>}
                        {task.reminderAt && <span className="flex items-center gap-1"><Bell size={11} /> {formatReminder(task.reminderAt)}</span>}
                      </div>
                    )}
                  </div>
                  <button
                    data-task-action="delete"
                    onClick={() => setConfirmDeleteId((current) => current === task.id ? null : task.id)}
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-30 transition-all duration-150 hover:rotate-90 hover:scale-125 hover:opacity-100"
                    style={{ color: '#9b2335' }}
                    title="删除"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {confirming && (
                  <div data-task-action="confirm-delete" className="mt-3 flex justify-end gap-2 text-xs">
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded px-2 py-1 transition-opacity hover:opacity-80"
                      style={{ background: '#e7dfd2', color: '#6b5c48' }}
                    >
                      取消
                    </button>
                    <button
                      onClick={() => removeTask(task.id)}
                      className="rounded px-2 py-1 transition-opacity hover:opacity-80"
                      style={{ background: '#9b2335', color: '#f5f0e8' }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="flex shrink-0 items-end gap-2 px-3 pb-4 pt-3" style={{ background: '#171210', borderTop: '3px solid rgba(120,100,80,.12)' }}>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setLongTextEnabled((enabled) => !enabled)}
            aria-pressed={longTextEnabled}
            className="flex h-11 w-11 items-center justify-center rounded transition-all duration-150"
            style={{
              background: longTextEnabled ? '#efe3c8' : 'rgba(245,240,232,.08)',
              border: '1px solid ' + (longTextEnabled ? '#d0b984' : 'rgba(245,240,232,.14)'),
              color: longTextEnabled ? '#6f4f18' : 'rgba(245,240,232,.68)',
            }}
            title={longTextEnabled ? '关闭长文本' : '开启长文本'}
          >
            <FileText size={18} />
          </button>
          <button
            onClick={() => setReminderEnabled((enabled) => !enabled)}
            aria-pressed={reminderEnabled}
            className="flex h-11 w-11 items-center justify-center rounded transition-all duration-150"
            style={{
              background: reminderEnabled ? '#f2dadd' : 'rgba(245,240,232,.08)',
              border: '1px solid ' + (reminderEnabled ? '#cb8c96' : 'rgba(245,240,232,.14)'),
              color: reminderEnabled ? '#8e2132' : 'rgba(245,240,232,.68)',
            }}
            title={reminderEnabled ? '关闭待办提醒' : '开启待办提醒'}
          >
            <Bell size={18} />
          </button>
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden px-4 pb-2 pt-3" style={{ background: '#f5f0e8', boxShadow: 'inset 0 0 18px rgba(0,0,0,.04), 0 2px 6px rgba(0,0,0,.2)' }}>
          <div className="absolute left-0 right-0 top-0 h-[3px] opacity-40" style={{ background: 'repeating-linear-gradient(90deg,#9b2335 0 5px,transparent 5px 12px)' }} />
          <input
            ref={taskInputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={longTextEnabled || reminderEnabled ? '输入任务标题，按 Enter 继续' : '输入任务，按 Enter 钉到墙上'}
            className="w-full border-none bg-transparent text-[17px] leading-relaxed outline-none"
            style={{ color: '#2c2416', fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif" }}
          />
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={submit}
          disabled={!draft.trim()}
          className="flex h-11 shrink-0 items-center gap-2 px-4 text-sm tracking-wider transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: '#9b2335', color: '#f5f0e8', fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif" }}
        >
          <Plus size={16} /> 钉到墙上
        </motion.button>
      </div>
      <AnimatePresence>
        {renamingBoard && (
          <motion.div
            data-task-modal
            className="fixed inset-0 z-[220] flex items-center justify-center p-5"
            style={{ background: 'rgba(12, 9, 8, .72)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRenamingBoardId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', damping: 24, stiffness: 320 }}
              className="w-full max-w-sm p-5"
              style={{ background: '#f5f0e8', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 text-base font-semibold" style={{ color: '#2c2416' }}>修改任务墙名称</div>
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitBoardName();
                  }
                  if (event.key === 'Escape') {
                    setRenamingBoardId(null);
                  }
                }}
                autoFocus
                maxLength={30}
                className="mb-5 w-full border px-3 py-2.5 text-sm outline-none"
                style={{ borderColor: '#c9beae', background: '#fffdf8', color: '#2c2416' }}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRenamingBoardId(null)}
                  className="px-4 py-2 text-sm transition-opacity hover:opacity-80"
                  style={{ background: '#e7dfd2', color: '#6b5c48' }}
                >
                  取消
                </button>
                <button
                  onClick={commitBoardName}
                  disabled={!nameDraft.trim()}
                  className="px-4 py-2 text-sm transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
                  style={{ background: '#9b2335', color: '#f5f0e8' }}
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editor && (
          <motion.div
            data-task-modal
            className="fixed inset-0 z-[230] flex items-center justify-center p-5"
            style={{ background: 'rgba(12, 9, 8, .78)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEditor(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotate: -1.5, y: 20 }}
              animate={{ opacity: 1, scale: 1, rotate: -0.25, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, rotate: 1, y: 14 }}
              transition={{ type: 'spring', damping: 22, stiffness: 300 }}
              className="relative max-h-[86vh] w-full max-w-xl overflow-y-auto px-6 pb-6 pt-8"
              style={{
                background: '#f5f0e8',
                color: '#2c2416',
                boxShadow: '7px 12px 40px rgba(0,0,0,.55), inset 0 0 30px rgba(120,90,45,.05)',
                fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="absolute left-1/2 top-0 h-5 w-24 -translate-x-1/2 -rotate-1 opacity-55" style={{ background: '#c6a66a' }} />
              <div className="mb-4 text-lg font-semibold">{editor.taskId ? '编辑任务纸条' : '新任务纸条'}</div>

              <label className="mb-4 block text-xs font-semibold" style={{ color: '#756853' }}>
                任务标题
                <input
                  value={editor.title}
                  onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                  autoFocus={!editor.longText && !editor.reminderEnabled}
                  maxLength={120}
                  className="mt-1.5 w-full border-b bg-transparent px-1 py-2 text-base outline-none"
                  style={{ borderColor: '#b9aa94', color: '#2c2416' }}
                />
              </label>

              <div className="mb-4 flex gap-2">
                <button
                  onClick={() => setEditor({ ...editor, longText: !editor.longText })}
                  aria-pressed={editor.longText}
                  className="flex items-center gap-2 rounded px-3 py-2 text-sm transition-opacity hover:opacity-85"
                  style={{
                    background: editor.longText ? '#e8d8b7' : '#e7dfd2',
                    border: '1px solid ' + (editor.longText ? '#c5a96d' : '#c9beae'),
                    color: editor.longText ? '#6f4f18' : '#6b5c48',
                  }}
                >
                  <FileText size={15} /> 长文本
                </button>
                <button
                  onClick={() => setEditor({ ...editor, reminderEnabled: !editor.reminderEnabled })}
                  aria-pressed={editor.reminderEnabled}
                  className="flex items-center gap-2 rounded px-3 py-2 text-sm transition-opacity hover:opacity-85"
                  style={{
                    background: editor.reminderEnabled ? '#efd2d7' : '#e7dfd2',
                    border: '1px solid ' + (editor.reminderEnabled ? '#c9828e' : '#c9beae'),
                    color: editor.reminderEnabled ? '#8e2132' : '#6b5c48',
                  }}
                >
                  <Bell size={15} /> 待办提醒
                </button>
              </div>

              {editor.longText && (
                <label className="mb-4 block text-xs font-semibold" style={{ color: '#756853' }}>
                  纸条正文
                  <textarea
                    value={editor.details}
                    onChange={(event) => setEditor({ ...editor, details: event.target.value })}
                    autoFocus
                    rows={8}
                    placeholder="继续写下详细内容..."
                    className="mt-1.5 w-full resize-y border bg-[#fffdf8] px-3 py-2.5 text-sm leading-relaxed outline-none"
                    style={{ borderColor: '#c9beae', color: '#2c2416' }}
                  />
                </label>
              )}

              {editor.reminderEnabled && (
                <label className="mb-5 block text-xs font-semibold" style={{ color: '#756853' }}>
                  提醒时间
                  <input
                    type="datetime-local"
                    value={editor.reminderAt}
                    onChange={(event) => setEditor({ ...editor, reminderAt: event.target.value })}
                    autoFocus={!editor.longText}
                    className="mt-1.5 w-full border bg-[#fffdf8] px-3 py-2.5 text-sm outline-none"
                    style={{ borderColor: '#c9beae', color: '#2c2416' }}
                  />
                </label>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditor(null)}
                  className="px-4 py-2 text-sm transition-opacity hover:opacity-80"
                  style={{ background: '#e7dfd2', color: '#6b5c48' }}
                >
                  取消
                </button>
                <button
                  onClick={saveTaskEditor}
                  disabled={!editor.title.trim() || (editor.reminderEnabled && !editor.reminderAt)}
                  className="px-5 py-2 text-sm transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
                  style={{ background: '#9b2335', color: '#f5f0e8' }}
                >
                  保存纸条
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
