import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import './island.css';
import { useIslandDrop, IslandDropView } from './IslandDrop';
import type { BalanceData, BalanceProvider, CockpitData, IslandDisplayState, MusicState } from './types';

type IslandStyle = 'capsule' | 'glass' | 'paper';
type IslandPosition = 'top-center' | 'top-left' | 'top-right' | 'left-center' | 'right-center';

interface IslandState {
  enabled: boolean;
  style: IslandStyle;
  position: IslandPosition;
  autoHideFullscreen: boolean;
  musicEnabled: boolean;
  tasksEnabled: boolean;
  cockpitEnabled: boolean;
  balanceProvider: BalanceProvider;
  lyricBounce: boolean;
  orbitGlow: boolean;
  barsEnabled: boolean;
  displayState: IslandDisplayState;
  featureAccess: Record<string, boolean>;
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
  tasksEnabled: true,
  cockpitEnabled: false,
  balanceProvider: 'none',
  lyricBounce: true,
  orbitGlow: true,
  barsEnabled: true,
  displayState: 'collapsed',
  featureAccess: {},
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

function formatMetric(value: number | null | undefined, unit = '%'): string {
  return value == null ? '?' : `${Math.round(value)}${unit}`;
}

function BalanceRing({ percent, size = 76, stroke = 7, tone = 1, valueClass = '' }: {
  percent?: number;
  size?: number;
  stroke?: number;
  tone?: number;
  valueClass?: string;
}) {
  const raw = Number(percent);
  const value = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  const colors = ['#22d3ee', '#818cf8', '#f472b6'];
  const color = colors[(tone - 1) % colors.length];
  return (
    <div className="island-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="island-ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          className="island-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className={['island-ring-value', valueClass].filter(Boolean).join(' ')}>
        {Number.isFinite(raw) ? `${Math.round(raw)}%` : '?'}
      </div>
    </div>
  );
}

function IslandApp() {
  const [state, setState] = useState<IslandState>(DEFAULT_STATE);
  const [time, setTime] = useState(nowText);
  const [music, setMusic] = useState<MusicState>({ available: false });
  const [cockpit, setCockpit] = useState<CockpitData>({});
  const [balance, setBalance] = useState<BalanceData | null>(null);
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
        const legacyProvider: BalanceProvider = prefs.deepseekEnabled === true ? 'deepseek' : 'none';
        const featureAccess: Record<string, boolean> = Object.fromEntries(
          (parsed?.license?.featureAccess || []).map((rule: { id: string; allowed?: boolean }) => [rule.id, rule.allowed !== false]),
        );
        setState({
          enabled: prefs.enabled === true,
          style: prefs.style || 'capsule',
          position: prefs.position || 'top-center',
          autoHideFullscreen: prefs.autoHideFullscreen !== false,
          musicEnabled: prefs.musicEnabled !== false,
          tasksEnabled: prefs.tasksEnabled !== false,
          cockpitEnabled: prefs.cockpitEnabled === true,
          balanceProvider: prefs.balanceProvider === 'deepseek' || prefs.balanceProvider === 'opencode' ? prefs.balanceProvider : legacyProvider,
          lyricBounce: prefs.lyricBounce !== false,
          orbitGlow: prefs.orbitGlow !== false,
          barsEnabled: prefs.barsEnabled !== false,
          displayState: prefs.displayState || 'collapsed',
          featureAccess,
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
        tasksEnabled: next.tasksEnabled ?? current.tasksEnabled,
        cockpitEnabled: next.cockpitEnabled ?? current.cockpitEnabled,
        balanceProvider: (next.balanceProvider as BalanceProvider) ?? current.balanceProvider,
        lyricBounce: next.lyricBounce ?? current.lyricBounce,
        orbitGlow: next.orbitGlow ?? current.orbitGlow,
        barsEnabled: next.barsEnabled ?? current.barsEnabled,
        displayState: (next.displayState as IslandDisplayState) ?? current.displayState,
      }));
    });
    const unsubLicense = window.electronAPI?.onLicenseChanged?.(() => {
      void window.electronAPI?.readConfig?.().then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          const featureAccess: Record<string, boolean> = Object.fromEntries(
            (parsed?.license?.featureAccess || []).map((rule: { id: string; allowed?: boolean }) => [rule.id, rule.allowed !== false]),
          );
          setState((current) => ({ ...current, featureAccess }));
        } catch {}
      });
    });
    return () => {
      unsubscribe?.();
      unsubLicense?.();
    };
  }, []);

  /**
   * 上报"可见内容矩形"给主进程。
   *
   * 为什么需要：岛窗口是固定 360×340 的透明窗，收起态那颗球只占其中一小块。
   * 主进程的穿透判定要用它来决定"不穿透时哪些区域真的接收鼠标"——
   * 否则整窗可交互会把球周围一圈的桌面点击全部吞掉（改之前为避免这个问题，
   * 干脆让"非展开态一律穿透"，副作用是穿透开关在收起态完全失效）。
   *
   * 量的必须是 **.island-shell**（真正的可见/可拖拽内容），不是 .island-root：
   * 后者是 `position:absolute; inset:0` 铺满整窗的容器，量它等于没量。
   */
  useEffect(() => {
    let raf = 0;
    let last = '';
    const report = () => {
      const el = (document.querySelector('.island-shell') || document.querySelector('.island-root')) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const payload = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      const key = `${payload.x},${payload.y},${payload.w},${payload.h}`;
      if (key === last) return; // 没变不重复 IPC
      last = key;
      void window.electronAPI?.islandHitRect?.(payload.x, payload.y, payload.w, payload.h);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(report);
    };
    schedule();
    // 内容宽度自适应（歌词/柱条/余额）会改 shell 尺寸，用 ResizeObserver 兜住
    const el = document.querySelector('.island-shell');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro && el) ro.observe(el);
    const timer = window.setInterval(schedule, 1000); // 兜底：未观察到的情况（如 class 切换重建节点）
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.clearInterval(timer);
    };
  }, [state.displayState, state.style, state.musicEnabled, state.cockpitEnabled, state.balanceProvider, state.barsEnabled]);

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
    setArrival(music.available);
  }, [music.available]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onIslandCockpit?.((data: unknown) => {
      if (data) setCockpit(data as CockpitData);
    });
    void window.electronAPI?.getIslandCockpitState?.().then((data: unknown) => {
      if (data) setCockpit(data as CockpitData);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (state.balanceProvider === 'none') {
      setBalance(null);
      return;
    }
    const fetchBalance = () => {
      void window.electronAPI?.getBalanceData?.().then((data: unknown) => {
        if (data) setBalance(data as BalanceData);
      });
    };
    fetchBalance();
    const timer = window.setInterval(fetchBalance, 60000);
    return () => window.clearInterval(timer);
  }, [state.balanceProvider]);

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
  const featureOk = (key: string) => state.featureAccess[key] !== false;
  const showMusic = state.musicEnabled && music.available && featureOk('island.music');
  const showCockpit = state.cockpitEnabled && !showMusic && featureOk('island.cockpit');
  const showBalance = state.balanceProvider !== 'none' && !showMusic && !showCockpit && featureOk('island.balance');
  const openBalancePlatform = () => {
    void window.electronAPI?.openBalancePlatform?.(state.balanceProvider);
  };

  useEffect(() => {
    void window.electronAPI?.setBalanceMusicPlaying?.(showMusic && state.balanceProvider !== 'none');
  }, [showMusic, state.balanceProvider]);
  // 文件拖放：状态机在岛内自己渲染（岛身变形），不是盖在岛上的浮层
  const drop = useIslandDrop();
  const rootClass = [
    'island-root',
    state.style,
    expanded ? 'expanded' : (showMusic && mini ? 'mini' : 'collapsed'),
    arrival ? 'music-arrived' : '',
    showMusic && state.displayState === 'collapsed' && state.orbitGlow ? 'orbit-glow' : '',
    showMusic && state.displayState === 'collapsed' && state.orbitGlow && !music.isPlaying ? 'orbit-paused' : '',
    showMusic && !music.isPlaying ? 'music-paused' : '',
    showMusic && state.displayState === 'collapsed' ? 'music-width' : '',
    drop.phase !== 'idle' ? 'drop-mode' : '',
    drop.phase === 'hover' ? 'drop-hover' : '',
    drop.phase === 'recognized' ? 'drop-actions' : '',
    drop.phase === 'working' ? 'drop-busy' : '',
  ].join(' ');

  return (
    <div
      className={rootClass}
      data-position={state.position}
    >
      {arrival && showMusic && state.displayState === 'collapsed' && state.orbitGlow ? <div className="island-drop-ball" /> : null}
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
        {drop.phase !== 'idle' && <IslandDropView drop={drop} />}
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
          title="拖动移动SC球"
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
              <div className="island-bars" style={{ display: state.barsEnabled ? undefined : 'none' }}>
                <div className="island-bar" />
                <div className="island-bar" />
                <div className="island-bar" />
              </div>
            </>
        ) : showCockpit ? (
          <div className="island-cockpit-mini">
            <span>CPU {formatMetric(cockpit.cpu?.usage)} {formatMetric(cockpit.cpu?.temperature, '°C')}</span>
            <span>GPU {formatMetric(cockpit.gpu?.usage)} {formatMetric(cockpit.gpu?.temperature, '°C')}</span>
            <span>内存 {formatMetric(cockpit.memory?.usage)} {formatMetric(cockpit.memory?.temperature, '°C')}</span>
          </div>
        ) : showBalance && state.balanceProvider === 'opencode' ? (
          <div className="island-balance-mini" onClick={openBalancePlatform} title="OpenCode Go 用量（5小时/本周/本月）">
            {[
              { key: 'rolling', percent: balance && balance.provider === 'opencode' ? balance.rolling?.percent : undefined, label: '5小时', tone: 1 },
              { key: 'weekly', percent: balance && balance.provider === 'opencode' ? balance.weekly?.percent : undefined, label: '本周', tone: 2 },
              { key: 'monthly', percent: balance && balance.provider === 'opencode' ? balance.monthly?.percent : undefined, label: '本月', tone: 3 },
            ].map((item) => (
              <div className="island-balance-mini-item" key={item.key}>
                <BalanceRing percent={item.percent} size={28} stroke={3} tone={item.tone} valueClass="island-ring-value-mini" />
                <span className="island-balance-mini-label">{item.label}</span>
              </div>
            ))}
          </div>
        ) : showBalance ? (
          <div className="island-deepseek-mini" onClick={openBalancePlatform} title="打开 DeepSeek 平台">
            <span>DeepSeek {balance && balance.provider === 'deepseek' && balance.configured === false ? '未配置' : balance && balance.provider === 'deepseek' && balance.balance != null ? `${balance.balance} ${balance.currency}` : '?'}</span>
          </div>
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
        ) : showCockpit ? (
          <div className="island-cockpit-panel">
            <div className="island-panel-title">驾驶舱数据</div>
            <div className="island-cockpit-grid">
              {[
                { label: 'CPU', usage: cockpit.cpu?.usage, temp: cockpit.cpu?.temperature },
                { label: 'GPU', usage: cockpit.gpu?.usage, temp: cockpit.gpu?.temperature },
                { label: '内存', usage: cockpit.memory?.usage, temp: cockpit.memory?.temperature },
              ].map((item) => (
                <div key={item.label} className="island-cockpit-card">
                  <div className="island-cockpit-label">{item.label}</div>
                  <div className="island-cockpit-usage">{formatMetric(item.usage)}</div>
                  <div className="island-cockpit-temp">{formatMetric(item.temp, '°C')}</div>
                </div>
              ))}
            </div>
          </div>
        ) : showBalance && state.balanceProvider === 'opencode' ? (
          <div className="island-balance-panel" onClick={openBalancePlatform} title="打开 OpenCode Go 用量">
            <div className="island-panel-title">OpenCode Go 用量</div>
            <div className="island-balance-rings">
              <div className="island-balance-ring-item">
                <BalanceRing percent={balance && balance.provider === 'opencode' ? balance.rolling?.percent : undefined} size={76} stroke={7} tone={1} />
                <div className="island-balance-ring-label">5小时</div>
              </div>
              <div className="island-balance-ring-item">
                <BalanceRing percent={balance && balance.provider === 'opencode' ? balance.weekly?.percent : undefined} size={76} stroke={7} tone={2} />
                <div className="island-balance-ring-label">本周</div>
              </div>
              <div className="island-balance-ring-item">
                <BalanceRing percent={balance && balance.provider === 'opencode' ? balance.monthly?.percent : undefined} size={76} stroke={7} tone={3} />
                <div className="island-balance-ring-label">本月</div>
              </div>
            </div>
            <div className="island-deepseek-status">
              {balance && balance.provider === 'opencode' && balance.configured === false ? '请在SC球设置中填写 API Key' : balance?.error ? balance.error : '每分钟自动刷新'}
            </div>
          </div>
        ) : showBalance ? (
          <div className="island-deepseek-panel" onClick={openBalancePlatform} title="打开 DeepSeek 平台">
            <div className="island-panel-title">DeepSeek 余额</div>
            <div className="island-deepseek-balance">
              {balance && balance.provider === 'deepseek' && balance.configured === false ? '未配置' : balance && balance.provider === 'deepseek' && balance.balance != null ? `${balance.balance} ${balance.currency}` : '?'}
            </div>
            <div className="island-deepseek-status">
              {(() => {
                if (balance?.provider === 'deepseek') {
                  if (!balance.configured) return '请在SC球设置中填写 API Key';
                  if (balance.error) return balance.error;
                  return balance.available ? '可用' : '不可用';
                }
                return balance?.error ? balance.error : '获取中...';
              })()}
            </div>
          </div>
        ) : (
          <>
            <div className="island-panel-title">ShortCut SC球</div>
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
