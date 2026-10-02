import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './deepseekBall.css';
import type { BalanceData, BalanceProvider } from './types';

/** 拖到球上的文件（converterDetect 返回） */
interface Detected {
  path: string;
  kind: string;
  targets: string[];
  size?: number;
}

const KIND_LABEL: Record<string, string> = {
  image: '图片',
  audio: '音频',
  archive: '压缩包',
  unknown: '不支持',
};

const KIND_ICON: Record<string, string> = {
  image: '🖼',
  audio: '🎵',
  archive: '🗜',
  unknown: '❔',
};

function nameOf(p: string) {
  return p.split(/[\\/]/).pop() || p;
}

function DeepseekBall() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [provider, setProvider] = useState<BalanceProvider>('none');
  const [style, setStyle] = useState('capsule');

  // ── 拖放 / 菜单状态 ──
  const [dragging, setDragging] = useState(false);
  const [suction, setSuction] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [files, setFiles] = useState<Detected[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [passthrough, setPassthrough] = useState(false);
  const [outPath, setOutPath] = useState('');
  const busyIds = useRef<Set<string>>(new Set());
  const pendingCount = useRef(0);

  useEffect(() => {
    void window.electronAPI?.readConfig?.().then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const island = parsed?.island || {};
        setStyle(island.style || 'capsule');
        setProvider(
          island.balanceProvider === 'deepseek' || island.balanceProvider === 'opencode'
            ? island.balanceProvider
            : island.deepseekEnabled === true ? 'deepseek' : 'none'
        );
      } catch {}
    });
    const fetchBalance = () => {
      void window.electronAPI?.getBalanceData?.().then((value: unknown) => {
        if (value) setData(value as BalanceData);
      });
    };
    fetchBalance();
    const timer = window.setInterval(fetchBalance, 60000);
    const hide = window.electronAPI?.onBalanceMerge?.(() => {
      document.querySelector('.deepseek-ball-root')?.classList.add('merge');
    });

    // 拖入：球放大 + 提示气泡（窗口在 Rust 侧放大到 190×64 才能显示气泡）
    const offOver = window.electronAPI?.onBallDragover?.((payload) => {
      const active = !!payload?.active;
      setDragging(active);
      if (active) {
        setMenuOpen(false);
        void window.electronAPI?.ballShape?.('hint');
      } else if (!menuOpen) {
        void window.electronAPI?.ballShape?.('collapsed');
      }
    });
    // 松手：吸附动画 → 展开菜单 → 识别文件类型
    const offDrop = window.electronAPI?.onBallDrop?.((payload) => {
      const paths = payload?.paths || [];
      if (!paths.length) return;
      setDragging(false);
      setSuction(true);
      window.setTimeout(() => setSuction(false), 480);
      void (async () => {
        const detected = ((await window.electronAPI?.converterDetect?.(paths)) || []) as Detected[];        // 识别不了的文件也给出来（标为不支持），用户至少能看到发生了什么
        const list: Detected[] = detected.length
          ? detected
          : paths.map((p) => ({ path: p, kind: 'unknown', targets: [] }));
        setFiles(list);
        setStatus('');
        setOutPath('');
        setMenuOpen(true);
        await window.electronAPI?.ballShape?.('menu');
      })();
    });
    // 穿透状态（快捷键/设置里切换时同步显示）
    const offPass = window.electronAPI?.onBallPassthrough?.((payload) => setPassthrough(!!payload?.on));
    void window.electronAPI?.ballState?.().then((s) => s && setPassthrough(!!s.passthrough));

    // 转换结果（球菜单里直接转，完成就地反馈）
    const offDone = window.electronAPI?.onConverterDone?.((payload) => {
      if (!busyIds.current.has(payload.id)) return;
      busyIds.current.delete(payload.id);
      pendingCount.current = Math.max(0, pendingCount.current - 1);
      if (pendingCount.current === 0) {
        setBusy(false);
        setOutPath(payload.out || '');
        setStatus('完成');
      }
    });
    const offErr = window.electronAPI?.onConverterError?.((payload) => {
      if (!busyIds.current.has(payload.id)) return;
      busyIds.current.delete(payload.id);
      pendingCount.current = Math.max(0, pendingCount.current - 1);
      if (pendingCount.current === 0) {
        setBusy(false);
        setStatus(`失败：${payload.message || '未知错误'}`);
      }
    });
    const offProgress = window.electronAPI?.onConverterProgress?.(() => {});
    return () => {
      window.clearInterval(timer);
      hide?.();
      offOver?.();
      offDrop?.();
      offPass?.();
      offDone?.();
      offErr?.();
      offProgress?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  const openPlatform = () => {
    if (menuOpen) return;
    void window.electronAPI?.openBalancePlatform?.(provider);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setStatus('');
    setFiles([]);
    void window.electronAPI?.ballShape?.('collapsed');
  };

  const convertAll = (target: string) => {
    if (!files.length || busy) return;
    setBusy(true);
    setStatus(`转换中 → ${target.toUpperCase()}`);
    pendingCount.current = files.length;
    files.forEach((f) => {
      void (async () => {
        const res = await window.electronAPI?.converterConvert?.(f.path, target, 85, 192, null);
        const id = res?.id;
        if (id) busyIds.current.add(id);
        else {
          pendingCount.current = Math.max(0, pendingCount.current - 1);
          if (pendingCount.current === 0) { setBusy(false); setStatus('已提交转换'); }
        }
      })();
    });
  };

  const extractAll = () => {
    if (!files.length || busy) return;
    setBusy(true);
    setStatus('解压中…');
    let left = files.length;
    files.forEach((f) => {
      void window.electronAPI?.converterExtract?.(f.path, null, null).then(() => {
        left -= 1;
        if (left <= 0) { setBusy(false); setStatus('已提交解压'); }
      });
    });
  };

  const rollingPercent = data && data.provider === 'opencode' ? data.rolling?.percent : undefined;
  const balanceText = data && data.provider === 'deepseek' && data.balance != null
    ? String(Math.round(Number(data.balance)))
    : data && data.provider === 'deepseek' && (data.configured === false || data.error)
      ? '未配置'
      : '?';
  const radius = 17;
  const stroke = 4;
  const circumference = 2 * Math.PI * radius;
  const raw = Number(rollingPercent);
  const percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  const offset = circumference * (1 - percent / 100);

  const first = files[0];
  const allTargets = Array.from(new Set(files.flatMap((f) => f.targets || [])));
  const hasArchive = files.some((f) => f.kind === 'archive');

  return (
    <div className={['ball-wrap', dragging ? 'drag-over' : '', suction ? 'suction' : '', passthrough ? 'passthrough' : ''].join(' ')}>
      {/* 拖入提示气泡（窗口放大到 190×64 时可见） */}
      {dragging && !menuOpen && (
        <div className="ball-hint">松手 → 识别类型并选格式</div>
      )}

      {/* 格式菜单：从球里长出来 */}
      {menuOpen && (
        <div className="ball-menu">
          <div className="ball-menu-title">
            {KIND_ICON[first?.kind || 'unknown']} {first ? nameOf(first.path) : ''}
            {files.length > 1 ? `  等 ${files.length} 个文件` : ''}
          </div>
          <div className="ball-menu-sub">
            {first ? KIND_LABEL[first.kind] || first.kind : ''}
            {files.length > 1 ? '（按所选格式逐个处理）' : ''}
          </div>

          {hasArchive && (
            <div className="ball-menu-grid" style={{ marginTop: 10 }}>
              <button className="ball-menu-btn primary" disabled={busy} onClick={extractAll}>
                🗜 解压到同名文件夹
              </button>
            </div>
          )}

          {allTargets.length > 0 ? (
            <div className="ball-menu-grid">
              {allTargets.map((t) => (
                <button key={t} className="ball-menu-btn" disabled={busy} onClick={() => convertAll(t)}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          ) : (
            !hasArchive && <div className="ball-menu-status">该类型暂不支持转换，可在转换面板查看详情</div>
          )}

          {status && (
            <div className="ball-menu-status">
              {status}
              {outPath && (
                <span className="ball-menu-link" style={{ marginLeft: 8 }} onClick={() => void window.electronAPI?.openTarget?.(outPath)}>
                  打开
                </span>
              )}
            </div>
          )}

          <div className="ball-menu-foot">
            <span className="ball-menu-link" onClick={() => void window.electronAPI?.ballOpenInPanel?.(files.map((f) => f.path))}>
              打开转换面板
            </span>
            <span className="ball-menu-link" onClick={closeMenu}>关闭</span>
          </div>
        </div>
      )}

      <div
        className={['deepseek-ball-root', style, 'expand'].join(' ')}
        onClick={openPlatform}
        title={passthrough ? 'SC球（鼠标穿透已开启，Ctrl+Alt+B 可切换）' : (provider === 'opencode' ? 'OpenCode Go 5小时用量 · 可拖文件到此转换' : 'DeepSeek 余额 · 可拖文件到此转换')}
      >
        {provider === 'opencode' ? (
          <svg className="deepseek-ball-ring" width="38" height="38" viewBox="0 0 38 38">
            <circle className="deepseek-ball-ring-track" cx="19" cy="19" r={radius} fill="none" strokeWidth={stroke} />
            <circle
              className="deepseek-ball-ring-fill"
              cx="19"
              cy="19"
              r={radius}
              fill="none"
              stroke="#22d3ee"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 19 19)"
            />
          </svg>
        ) : null}
        <span className="deepseek-ball-value">{provider === 'opencode' ? (Number.isFinite(raw) ? `${Math.round(raw)}%` : '?') : balanceText}</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<DeepseekBall />);
