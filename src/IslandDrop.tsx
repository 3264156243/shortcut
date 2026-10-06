import React, { useCallback, useEffect, useRef, useState } from 'react';
import PillActions, { type PillItem } from './components/PillActions';
import './islandDrop.css';

/**
 * 岛窗口文件拖拽识别与转换交互（需求文档 docs/island-drop-convert-rework.md）
 *
 * 关键约定：所有交互样式都**渲染在岛自己的外壳 `.island-shell` 内部**——
 * 岛身自己变成拖放面（文字/文件名/进度条都是岛的内容，不是盖在岛上面的浮层），
 * 识别完成后岛身向下"长大"以容纳椭圆按钮；复位后岛恢复原来的余额/歌词/时间内容。
 *
 * 状态机：idle → hover（松手自动识别）→ recognized（文件名+格式，下方椭圆按钮）
 *        → working（真实进度条）→ done（转换完成停留 1s → 打开目录并选中 → 复位）
 */

export interface Detected {
  path: string;
  name: string;
  kind: string;
  ext: string;
  size?: number;
  targets: string[];
  flavor?: string;
}

export type DropPhase = 'idle' | 'hover' | 'recognized' | 'working' | 'done';

const KIND_LABEL: Record<string, string> = {
  image: '图片',
  audio: '音频',
  archive: '压缩包',
  other: '其它',
};

const KIND_ICON: Record<string, string> = {
  image: '🖼',
  audio: '🎵',
  archive: '🗜',
  other: '❔',
};

/** 图片/音频目标格式兜底（detect 返回实际可用列表时以它为准） */
const IMAGE_TARGETS = ['png', 'jpg', 'webp', 'bmp', 'gif', 'tiff', 'ico'];
const AUDIO_TARGETS = ['wav', 'mp3', 'flac', 'opus'];

/**
 * 「文件名 + 格式」且**过长省略中间**：保留名字首尾 + 完整扩展名
 * 例：很长的文件…格式.zip（需求 §2.2）
 */
export function displayName(f: Detected, budget = 20): string {
  const name = f.name || f.path.split(/[\\/]/).pop() || f.path;
  const ext = f.ext ? `.${f.ext}` : '';
  const stem = ext && name.toLowerCase().endsWith(ext.toLowerCase())
    ? name.slice(0, name.length - ext.length)
    : name;
  if (stem.length <= budget) return stem + ext;
  const head = Math.max(4, budget - 6);
  return `${stem.slice(0, head)}…${stem.slice(-5)}${ext}`;
}

export interface IslandDropApi {
  phase: DropPhase;
  files: Detected[];
  pct: number;
  /** 收到过真实进度事件（否则显示不确定态动画，绝不假装百分比） */
  hasRealProgress: boolean;
  status: string;
  note: string;
  compressFmt: string;
  imageFmt: string;
  audioFmt: string;
  items: PillItem[];
  reset: () => void;
}

/**
 * 岛内拖放交互的状态机 + 行为。由 island.tsx 调用：
 * 返回的 phase 用于给岛身着类（岛身变形），items 用于渲染椭圆按钮。
 */
