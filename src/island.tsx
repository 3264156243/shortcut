import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './island.css';

type IslandStyle = 'capsule' | 'glass' | 'paper';
type IslandPosition = 'top-center' | 'top-left' | 'top-right' | 'left-center' | 'right-center';

interface IslandState {
  enabled: boolean;
  style: IslandStyle;
  position: IslandPosition;
  autoHideFullscreen: boolean;
}

const DEFAULT_STATE: IslandState = {
  enabled: true,
  style: 'capsule',
  position: 'top-center',
  autoHideFullscreen: true,
};

function nowText(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + pad(d.getMilliseconds());
}

function dateText(): string {
  const d = new Date();
  const week = ['?','?','?','?','?','?','?'][d.getDay()];
  return d.getMonth() + 1 + '?' + d.getDate() + '? ??' + week;
}

function IslandApp() {
  const [state, setState] = useState<IslandState>(DEFAULT_STATE);
  const [time, setTime] = useState(nowText);
  const [hovered, setHovered] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(nowText()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await window.electronAPI?.readConfig();
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const prefs = parsed?.island || {};
        setState({
          enabled: prefs.enabled === true,
          style: prefs.style || 'capsule',
          position: prefs.position || 'top-center',
          autoHideFullscreen: prefs.autoHideFullscreen !== false,
        });
      } catch {}
    };
    void load();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onIslandConfig?.((prefs: unknown) => {
      if (!prefs) return;
      const next = prefs as Partial<IslandState>;
      setState((current) => ({
        ...current,
        enabled: next.enabled ?? current.enabled,
        style: next.style ?? current.style,
        position: next.position ?? current.position,
        autoHideFullscreen: next.autoHideFullscreen ?? current.autoHideFullscreen,
      }));
    });
    return unsubscribe;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { sx: e.screenX, sy: e.screenY, ox: e.clientX, oy: e.clientY };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const deltaX = e.screenX - dragRef.current.sx;
    const deltaY = e.screenY - dragRef.current.sy;
    window.electronAPI?.moveIsland(dragRef.current.sx, dragRef.current.sy, deltaX, deltaY);
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const expanded = hovered || dragging;
  return (
    <div
      className={['island-root', state.style, expanded ? 'expanded' : 'collapsed'].join(' ')}
      data-position={state.position}
      data-drag={dragging ? 'true' : 'false'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="island-pill">
        <div className="island-drag-handle" title="???????" />
        <div className="island-time">{time}</div>
        <div className="island-date">{dateText()}</div>
        <div className="island-dot" />
      </div>
      <div className="island-panel">
        <div className="island-panel-title">ShortCut ???</div>
        <div className="island-panel-clock">{time}</div>
        <div className="island-panel-date">{dateText()}</div>
        <div className="island-panel-hint">??????????</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<IslandApp />);
