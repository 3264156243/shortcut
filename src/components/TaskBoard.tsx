import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { TaskNote } from '../types';

const tapePositions = ['left', 'right', 'center'];

export default function TaskBoard() {
  const config = useStore((state) => state.config);
  const addTaskBoard = useStore((state) => state.addTaskBoard);
  const renameTaskBoard = useStore((state) => state.renameTaskBoard);
  const deleteTaskBoard = useStore((state) => state.deleteTaskBoard);
  const setActiveTaskBoard = useStore((state) => state.setActiveTaskBoard);
  const addTask = useStore((state) => state.addTask);
  const toggleTask = useStore((state) => state.toggleTask);
  const deleteTask = useStore((state) => state.deleteTask);
  const moveTask = useStore((state) => state.moveTask);
  const wallRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const taskBoards = config.taskBoards?.length ? config.taskBoards : [];
  const activeBoard = taskBoards.find((board) => board.id === config.activeTaskBoardId) || taskBoards[0];
  const tasks = activeBoard?.notes || [];

  useEffect(() => {
    setNameDraft(activeBoard?.name || '');
    setConfirmDeleteId(null);
  }, [activeBoard?.id, activeBoard?.name]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    addTask(text);
    setDraft('');
  };

  const commitBoardName = () => {
    if (!activeBoard) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      setNameDraft(activeBoard.name);
      return;
    }
    if (nextName !== activeBoard.name) {
      renameTaskBoard(activeBoard.id, nextName);
    }
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

    event.preventDefault();
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
          width: 198px;
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
                className="shrink-0 rounded px-3 py-1.5 text-xs transition-all duration-150"
                style={{
                  background: active ? '#9b2335' : 'rgba(245,240,232,.08)',
                  border: `1px solid ${active ? '#9b2335' : 'rgba(245,240,232,.12)'}`,
                  color: active ? '#f5f0e8' : 'rgba(245,240,232,.72)',
                  fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif",
                }}
                title={board.name}
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
          <div className="flex shrink-0 items-center gap-2">
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitBoardName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  setNameDraft(activeBoard.name);
                  event.currentTarget.blur();
                }
              }}
              className="w-32 rounded border-none px-2 py-1 text-right text-sm outline-none"
              style={{ background: 'rgba(245,240,232,.08)', color: '#f5f0e8', fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif" }}
              title="任务墙名称"
            />
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
                  <div className="task-note-text relative min-h-[1.55em] flex-1 break-all text-[15px] leading-relaxed" style={{ color: task.done ? '#8a7e6c' : '#2c2416' }}>
                    {task.text}
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

      <div className="flex shrink-0 items-end gap-3 px-3 pb-4 pt-3" style={{ background: '#171210', borderTop: '3px solid rgba(120,100,80,.12)' }}>
        <div className="relative flex-1 overflow-hidden px-4 pb-2 pt-3" style={{ background: '#f5f0e8', boxShadow: 'inset 0 0 18px rgba(0,0,0,.04), 0 2px 6px rgba(0,0,0,.2)' }}>
          <div className="absolute left-0 right-0 top-0 h-[3px] opacity-40" style={{ background: 'repeating-linear-gradient(90deg,#9b2335 0 5px,transparent 5px 12px)' }} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="输入任务，按 Enter 钉到墙上"
            className="w-full border-none bg-transparent text-[17px] leading-relaxed outline-none"
            style={{ color: '#2c2416', fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif" }}
          />
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={submit}
          disabled={!draft.trim()}
          className="flex shrink-0 items-center gap-2 px-5 py-3 text-sm tracking-wider transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: '#9b2335', color: '#f5f0e8', fontFamily: "'Special Elite', 'Noto Serif SC', 'SimSun', serif" }}
        >
          <Plus size={16} /> 钉到墙上
        </motion.button>
      </div>
    </div>
  );
}