export function useIslandDrop(): IslandDropApi {
  const [phase, setPhase] = useState<DropPhase>('idle');
  const [files, setFiles] = useState<Detected[]>([]);
  const [pct, setPct] = useState(0);
  const [hasRealProgress, setHasRealProgress] = useState(false);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [compressFmt, setCompressFmt] = useState('zip');
  const [imageFmt, setImageFmt] = useState('png');
  const [audioFmt, setAudioFmt] = useState('wav');
  const [autoReveal, setAutoReveal] = useState(true);
  const jobId = useRef('');
  const phaseRef = useRef<DropPhase>('idle');
  phaseRef.current = phase;
  const resetTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);

  // ── 配置：默认格式 / 转换后自动打开目录（转换板块设置面板里改）──
  const loadPrefs = useCallback(() => {
    void window.electronAPI?.readConfig?.().then((raw) => {
      if (!raw) return;
      try {
        const conv = JSON.parse(raw)?.converter || {};
        if (conv.defaultCompress) setCompressFmt(String(conv.defaultCompress));
        if (conv.defaultImage) setImageFmt(String(conv.defaultImage));
        if (conv.defaultAudio) setAudioFmt(String(conv.defaultAudio));
        setAutoReveal(conv.autoReveal !== false);
      } catch {}
    });
  }, []);

  /** 复位到 idle：撤掉按钮，岛恢复拖放前的内容 */
  const reset = useCallback(() => {
    if (resetTimer.current) { window.clearTimeout(resetTimer.current); resetTimer.current = null; }
    jobId.current = '';
    setFiles([]);
    setStatus('');
    setNote('');
    setPct(0);
    setHasRealProgress(false);
    setPhase('idle');
    void window.electronAPI?.ballShape?.('collapsed');
  }, []);

  useEffect(() => {
    loadPrefs();

    // 拖入：岛身自己显示出「松手自动识别」
    // 注意 else 分支必须**防抖**：WebView2 在拖拽过程中会因窗口临时切换 click-through
    // 抖出一次 DragLeave，若立即复位就会把紧接着的松手丢掉（实测踩到过）。
    const offOver = window.electronAPI?.onBallDragover?.((payload) => {
      const active = !!payload?.active;
      if (active) {
        if (leaveTimer.current) { window.clearTimeout(leaveTimer.current); leaveTimer.current = null; }
        if (phaseRef.current === 'recognized' || phaseRef.current === 'working') return;
        setFiles([]);
        setStatus('');
        setNote('');
        setPct(0);
        setHasRealProgress(false);
        setPhase('hover');
        void window.electronAPI?.ballShape?.('hint'); // 悬停期间保持可交互，落点一定收得到
      } else if (phaseRef.current === 'hover') {
        if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
        leaveTimer.current = window.setTimeout(() => {
          leaveTimer.current = null;
          if (phaseRef.current !== 'hover') return;
          setPhase('idle');
          void window.electronAPI?.ballShape?.('collapsed');
        }, 300);
      }
    });

    // 松手：识别 → 岛内展示「文件名 + 格式」→ 岛身向下长出椭圆按钮
    const offDrop = window.electronAPI?.onBallDrop?.((payload) => {
      const paths = payload?.paths || [];
      if (!paths.length) return;
      setStatus('');
      setNote('');
      setPct(0);
      setHasRealProgress(false);
      void (async () => {
        const detected = ((await window.electronAPI?.converterDetect?.(paths)) || []) as Detected[];
        const list: Detected[] = detected.length
          ? detected
          : paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() || p, kind: 'other', ext: '', targets: [] }));
        setFiles(list);
        setPhase('recognized');
        loadPrefs(); // 设置面板刚改过也能立刻生效
        await window.electronAPI?.ballShape?.('menu'); // 按钮要能点：解除穿透
      })();
    });

    // 真实进度（Rust 在解码/编码/逐条目阶段上报）
    const offProgress = window.electronAPI?.onConverterProgress?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) return;
      setHasRealProgress(true);
      setPct(Math.max(0, Math.min(100, Number(payload.pct) || 0)));
      if (payload.note) setNote(String(payload.note));
    });

    // 完成：立刻 100% → 「转换完成」停留 1 秒 → 打开产物所在目录并选中 → 复位
    const offDone = window.electronAPI?.onConverterDone?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) return;
      setPct(100);
      setNote('');
      setStatus('转换完成');
      setPhase('done');
      const target = payload.out || payload.out_dir || '';
      if (autoReveal && target) {
        window.setTimeout(() => { void window.electronAPI?.revealInExplorer?.(target); }, 120);
      }
      resetTimer.current = window.setTimeout(() => reset(), 1000);
    });

    const offErr = window.electronAPI?.onConverterError?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) return;
      jobId.current = '';
      setPct(0);
      setHasRealProgress(false);
      setNote('');
      setStatus(`失败：${payload.message || '未知错误'}`);
      setPhase('recognized'); // 回到可重试状态
    });

    return () => {
      offOver?.();
      offDrop?.();
      offProgress?.();
      offDone?.();
      offErr?.();
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    };
  }, [autoReveal, loadPrefs, reset]);

  const first = files[0];
  const kind = first?.kind || 'other';
  const busy = phase === 'working';

  const start = (id: string | undefined) => {
    if (!id) { setStatus('任务提交失败'); setPhase('recognized'); return; }
    jobId.current = id;
    setPct(0);
    setHasRealProgress(false);
    setNote('');
    setStatus('');
    setPhase('working');
  };

  const beginWork = () => {
    setPhase('working');
    setNote('');
    setPct(0);
    setHasRealProgress(false);
  };

  const doExtract = () => {
    if (!files.length) return;
    beginWork();
    void (async () => {
      let id = '';
      for (const f of files) {
        const res = await window.electronAPI?.converterExtract?.(f.path, null, null);
        id = res?.id || id;
      }
      start(id);
    })();
  };

  const doCompress = () => {
    if (!files.length) return;
    beginWork();
    void (async () => {
      const res = await window.electronAPI?.converterCompress?.(files.map((f) => f.path), compressFmt, null, null, 6);
      start(res?.id);
    })();
  };

  const doConvert = (target: string) => {
    if (!files.length) return;
    beginWork();
    void (async () => {
      let id = '';
      for (const f of files) {
        const res = await window.electronAPI?.converterConvert?.(f.path, target, 85, 192, null);
        id = res?.id || id;
      }
      start(id);
    })();
  };

  // ── 按文件类型组装椭圆按钮（需求 §2.3；数据驱动，类型变多只改这里）──
  const buildItems = (): PillItem[] => {
    const cancel: PillItem = { key: 'cancel', label: '取消', tone: 'ghost', disabled: busy, onClick: reset };
    if (kind === 'archive') {
      return [{ key: 'extract', label: '解压', tone: 'primary', disabled: busy, onClick: doExtract }, cancel];
    }
    if (kind === 'image' || kind === 'audio') {
      const isImage = kind === 'image';
      const fmt = isImage ? imageFmt : audioFmt;
      const opts = (first?.targets?.length ? first.targets : (isImage ? IMAGE_TARGETS : AUDIO_TARGETS))
        .map((t) => ({ value: t, label: t.toUpperCase() }));
      if (!opts.some((o) => o.value === fmt)) opts.unshift({ value: fmt, label: fmt.toUpperCase() });
      return [
        { key: 'compress', label: `压缩 ${compressFmt.toUpperCase()}`, disabled: busy, onClick: doCompress },
        {
          key: 'convert',
          label: `转为 ${fmt.toUpperCase()}`,
          tone: 'primary',
          disabled: busy,
          onClick: () => doConvert(fmt),
          select: {
            value: fmt,
            options: opts,
            onChange: (v) => (isImage ? setImageFmt(v) : setAudioFmt(v)),
            width: 72,
          },
        },
        cancel,
      ];
    }
    return [
      { key: 'panel', label: '打开转换面板', disabled: busy, onClick: () => void window.electronAPI?.ballOpenInPanel?.(files.map((f) => f.path)) },
      cancel,
    ];
  };

  return {
    phase,
    files,
    pct,
    hasRealProgress,
    status,
    note,
    compressFmt,
    imageFmt,
    audioFmt,
    items: phase === 'recognized' ? buildItems() : [],
    reset,
  };
}

