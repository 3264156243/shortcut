import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import './island.css';
import type { IslandDisplayState, MusicState } from './types';

type IslandStyle = 'capsule' | 'glass' | 'paper';
type IslandPosition = 'top-center' | 'top-left' | 'top-right' | 'left-center' | 'right-center';

interface IslandState {
  enabled: boolean;
  style: IslandStyle;
  position: IslandPosition;
  autoHideFullscreen: boolean;
  musicEnabled: boolean;
  lyricBounce: boolean;
  orbitGlow: boolean;
  displayState: IslandDisplayState;
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
  lyricBounce: true,
  orbitGlow: true,
  displayState: 'collapsed',
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
  const [music, setMusic] = useState<MusicState>({ available: false });
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [arrival, setArrival] = useState(false);
  const positionAnchorRef = useRef<{ positionMs: number; at: number } | null>(null);
  const lastDisplayIndexRef = useRef(-1);
  const songKeyRef = useRef('');
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
          lyricBounce: prefs.lyricBounce !== false,
          orbitGlow: prefs.orbitGlow !== false,
          displayState: prefs.displayState || 'collapsed',
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
        lyricBounce: next.lyricBounce ?? current.lyricBounce,
        orbitGlow: next.orbitGlow ?? current.orbitGlow,
        displayState: (next.displayState as IslandDisplayState) ?? current.displayState,
      }));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const applyMusic = (data: MusicState) => {
      setMusic(data);
      const now = Date.now();
      const newMs = Number(data.positionMs) || 0;
      const prev = positionAnchorRef.current;
      if (data.isPlaying && prev) {
        const elapsed = Math.max(0, now - prev.at);
        const expected = prev.positionMs + elapsed;
        // 播放中只前进不回退，SMTC 小误差不打断本地推算
        positionAnchorRef.current = newMs >= expected - 500
          ? { positionMs: Math.max(newMs, expected), at: now }
          : { positionMs: newMs, at: now };
      } else {
        positionAnchorRef.current = { positionMs: newMs, at: now };
      }
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
  const songKey = `${music.title}|${music.artist}`;
  const displayIndex = useMemo(() => {
    if (songKeyRef.current !== songKey) {
      songKeyRef.current = songKey;
      lastDisplayIndexRef.current = -1;
    }
    if (!lyrics.length) {
      lastDisplayIndexRef.current = -1;
      return -1;
    }
    let rawIndex = -1;
    for (let i = 0; i < lyrics.length; i++) {
      const start = lyrics[i].timeMs;
      const activation = i === 0 ? start : start - Math.floor((start - lyrics[i - 1].timeMs) / 2);
      if (activation <= positionMs) rawIndex = i;
      else break;
    }
    const prev = lastDisplayIndexRef.current;
    let next = rawIndex;
    if (prev >= 0 && prev < lyrics.length && rawIndex < prev) {
      // 防止半句边界因进度小抖动来回跳
      const holdUntil = lyrics[prev].timeMs - 300;
      if (positionMs >= holdUntil) next = prev;
    }
    lastDisplayIndexRef.current = next;
    return next;
  }, [lyrics, positionMs, songKey]);
  const currentLyric = displayIndex >= 0 ? lyrics[displayIndex].text : (music.title || '');
  const progress = music.durationMs ? Math.max(0, Math.min(100, (positionMs / music.durationMs) * 100)) : 0;
  const lyricNeedsMarquee = currentLyric.length > 18;

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

  const expanded = state.displayState === 'expanded';
  const mini = state.displayState === 'mini';
  const showMusic = state.musicEnabled && music.available;
  const rootClass = [
    'island-root',
    state.style,
    expanded ? 'expanded' : (showMusic && mini ? 'mini' : 'collapsed'),
    arrival ? 'music-arrived' : '',
    showMusic && state.displayState === 'collapsed' && state.orbitGlow ? 'orbit-glow' : '',
    showMusic && state.displayState === 'collapsed' && state.orbitGlow && !music.isPlaying ? 'orbit-paused' : '',
  ].join(' ');

  return (
    <div
      className={rootClass}
      data-position={state.position}
    >
      {arrival ? <div className="island-drop-ball" /> : null}
      {showMusic && state.displayState === 'collapsed' && state.orbitGlow ? (
        <div className="island-orbit">
          <svg className="island-glow-svg" viewBox="0 0 336 46" preserveAspectRatio="none">
            <defs>
              <linearGradient id="islandOrbitGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ff5f6d" />
                <stop offset="20%" stopColor="#ffc371" />
                <stop offset="40%" stopColor="#36d1dc" />
                <stop offset="60%" stopColor="#5b86e5" />
                <stop offset="80%" stopColor="#a55eea" />
                <stop offset="100%" stopColor="#ff5f6d" />
              </linearGradient>
            </defs>
            <path
              className="island-glow-line halo"
              d="M 21 2 H 315 A 19 19 0 0 1 334 21 V 25 A 19 19 0 0 1 315 44 H 21 A 19 19 0 0 1 2 25 V 21 A 19 19 0 0 1 21 2 Z"
            />
            <path
              className="island-glow-line"
              d="M 21 2 H 315 A 19 19 0 0 1 334 21 V 25 A 19 19 0 0 1 315 44 H 21 A 19 19 0 0 1 2 25 V 21 A 19 19 0 0 1 21 2 Z"
            />
          </svg>
        </div>
      ) : null}
      <div className="island-shell">
        {showMusic ? (
          <div className="island-mini">
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
          title="拖动移动灵动岛"
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
              <div className={['island-pill-lyric', lyricNeedsMarquee ? 'marquee' : ''].join(' ')}>
                {lyricNeedsMarquee ? (
                  <div className="island-pill-lyric-track">
                    <span>{currentLyric || music.title || '正在播放'}</span>
                    <span>{currentLyric || music.title || '正在播放'}</span>
                  </div>
                ) : state.lyricBounce ? (
                  <span className="island-lyric-chars">
                    {(currentLyric || music.title || '正在播放').split('').map((ch, index) => (
                      <span
                        key={index}
                        className="island-lyric-char"
                        style={{ animationDelay: `${Math.min(index * 0.05, 1.5)}s` }}
                      >
                        {ch === ' ' ? '\u00A0' : ch}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span>{currentLyric || music.title || '正在播放'}</span>
                )}
              </div>
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
              <button className="island-control" onClick={(e) => { e.stopPropagation(); control('prev'); }} onPointerDown={(e) => e.stopPropagation()} title="上一首">
                <SkipBack size={18} />
              </button>
              <button className="island-control main" onClick={(e) => { e.stopPropagation(); control('toggle'); }} onPointerDown={(e) => e.stopPropagation()} title="播放或暂停">
                {music.isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="island-control" onClick={(e) => { e.stopPropagation(); control('next'); }} onPointerDown={(e) => e.stopPropagation()} title="下一首">
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
