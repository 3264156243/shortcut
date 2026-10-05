import React, { useEffect, useRef, useState } from 'react';
import './islandDrop.css';

/**
 * SC球（岛）拖放层：拖入高亮 → 松手吸附动画 → 格式菜单。
 * Batch 2 迁移：这些能力原先挂在"旁边小球"（deepseekball 窗口）上，
 * 现在整体搬到岛（island 窗口）里渲染，小球只跟随岛的穿透状态。
 */

/** 拖到岛上的文件（converterDetect 返回） */
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

export default function IslandDrop() {
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
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;

  useEffect(() => {
    // 拖入：岛高亮 + 提示气泡（窗口尺寸不变，菜单/提示都在岛自己的透明窗内）
    const offOver = window.electronAPI?.onBallDragover?.((payload) => {
      const active = !!payload?.active;
      setDragging(active);
      if (active) {
        setMenuOpen(false);
        void window.electronAPI?.ballShape?.('hint');
      } else if (!menuOpenRef.current) {
        void window.electronAPI?.ballShape?.('collapsed');
      }
    });
    // 松手：吸附动画 → 展开格式菜单 → 识别文件类型
    const offDrop = window.electronAPI?.onBallDrop?.((payload) => {
      const paths = payload?.paths || [];
      if (!paths.length) return;
      setDragging(false);
      setSuction(true);
      document.querySelector('.island-root')?.classList.add('drop-suction');
      window.setTimeout(() => {
        setSuction(false);
        document.querySelector('.island-root')?.classList.remove('drop-suction');
      }, 480);
      void (async () => {
        const detected = ((await window.electronAPI?.converterDetect?.(paths)) || []) as Detected[];
        // 识别不了的文件也给出来（标为不支持），用户至少能看到发生了什么
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

    // 转换结果（岛上直接转，完成就地反馈）
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
      offOver?.();
      offDrop?.();
      offPass?.();
      offDone?.();
      offErr?.();
      offProgress?.();
    };
  }, []);

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

  const first = files[0];
  const allTargets = Array.from(new Set(files.flatMap((f) => f.targets || [])));
  const hasArchive = files.some((f) => f.kind === 'archive');

  return (
    <div
      className={['island-drop-layer', dragging ? 'drag-over' : '', suction ? 'suction' : '', passthrough ? 'passthrough' : ''].join(' ')}
    >
      {/* 穿透开启的可见提示（快捷键 Ctrl+Alt+B 或设置里切换） */}
      {passthrough && !menuOpen && (
        <div className="island-drop-passthru">穿透中 · Ctrl+Alt+B</div>
      )}

      {/* 拖入高亮：整窗描边，比原来的 46px 小球好瞄准 */}
      {dragging && !menuOpen && <div className="island-drop-outline" />}

      {/* 拖入提示气泡 */}
      {dragging && !menuOpen && (
        <div className="island-drop-hint">松手 → 识别类型并选格式</div>
      )}

      {/* 格式菜单：在岛窗口内展开（不改窗口尺寸） */}
      {menuOpen && (
        <div className="island-drop-menu">
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
    </div>
  );
}
