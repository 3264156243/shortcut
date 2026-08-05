import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import './island.css';
import type { MusicState } from './types';

type IslandStyle = 'capsule' | 'glass' | 'paper';
type IslandPosition = 'top-center' | 'top-left' | 'top-right' | 'left-center' | 'right-center';

interface IslandState {
  enabled: boolean;
  style: IslandStyle;
  position: IslandPosition;
  autoHideFullscreen: boolean;
  musicEnabled: boolean;
}

interface LyricLine {
  timeMs: number;
  text: string;
}

const DEFAULT_STATE: IslandState = {
  enabled: true,
  style: 'capsule',
  position: 'top-center',
  autoHideFullscreen: true,
  musicEnabled: true,
};

function nowText(): string {
  const d = new Date();
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function dateText(): string {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`;
}

function parseLyrics(lrc: string | null | undefined): LyricLine[] {
  if (!lrc) return [];
  const lines: LyricLine[] = [];
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    const matches = Array.from(raw.matchAll(re));
    if (!matches.length) continue;
    const text = raw.replace(re, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const minutes = Number(m[1]);
      const seconds = Number(m[2]);
      const fractionRaw = m[3] || '0';
      const fraction = Number(fractionRaw) * Math.pow(10, 3 - fractionRaw.length);
      lines.push({ timeMs: minutes * 60000 + seconds * 1000 + fraction, text });
    }
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

function formatTime(ms: number | undefined | null): string {
  if (!Number.isFinite(Number(ms)) || Number(ms) < 0) return '00:00';
  const total = Math.floor(Number(ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function IslandApp() {
  const [state, setState] = useState<IslandState>(DEFAULT_STATE);
  const [time, setTime] = useState(nowText);
  const [hovered, setHovered] = useState(false);
  const [music, setMusic] = useState<MusicState>({ available: false });
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [mini, setMini] = useState(false);
  const [arrival, setArrival] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const draggedRef = useRef(false);
  const positionAnchorRef = useRef<{ positionMs: number; at: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const progressRef = useRef<HTMLDivElement | null>(null);

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
          musicEnabled: prefs.musicEnabled !== false,
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
        musicEnabled: next.musicEnabled ?? current.musicEnabled,
      }));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const applyMusic = (data: MusicState) => {
      setMusic(data);
      positionAnchorRef.current = {
        positionMs: Number(data.positionMs) || 0,
        at: Date.now(),
      };
    };
    const unsubscribe = window.electronAPI?.onIslandMusic?.((data: unknown) => {
      if (data) applyMusic(data as MusicState);
    });
    void window.electronAPI?.startMusicBridge?.();
    void window.electronAPI?.getMusicState?.().then((data: unknown) => {
      if (data) applyMusic(data as MusicState);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!music.available) return;
    setArrival(true);
    const timer = window.setTimeout(() => setArrival(false), 1000);
    return () => window.clearTimeout(timer);
  }, [music.available]);

  const lyrics = useMemo(() => parseLyrics(music.lyrics), [music.lyrics]);
  const anchor = positionAnchorRef.current;
  const extrapolatedMs = anchor && music.isPlaying
    ? anchor.positionMs + Math.max(0, Date.now() - anchor.at)
    : (music.positionMs || 0);
  const basePositionMs = music.durationMs
    ? Math.max(0, Math.min(extrapolatedMs, music.durationMs))
    : extrapolatedMs;
  const positionMs = seekPreview ?? basePositionMs;
  const displayIndex = useMemo(() => {
    if (!lyrics.length) return -1;
    let index = -1;
    for (let i = 0; i < lyrics.length; i++) {
      const start = lyrics[i].timeMs;
      const activation = i === 0 ? start : start - Math.floor((start - lyrics[i - 1].timeMs) / 2);
      if (activation <= positionMs) index = i;
      else break;
    }
    return index;
  }, [lyrics, positionMs]);
  const currentLyric = displayIndex >= 0 ? lyrics[displayIndex].text : (music.title || '');
  const progress = music.durationMs ? Math.max(0, Math.min(100, (positionMs / music.durationMs) * 100)) : 0;

  const onDragStart = (e: React.PointerEvent) => {
    dragRef.current = { sx: e.screenX, sy: e.screenY, ox: e.clientX, oy: e.clientY };
    draggedRef.current = false;
    setDragging(true);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const deltaX = e.screenX - dragRef.current.sx;
    const deltaY = e.screenY - dragRef.current.sy;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      draggedRef.current = true;
    }
    window.electronAPI?.moveIsland(dragRef.current.sx, dragRef.current.sy, deltaX, deltaY);
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDragging(false);
  };
  const onCompactClick = () => {
    if (draggedRef.current) return;
    setMini((current) => !current);
  };
  const onMiniClick = () => {
    if (draggedRef.current) return;
    setMini(false);
  };

  const control = (action: string) => {
    void window.electronAPI?.controlMusic?.(action);
  };

  const seekFromClientX = (clientX: number) => {
    const bar = progressRef.current;
    if (!bar || !music.durationMs) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setSeekPreview(Math.round(ratio * music.durationMs));
  };

  const onSeekDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    seekFromClientX(e.clientX);
  };
  const onSeekMove = (e: React.PointerEvent) => {
    if (seekPreview === null) return;
    e.stopPropagation();
    seekFromClientX(e.clientX);
  };
  const onSeekUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (seekPreview !== null) {
      void window.electronAPI?.seekMusic?.(seekPreview);
      setMusic((current) => ({ ...current, positionMs: seekPreview }));
      positionAnchorRef.current = { positionMs: seekPreview, at: Date.now() };
      setSeekPreview(null);
    }
  };

  const expanded = hovered || dragging;
  const showMusic = state.musicEnabled && music.available;
  const rootClass = [
    'island-root',
    state.style,
    expanded ? 'expanded' : (showMusic && mini ? 'mini' : 'collapsed'),
    arrival ? 'music-arrived' : '',
  ].join(' ');

  return (
    <div
      className={rootClass}
      data-position={state.position}
      data-drag={dragging ? 'true' : 'false'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {arrival ? <div className="island-drop-ball" /> : null}
      <div className="island-shell">
        {showMusic ? (
          <div
            className="island-mini"
            onClick={onMiniClick}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
          >
            {music.coverUrl ? (
              <img
                className={['island-mini-disc', music.isPlaying ? 'spinning' : 'paused'].join(' ')}
                src={music.coverUrl}
                alt=""
                draggable={false}
              />
            ) : (
              <div className={['island-mini-disc', 'island-mini-disc-fallback', music.isPlaying ? 'spinning' : 'paused'].join(' ')}>
                <Music size={22} />
              </div>
            )}
          </div>
        ) : null}
        <div
          className="island-compact"
          title="点击切换缩起样式，拖动移动灵动岛"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onClick={onCompactClick}
        >
          {showMusic ? (
            <>
              {music.coverUrl ? (
                <img
                  className={['island-pill-cover', music.isPlaying ? 'spinning' : 'paused'].join(' ')}
                  src={music.coverUrl}
                  alt=""
                  draggable={false}
                />
              ) : (
                <div className={['island-pill-cover', 'island-pill-cover-fallback', music.isPlaying ? 'spinning' : 'paused'].join(' ')}>
                  <Music size={16} />
                </div>
              )}
              <div className="island-pill-lyric">{currentLyric || music.title || '正在播放'}</div>
            </>
          ) : (
            <>
              <div className="island-time">{time}</div>
              <div className="island-date">{dateText()}</div>
            </>
          )}
        </div>
        <div className="island-panel-content">
        {showMusic ? (
          <>
            <div className="island-music-head">
              {music.coverUrl ? (
                <div className={['island-music-disc', music.isPlaying ? 'spinning' : 'paused'].join(' ')}>
                  <img className="island-music-cover" src={music.coverUrl} alt="" draggable={false} />
                  <div className="island-music-spindle" />
                </div>
              ) : (
                <div className={['island-music-disc', 'island-music-cover-fallback', music.isPlaying ? 'spinning' : 'paused'].join(' ')}>
                  <Music size={28} />
                  <div className="island-music-spindle" />
                </div>
              )}
              <div className="island-music-meta">
                <div className="island-music-title">{music.title || '未知歌曲'}</div>
                <div className="island-music-artist">{music.artist || '未知歌手'}</div>
                {music.album ? <div className="island-music-album">{music.album}</div> : null}
              </div>
              <div className="island-panel-clock">{time.slice(0, 8)}</div>
            </div>
            <div className="island-lyrics">
              {lyrics.length ? (
                <div className="island-lyric current">{currentLyric || '　'}</div>
              ) : (
                <div className="island-lyric current">{music.title || '暂无歌词'}</div>
              )}
            </div>
            <div
              className="island-progress"
              ref={progressRef}
              onPointerDown={onSeekDown}
              onPointerMove={onSeekMove}
              onPointerUp={onSeekUp}
            >
              <div className="island-progress-track">
                <div className="island-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="island-progress-times">
                <span>{formatTime(positionMs)}</span>
                <span>{formatTime(music.durationMs)}</span>
              </div>
            </div>
            <div className="island-controls">
              <button className="island-control" onClick={() => control('prev')} onPointerDown={(e) => e.stopPropagation()} title="上一首">
                <SkipBack size={18} />
              </button>
              <button className="island-control main" onClick={() => control('toggle')} onPointerDown={(e) => e.stopPropagation()} title="播放或暂停">
                {music.isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="island-control" onClick={() => control('next')} onPointerDown={(e) => e.stopPropagation()} title="下一首">
                <SkipForward size={18} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="island-panel-title">ShortCut 灵动岛</div>
            <div className="island-panel-clock">{time}</div>
            <div className="island-panel-date">{dateText()}</div>
            <div className="island-panel-hint">暂无音乐播放，正在显示时间</div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<IslandApp />);