/**
 * 岛内拖放视图：渲染在 `.island-shell` 内部（不是浮层）。
 * 第一行 = 岛的内容位（提示 / 文件名 / 进度 / 完成），第二行 = 椭圆按钮。
 */
export function IslandDropView({ drop }: { drop: IslandDropApi }) {
  const { phase, files, pct, hasRealProgress, status, note, items } = drop;
  if (phase === 'idle') return null;
  const first = files[0];
  const kind = first?.kind || 'other';
  const multi = files.length > 1;
  const busyText = kind === 'archive' ? '解压中' : '转换中';

  return (
    <div className="island-drop-view">
      <div className="island-drop-row">
        {phase === 'hover' && <span className="island-drop-text">松手自动识别</span>}

        {(phase === 'recognized' || phase === 'working' || phase === 'done') && first && (
          <>
            <span className="island-drop-kind">{KIND_ICON[kind]} {KIND_LABEL[kind] || '文件'}</span>
            <span className="island-drop-name" title={first.name}>
              {displayName(first)}{multi ? ` 等 ${files.length} 个` : ''}
            </span>
          </>
        )}

        {phase === 'working' && (
          <span className="island-drop-progress">
            <span className={['island-drop-track', hasRealProgress ? '' : 'indeterminate'].join(' ')}>
              <span className="island-drop-fill" style={hasRealProgress ? { width: `${pct}%` } : undefined} />
            </span>
            <span className="island-drop-pct">{hasRealProgress ? `${pct}%` : busyText}</span>
          </span>
        )}

        {phase === 'done' && <span className="island-drop-done">{status || '转换完成'}</span>}
      </div>

      {phase === 'working' && note && <div className="island-drop-note">{note}</div>}
      {phase === 'recognized' && status && <div className="island-drop-error">{status}</div>}
      {phase === 'recognized' && items.length > 0 && <PillActions items={items} />}
    </div>
  );
}

export default function IslandDrop() {
  const drop = useIslandDrop();
  return <IslandDropView drop={drop} />;
}
