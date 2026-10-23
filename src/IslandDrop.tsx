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
  const [transferDropSend, setTransferDropSend] = useState(false);
  const jobId = useRef('');
  const transferTaskId = useRef('');
  const phaseRef = useRef<DropPhase>('idle');
  phaseRef.current = phase;
  const resetTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  /** 本次拖拽是否已经收到过"松手"：收到后 Leave 一律不再复位 */
  const droppedRef = useRef(false);
  /** id 未知时先到的转换事件（小任务比 IPC 回包还快），start(id) 时按序补放 */
  const earlyEvents = useRef<
    Array<
      | { kind: 'progress'; id: string; pct?: number; note?: string }
      | { kind: 'done'; id: string; out?: string; out_dir?: string }
      | { kind: 'error'; id: string; message?: string }
    >
  >([]);
  const drainEarlyRef = useRef<((id: string) => void) | null>(null);

  // ── 配置：默认格式 / 转换后自动打开目录（转换板块设置面板里改）──
  const loadPrefs = useCallback(() => {
    void window.electronAPI?.readConfig?.().then((raw) => {
      if (!raw) return;
      try {
        const conv = JSON.parse(raw)?.converter || {};
        const transfer = JSON.parse(raw)?.fileTransfer || {};
        if (conv.defaultCompress) setCompressFmt(String(conv.defaultCompress));
        if (conv.defaultImage) setImageFmt(String(conv.defaultImage));
        if (conv.defaultAudio) setAudioFmt(String(conv.defaultAudio));
        setAutoReveal(conv.autoReveal !== false);
        setTransferDropSend(transfer.islandDropSend === true);
      } catch {}
    });
  }, []);

  /** 复位到 idle：撤掉按钮，岛恢复拖放前的内容 */
  const reset = useCallback(() => {
    if (resetTimer.current) { window.clearTimeout(resetTimer.current); resetTimer.current = null; }
    if (leaveTimer.current) { window.clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    droppedRef.current = false;
    jobId.current = '';
    transferTaskId.current = '';
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
    // 注意 else 分支必须**防抖**：WebView2 在拖拽过程中（以及松手之后）都会补发一次 DragLeave，
    // 若立即复位就会把紧接着的松手丢掉、或者把刚识别出来的按钮又清掉（两种都实测踩到）。
    const offOver = window.electronAPI?.onBallDragover?.((payload) => {
      const active = !!payload?.active;
      if (active) {
        if (leaveTimer.current) { window.clearTimeout(leaveTimer.current); leaveTimer.current = null; }
        if (phaseRef.current === 'recognized' || phaseRef.current === 'working' || phaseRef.current === 'done') return;
        setFiles([]);
        setStatus('');
        setNote('');
        setPct(0);
        setHasRealProgress(false);
        setPhase('hover');
        void window.electronAPI?.ballShape?.('hint'); // 悬停期间保持可交互，落点一定收得到
        // 兜底：万一 Leave/松手都没来（拖到一半取消等），悬停也不能永久挂着
        if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => {
          hoverTimer.current = null;
          if (phaseRef.current === 'hover' && !droppedRef.current) reset();
        }, 6000);
      } else if (phaseRef.current === 'hover') {
        // 已经收到过"松手"的这一次拖拽，后续 Leave 不再复位（松手后会补发 Leave）
        if (droppedRef.current) return;
        if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
        leaveTimer.current = window.setTimeout(() => {
          leaveTimer.current = null;
          if (phaseRef.current !== 'hover' || droppedRef.current) return;
          reset();
        }, 700);
      }
    });

    // 松手：识别 → 岛内展示「文件名 + 格式」→ 岛身向下长出椭圆按钮
        // 关键：先**立刻**进识别态（用路径兜底），再异步补详情。
        // 之前这里是 `await converterDetect(...)` 之后才 setPhase，
        // 只要 detect 报错或返回晚于复位，界面就什么都不显示（用户实测踩到）。
    const offDrop = window.electronAPI?.onBallDrop?.((payload) => {
      const paths = payload?.paths || [];
      if (!paths.length) return;
      if (leaveTimer.current) { window.clearTimeout(leaveTimer.current); leaveTimer.current = null; }
      droppedRef.current = true;
      setStatus('');
      setNote('');
      setPct(0);
      setHasRealProgress(false);
      setFiles(paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() || p, kind: 'other' as const, ext: '', targets: [] })));
      setPhase('recognized');
      void window.electronAPI?.ballShape?.('menu'); // 按钮要能点：解除穿透
      void (async () => {
        try {
          const detected = ((await window.electronAPI?.converterDetect?.(paths)) || []) as Detected[];
          if (detected.length) setFiles(detected);
          loadPrefs(); // 设置面板刚改过也能立刻生效
        } catch (e) {
          // 识别失败也要让用户看到东西：保留兜底列表 + 明确提示，绝不静默回常态
          setStatus(`识别失败：${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    });

    // 事件可能在 `await converterExtract()` 返回之前就发出（小压缩包解压极快，
    // 前端还没设好 jobId，事件就被 id 过滤丢掉 → 界面永远卡在「解压中」）。
    // 所以：id 还不认识的事件先按顺序缓存，start(id) 时再补放一遍。
    const applyProgress = (payload: { id: string; pct?: number; note?: string }) => {
      setHasRealProgress(true);
      setPct(Math.max(0, Math.min(100, Number(payload.pct) || 0)));
      if (payload.note) setNote(String(payload.note));
    };
    const applyDone = (payload: { id: string; out?: string; out_dir?: string }) => {
      setPct(100);
      setNote('');
      setStatus('转换完成');
      setPhase('done');
      const target = payload.out || payload.out_dir || '';
      if (autoReveal && target) {
        window.setTimeout(() => { void window.electronAPI?.revealInExplorer?.(target); }, 120);
      }
      resetTimer.current = window.setTimeout(() => reset(), 1000);
    };
    const applyErr = (payload: { id: string; message?: string }) => {
      jobId.current = '';
      setPct(0);
      setHasRealProgress(false);
      setNote('');
      setStatus(`失败：${payload.message || '未知错误'}`);
      setPhase('recognized'); // 回到可重试状态
    };
    const drainEarly = (id: string) => {
      const kept: typeof earlyEvents.current = [];
      for (const ev of earlyEvents.current) {
        if (ev.id !== id) { kept.push(ev); continue; }
        if (ev.kind === 'progress') applyProgress(ev);
        else if (ev.kind === 'done') applyDone(ev);
        else applyErr(ev);
      }
      earlyEvents.current = kept;
    };
    drainEarlyRef.current = drainEarly;

    // 真实进度（Rust 在解码/编码/逐条目阶段上报）
    const offProgress = window.electronAPI?.onConverterProgress?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) {
        if (!jobId.current) earlyEvents.current.push({ kind: 'progress', id: payload.id, pct: payload.pct, note: payload.note });
        return;
      }
      applyProgress(payload);
    });

    // 完成：立刻 100% → 「转换完成」停留 1 秒 → 打开产物所在目录并选中 → 复位
    const offDone = window.electronAPI?.onConverterDone?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) {
        if (!jobId.current) earlyEvents.current.push({ kind: 'done', id: payload.id, out: payload.out, out_dir: payload.out_dir });
        return;
      }
      applyDone(payload);
    });

    const offErr = window.electronAPI?.onConverterError?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) {
        if (!jobId.current) earlyEvents.current.push({ kind: 'error', id: payload.id, message: payload.message });
        return;
      }
      applyErr(payload);
    });

    const offTransfer = window.electronAPI?.onFileTransferProgress?.((payload) => {
      if (!transferTaskId.current || payload?.taskId !== transferTaskId.current) return;
      setHasRealProgress(true);
      setPct(Math.max(0, Math.min(100, Math.round((Number(payload.progress) || 0) * 100))));
      const speed = Number(payload.speed) || 0;
      setNote(speed > 0 ? `${formatTransferSpeed(speed)}/s` : '正在发送');
      if (payload.status === 'completed') {
        transferTaskId.current = '';
        setPct(100);
        setNote('');
        setStatus('发送完成');
        setPhase('done');
        resetTimer.current = window.setTimeout(() => reset(), 1000);
      } else if (payload.status === 'failed' || payload.status === 'cancelled') {
        transferTaskId.current = '';
        setPct(0);
        setHasRealProgress(false);
        setNote('');
        setStatus(payload.status === 'cancelled' ? '发送已取消' : '发送失败，请重试');
        setPhase('recognized');
      }
    });

    return () => {
      offOver?.();
      offDrop?.();
      offProgress?.();
      offDone?.();
      offErr?.();
      offTransfer?.();
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
    drainEarlyRef.current?.(id); // 补放这个任务在设好 id 之前就到达的事件
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

  const doSend = () => {
    if (!files.length) return;
    beginWork();
    void (async () => {
      const state = await window.electronAPI?.fileTransferGetState?.();
      if (!state?.bound) {
        setStatus('请先在文件快传中绑定手机');
        setPhase('recognized');
        return;
      }
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const taskId = `island_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`;
        transferTaskId.current = taskId;
        setNote(files.length > 1 ? `正在发送 ${index + 1}/${files.length}` : '正在发送');
        const result = await window.electronAPI?.fileTransferSendFile?.(taskId, file.path);
        if (!result?.success) {
          transferTaskId.current = '';
          setPct(0);
          setHasRealProgress(false);
          setNote('');
          setStatus(result?.cancelled ? '发送已取消' : `发送失败：${result?.message || '未知错误'}`);
          setPhase('recognized');
          return;
        }
      }
      transferTaskId.current = '';
      setPct(100);
      setNote('');
      setStatus(files.length > 1 ? `${files.length} 个文件已发送` : '发送完成');
      setPhase('done');
      resetTimer.current = window.setTimeout(() => reset(), 1000);
    })();
  };

  // ── 按文件类型组装椭圆按钮（需求 §2.3；数据驱动，类型变多只改这里）──
  const buildItems = (): PillItem[] => {
    const cancel: PillItem = { key: 'cancel', label: '取消', tone: 'ghost', disabled: busy, onClick: reset };
    const send: PillItem[] = transferDropSend
      ? [{ key: 'send-mobile', label: '发送到手机', tone: 'primary', disabled: busy, onClick: doSend }]
      : [];
    if (kind === 'archive') {
      return [...send, { key: 'extract', label: '解压', tone: transferDropSend ? undefined : 'primary', disabled: busy, onClick: doExtract }, cancel];
    }
    if (kind === 'image' || kind === 'audio') {
      const isImage = kind === 'image';
      const fmt = isImage ? imageFmt : audioFmt;
      const opts = (first?.targets?.length ? first.targets : (isImage ? IMAGE_TARGETS : AUDIO_TARGETS))
        .map((t) => ({ value: t, label: t.toUpperCase() }));
      if (!opts.some((o) => o.value === fmt)) opts.unshift({ value: fmt, label: fmt.toUpperCase() });
      return [
        ...send,
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
      ...send,
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

function formatTransferSpeed(bytesPerSecond: number) {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB`;
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB`;
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
