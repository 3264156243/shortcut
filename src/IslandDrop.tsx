import React, { useEffect, useRef, useState } from 'react';
import PillActions, { type PillItem } from './components/PillActions';
import './islandDrop.css';

/**
 * 岛窗口文件拖拽识别与转换交互（需求文档 docs/island-drop-convert-rework.md）
 *
 * 状态机：idle → hover（松手自动识别）→ recognized（文件名+格式，下方椭圆按钮）
 *        → working（进度条）→ done（转换完成停留 1s → 打开目录并选中 → 按钮关闭 → 复位）→ idle
 *
 * 全部交互都在岛窗口内部渲染：悬停/识别/进度/完成只占岛窗口顶部胶囊位置，
 * 按钮在胶囊下方；岛自己的余额/歌词/时间内容不被替换（复位即恢复）。
 */

interface Detected {
  path: string;
  name: string;
  kind: string;
  ext: string;
  size?: number;
  targets: string[];
  flavor?: string;
}

type Phase = 'idle' | 'hover' | 'recognized' | 'working' | 'done';

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

/** 压缩默认格式候选 */
const COMPRESS_FORMATS = ['zip', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst'];
/** 图片/音频目标格式兜底（detect 返回实际可用列表时以它为准） */
const IMAGE_TARGETS = ['png', 'jpg', 'webp', 'bmp', 'gif', 'tiff', 'ico'];
const AUDIO_TARGETS = ['wav', 'mp3', 'flac', 'opus'];

/**
 * 「文件名 + 格式」且**过长省略中间**：保留名字首尾 + 完整扩展名
 * 例：很长的文件…格式.zip（需求 §2.2）
 */
function displayName(f: Detected, budget = 20): string {
  const name = f.name || f.path.split(/[\\/]/).pop() || f.path;
  const ext = f.ext ? `.${f.ext}` : '';
  const stem = ext && name.toLowerCase().endsWith(ext.toLowerCase())
    ? name.slice(0, name.length - ext.length)
    : name;
  if (stem.length <= budget) return stem + ext;
  const head = Math.max(4, budget - 6);
  return `${stem.slice(0, head)}…${stem.slice(-5)}${ext}`;
}

export default function IslandDrop() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [files, setFiles] = useState<Detected[]>([]);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState('');
  const [compressFmt, setCompressFmt] = useState('zip');
  const [imageFmt, setImageFmt] = useState('png');
  const [audioFmt, setAudioFmt] = useState('wav');
  const [autoReveal, setAutoReveal] = useState(true);
  const jobId = useRef('');
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const resetTimer = useRef<number | null>(null);

  // ── 配置：默认格式 / 转换后自动打开目录（转换面板设置面板可改）──
  const loadPrefs = () => {
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
  };

  /** 复位到 idle：撤掉遮罩与按钮，岛恢复拖放前的内容 */
  const reset = () => {
    if (resetTimer.current) { window.clearTimeout(resetTimer.current); resetTimer.current = null; }
    jobId.current = '';
    setFiles([]);
    setStatus('');
    setPct(0);
    setPhase('idle');
    void window.electronAPI?.ballShape?.('collapsed');
  };

  const flashDone = (text: string) => {
    setStatus(text);
    setPhase('done');
    resetTimer.current = window.setTimeout(() => reset(), 1000); // 「转换完成」停留 1 秒（需求 §2.4）
  };

  useEffect(() => {
    loadPrefs();

    // 拖入：岛内提示「松手自动识别」+ 岛身高亮放大（不再有窗口外蓝色虚线）
    const offOver = window.electronAPI?.onBallDragover?.((payload) => {
      const active = !!payload?.active;
      if (active) {
        if (phaseRef.current === 'recognized' || phaseRef.current === 'working') return;
        setFiles([]);
        setStatus('');
        setPhase('hover');
        void window.electronAPI?.ballShape?.('hint'); // 悬停期间保持可交互，落点一定收得到
      } else if (phaseRef.current === 'hover') {
        setPhase('idle');
        void window.electronAPI?.ballShape?.('collapsed');
      }
    });

    // 松手：识别 → 展示「文件名 + 格式」→ 下方弹出椭圆按钮
    const offDrop = window.electronAPI?.onBallDrop?.((payload) => {
      const paths = payload?.paths || [];
      if (!paths.length) return;
      setStatus('');
      setPct(0);
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

    // 进度：转换板块未发进度事件时，用下方兜底动画推进
    const offProgress = window.electronAPI?.onConverterProgress?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) return;
      setPct(Math.max(0, Math.min(100, Number(payload.pct) || 0)));
    });

    // 完成：停留 1 秒 → 自动打开产物所在目录并选中 → 按钮关闭 → 复位
    const offDone = window.electronAPI?.onConverterDone?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) return;
      setPct(100);
      flashDone('转换完成');
      const target = payload.out || payload.out_dir || '';
      if (autoReveal && target) {
        window.setTimeout(() => { void window.electronAPI?.revealInExplorer?.(target); }, 120);
      }
    });

    const offErr = window.electronAPI?.onConverterError?.((payload) => {
      if (!jobId.current || payload.id !== jobId.current) return;
      jobId.current = '';
      setPct(0);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReveal]);

  // 岛身悬停/工作态样式由岛根节点类名驱动
  useEffect(() => {
    const root = document.querySelector('.island-root');
    if (!root) return;
    root.classList.toggle('drop-hover', phase === 'hover');
    root.classList.toggle('drop-busy', phase === 'working' || phase === 'done');
    return () => { root.classList.remove('drop-hover', 'drop-busy'); };
  }, [phase]);

  // 进度兜底动画：没收到真实进度时缓慢推进到 90%，避免看起来卡住
  useEffect(() => {
    if (phase !== 'working') return;
    const timer = window.setInterval(() => {
      setPct((p) => (p >= 90 ? p : Math.min(90, p + Math.max(1, Math.round((90 - p) * 0.08)))));
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const first = files[0];
  const kind = first?.kind || 'other';
  const multi = files.length > 1;
  const busy = phase === 'working';

  const start = async (id: string | undefined) => {
    if (!id) { setStatus('任务提交失败'); setPhase('recognized'); return; }
    jobId.current = id;
    setPct(0);
    setStatus('');
    setPhase('working');
  };

  const doExtract = () => {
    if (!files.length) return;
    void (async () => {
      setPhase('working');
      let id = '';
      for (const f of files) {
        const res = await window.electronAPI?.converterExtract?.(f.path, null, null);
        id = res?.id || id;
      }
      await start(id);
    })();
  };

  const doCompress = () => {
    if (!files.length) return;
    void (async () => {
      setPhase('working');
      const res = await window.electronAPI?.converterCompress?.(files.map((f) => f.path), compressFmt, null, null, 6);
      await start(res?.id);
    })();
  };

  const doConvert = (target: string) => {
    if (!files.length) return;
    void (async () => {
      setPhase('working');
      let id = '';
      for (const f of files) {
        const res = await window.electronAPI?.converterConvert?.(f.path, target, 85, 192, null);
        id = res?.id || id;
      }
      await start(id);
    })();
  };

  // ── 按文件类型组装椭圆按钮（需求 §2.3）──
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
      // 默认格式不在候选里（例如源文件本身就是该格式）时补一条，避免下拉错位
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

  if (phase === 'idle') return null;

  const busyText = kind === 'archive' ? '解压中' : '转换中';

  return (
    <>
      {/* 岛窗口顶部（胶囊位置）：悬停提示 / 识别结果 / 进度 / 完成 */}
      <div className={['island-drop-bar', phase].join(' ')}>
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
            <span className="island-drop-track">
              <span className="island-drop-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="island-drop-pct">{pct}%</span>
          </span>
        )}
        {phase === 'working' && <span className="island-drop-hint">{busyText}…</span>}
        {phase === 'done' && <span className="island-drop-done">{status || '转换完成'}</span>}
      </div>

      {/* 岛窗口下方：椭圆交互按钮（识别完成后弹出；转换中/完成后自动关闭） */}
      {phase === 'recognized' && (
        <div className="island-drop-actions">
          <PillActions items={buildItems()} />
          {status && <div className="island-drop-error">{status}</div>}
        </div>
      )}
    </>
  );
}
