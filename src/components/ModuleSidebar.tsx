import { CheckSquare, Grid2X2, Settings } from 'lucide-react';
import { useStore } from '../store';
import { ModuleId } from '../types';

const modules: Array<{ id: ModuleId; label: string; icon: typeof Grid2X2 }> = [
  { id: 'shortcuts', label: '快捷', icon: Grid2X2 },
  { id: 'tasks', label: '任务', icon: CheckSquare },
];

export default function ModuleSidebar() {
  const activeModule = useStore((state) => state.activeModule);
  const setActiveModule = useStore((state) => state.setActiveModule);
  const openSettings = useStore((state) => state.openSettings);

  return (
    <aside
      className="no-drag flex w-16 shrink-0 flex-col items-center gap-2 px-2 py-3"
      style={{ borderRight: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
    >
      <div className="flex flex-col gap-2">
        {modules.map(({ id, label, icon: Icon }) => {
          const active = activeModule === id;
          return (
            <button
              key={id}
              onClick={() => setActiveModule(id)}
              className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] transition-all duration-150"
              style={{
                background: active ? 'var(--color-accent)' : 'var(--color-bg-card)',
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: active ? 'white' : 'var(--color-text-secondary)',
                boxShadow: active ? '0 4px 14px var(--color-accent-glow)' : 'none',
              }}
              title={label}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto">
        <button
          onClick={openSettings}
          className="flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 hover:opacity-80"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          title="设置"
        >
          <Settings size={17} />
        </button>
      </div>
    </aside>
  );
}
