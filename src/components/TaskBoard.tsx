import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, FileText, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { TaskBoardConfig, TaskEditorDraft, TaskNote } from '../types';
import TaskDateTimePicker, { createDefaultReminderValue } from './TaskDateTimePicker';

const tapePositions = ['left', 'right', 'center'];
type TaskEditorState = Omit<TaskEditorDraft, 'boardId'>;

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
  const setTaskEditorDraft = useStore((state) => state.setTaskEditorDraft);
  const wallRef = useRef<HTMLDivElement>(null);
  const taskInputRef = useRef<HTMLInputElement>(null);
  const lastInputSpaceAt = useRef(0);
  const [draft, setDraft] = useState('');
  const [longTextEnabled, setLongTextEnabled] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const lastDragReportRef = useRef(0);

  const taskBoards = config.taskBoards?.length ? config.taskBoards : [];
  const activeBoard = taskBoards.find((board) => board.id === config.activeTaskBoardId) || taskBoards[0];
  const tasks = activeBoard?.notes || [];

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const note = wallRef.current?.querySelector<HTMLElement>(`[data-task-id="${detail?.taskId}"]`);
      if (!note) return;
      note.scrollIntoView({ behavior: 'smooth', block: 'center' });
      note.classList.add('locate-highlight');
      window.setTimeout(() => note.classList.remove('locate-highlight'), 2200);
    };
    window.addEventListener('task:locate-request', handler);
    return () => window.removeEventListener('task:locate-request', handler);
  }, []);
  const renamingBoard = taskBoards.find((board) => board.id === renamingBoardId);
  const editor = config.taskEditorDraft?.boardId === activeBoard?.id ? config.taskEditorDraft : null;
  const setEditor = (nextEditor: TaskEditorState | null) => {
    setTaskEditorDraft(nextEditor && activeBoard ? { ...nextEditor, boardId: activeBoard.id } : null);
  };

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

  useEffect(() => {
    const toggleTaskType = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]') || editor || renamingBoardId) return;
      if (event.code === 'Digit1' || event.code === 'Numpad1') {
        event.preventDefault();
        setLongTextEnabled((enabled) => !enabled);
      } else if (event.code === 'Digit2' || event.code === 'Numpad2') {
        event.preventDefault();
        setReminderEnabled((enabled) => !enabled);
      }
    };
    window.addEventListener('keydown', toggleTaskType);
    return () => window.removeEventListener('keydown', toggleTaskType);
  }, [editor, renamingBoardId]);
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
      reminderAt: reminderEnabled ? createDefaultReminderValue() : '',
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
    let lastScreenX = 0;
    let lastScreenY = 0;

    setConfirmDeleteId(null);
    setDraggingId(task.id);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dy = ((moveEvent.clientY - startY) / rect.height) * 100;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 1) return;
      moved = true;
      lastScreenX = moveEvent.screenX;
      lastScreenY = moveEvent.screenY;
      latestX = Math.max(-6, Math.min(88, originalX + dx));
      latestY = Math.max(-4, Math.min(84, originalY + dy));
      const now = Date.now();
      if (now - lastDragReportRef.current > 100) {
        lastDragReportRef.current = now;
        void window.electronAPI?.overlapTaskDrag?.(lastScreenX, lastScreenY, activeBoard.id, task.id);
      }
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
        void window.electronAPI?.dropTaskOnList?.(lastScreenX, lastScreenY, activeBoard.id, task.id);
      }
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
  };

  const removeTask = (taskId: string) => {
    const note = wallRef.current?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
    if (note) {
      const rect = note.getBoundingClientRect();
      note.style.setProperty('--shred-x', `${window.innerWidth / 2 - (rect.left + rect.width / 2)}px`);
      note.style.setProperty('--shred-y', `${window.innerHeight / 2 - 12 - (rect.top + rect.height / 2)}px`);
    }
    setDeletingId(taskId);
    setConfirmDeleteId(null);
    window.setTimeout(() => {
      deleteTask(taskId);
      setDeletingId((current) => current === taskId ? null : current);
    }, 920);
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
        .task-note.locate-highlight { outline: 3px solid rgba(91,134,229,.95); box-shadow: 0 0 26px rgba(91,134,229,.85); }
        .task-note.tearing { animation: taskFeedShredder .92s cubic-bezier(.55,.02,.72,.42) forwards; pointer-events: none; z-index: 12000 !important; }
        @keyframes taskFeedShredder {
          0% { opacity: 1; transform: rotate(var(--r)) scale(1); }
          58% { opacity: 1; transform: translate(var(--shred-x), calc(var(--shred-y) - 38px)) rotate(0deg) scale(.72); }
          82% { opacity: .95; transform: translate(var(--shred-x), calc(var(--shred-y) - 8px)) rotate(0deg) scale(.62,.38); }
          100% { opacity: 0; transform: translate(var(--shred-x), calc(var(--shred-y) + 8px)) rotate(0deg) scale(.5,.02); }
        }
        .task-shredder-strip { animation: shredderStrip .5s ease-in forwards; opacity: 0; }
        @keyframes shredderStrip {
          0% { opacity: 0; transform: translateY(-3px) rotate(var(--strip-r)); }
          20% { opacity: 1; }
          100% { opacity: 0; transform: translateY(62px) rotate(calc(var(--strip-r) * -1)); }
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

      <AnimatePresence>
        {deletingId && (
          <motion.div className="pointer-events-none fixed left-1/2 top-1/2 z-[13000] -translate-x-1/2 -translate-y-1/2" initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}>
            <div className="relative h-20 w-44 rounded-md border border-[#171210] bg-[#39312c] shadow-[0_14px_34px_rgba(0,0,0,.58)]">
              <div className="absolute left-3 right-3 top-3 h-2 rounded-full bg-black shadow-[inset_0_2px_4px_rgba(0,0,0,.9)]" />
              <div className="absolute left-5 right-5 top-8 h-px bg-white/10" />
              <div className="absolute bottom-3 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-[#9b2335] shadow-[0_0_7px_#9b2335]" />
              <div className="absolute left-4 right-4 top-[72px] -z-10 flex justify-around overflow-visible">
                {Array.from({ length: 9 }, (_, index) => (
                  <span key={index} className="task-shredder-strip h-12 w-2 bg-[#e7ded0]" style={{ '--strip-r': `${index % 2 ? 5 : -4}deg`, animationDelay: `${480 + index * 24}ms` } as React.CSSProperties} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
              if (event.key === ' ') {
                const now = performance.now();
                if (now - lastInputSpaceAt.current < 320) {
                  event.preventDefault();
                  lastInputSpaceAt.current = 0;
                  setDraft((current) => current.endsWith(' ') ? current.slice(0, -1) : current);
                  taskInputRef.current?.blur();
                  return;
                }
                lastInputSpaceAt.current = now;
              }
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
            className="fixed inset-0 z-[230] flex items-center justify-center p-3 sm:p-6"
            style={{ background: 'rgba(12, 9, 8, .82)', backdropFilter: 'blur(5px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEditor(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditor(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              transition={{ type: 'spring', damping: 25, stiffness: 320 }}
              className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border"
              style={{
                background: '#f3eee5',
                borderColor: '#5f4b3e',
                color: '#2c2416',
                boxShadow: '0 28px 80px rgba(0,0,0,.62)',
                fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex shrink-0 items-center justify-between px-5 py-4" style={{ background: '#29231f', borderBottom: '3px solid #9b2335' }}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded" style={{ background: '#9b2335', color: '#fff8ed' }}>
                    <FileText size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold" style={{ color: '#fff8ed' }}>
                      {editor.taskId ? '编辑任务' : '新建任务'}
                    </div>
                    <div className="mt-0.5 text-xs" style={{ color: '#b9ab9a' }}>
                      {editor.longText && editor.reminderEnabled ? '长文本与待办提醒' : editor.longText ? '长文本任务' : editor.reminderEnabled ? '待办提醒' : '普通任务'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded transition-colors hover:bg-white/10"
                  style={{ color: '#d7cabc' }}
                  title="关闭"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                <label className="mb-5 block">
                  <span className="mb-2 block text-xs font-semibold" style={{ color: '#746550' }}>任务标题</span>
                  <input
                    value={editor.title}
                    onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                    autoFocus={!editor.longText && !editor.reminderEnabled}
                    maxLength={120}
                    className="w-full rounded-md border bg-[#fffdf8] px-3 py-3 text-base outline-none transition-colors focus:border-[#9b2335]"
                    style={{ borderColor: '#cbbda8', color: '#2c2416', boxShadow: 'inset 3px 0 0 #9b2335' }}
                  />
                </label>

                <div className="mb-5">
                  <div className="mb-2 text-xs font-semibold" style={{ color: '#746550' }}>任务类型</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditor({ ...editor, longText: !editor.longText })}
                      aria-pressed={editor.longText}
                      className="flex h-11 items-center justify-center gap-2 rounded border text-sm transition-all duration-150"
                      style={{
                        background: editor.longText ? '#eadbbd' : '#fffdf8',
                        borderColor: editor.longText ? '#b99552' : '#cbbda8',
                        color: editor.longText ? '#664711' : '#655845',
                        boxShadow: editor.longText ? 'inset 0 -2px 0 #b99552' : 'none',
                      }}
                    >
                      <FileText size={16} /> 长文本
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextEnabled = !editor.reminderEnabled;
                        setEditor({
                          ...editor,
                          reminderEnabled: nextEnabled,
                          reminderAt: nextEnabled && !editor.reminderAt ? createDefaultReminderValue() : editor.reminderAt,
                        });
                      }}
                      aria-pressed={editor.reminderEnabled}
                      className="flex h-11 items-center justify-center gap-2 rounded border text-sm transition-all duration-150"
                      style={{
                        background: editor.reminderEnabled ? '#efd8dc' : '#fffdf8',
                        borderColor: editor.reminderEnabled ? '#bd7180' : '#cbbda8',
                        color: editor.reminderEnabled ? '#85283a' : '#655845',
                        boxShadow: editor.reminderEnabled ? 'inset 0 -2px 0 #bd7180' : 'none',
                      }}
                    >
                      <Bell size={16} /> 待办提醒
                    </button>
                  </div>
                </div>

                {editor.longText && (
                  <section className="mb-5">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: '#746550' }}>
                      <FileText size={14} />
                      正文
                    </div>
                    <textarea
                      value={editor.details}
                      onChange={(event) => setEditor({ ...editor, details: event.target.value })}
                      autoFocus
                      rows={7}
                      placeholder="写下任务详情..."
                      className="w-full resize-y rounded-md border px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-[#9b2335]"
                      style={{
                        minHeight: '190px',
                        borderColor: '#cbbda8',
                        color: '#2c2416',
                        backgroundColor: '#fffdf8',
                        backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, rgba(108,88,61,.12) 27px, rgba(108,88,61,.12) 28px)',
                        backgroundPosition: '0 12px',
                      }}
                    />
                  </section>
                )}

                {editor.reminderEnabled && (
                  <section>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: '#746550' }}>
                      <Bell size={14} />
                      提醒日期与时间
                    </div>
                    <TaskDateTimePicker
                      value={editor.reminderAt}
                      onChange={(reminderAt) => setEditor({ ...editor, reminderAt })}
                    />
                  </section>
                )}
              </div>

              <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-4" style={{ borderColor: '#d6cabb', background: '#e9e0d3' }}>
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="rounded border px-4 py-2.5 text-sm transition-colors hover:bg-[#ddd1c1]"
                  style={{ borderColor: '#bfb19e', color: '#645744' }}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveTaskEditor}
                  disabled={!editor.title.trim() || (editor.reminderEnabled && !editor.reminderAt)}
                  className="rounded px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: '#9b2335', color: '#fff8ed' }}
                >
                  保存任务
                </button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
