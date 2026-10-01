import { useEffect, useRef, useState } from 'react';
import {
  Check,
  FileArchive,
  FileAudio,
  FileImage,
  FilePlus2,
  FolderOpen,
  HelpCircle,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../store';

interface DetectedFile {
  path: string;
  name: string;
  kind: string; // image | audio | archive | other
  ext: string;
  size: number;
  targets: string[];
  flavor?: string;
}

interface ConvFile extends DetectedFile {
  id: string;
  target: string;
  status: 'idle' | 'busy' | 'ok' | 'fail';
  out?: string;
  message?: string;
}

interface HistoryItem {
  id: string;
  time: string;
  action: string;
  src: string;
  out: string;
  status: string;
  note: string;
}

const KIND_ICON = {
  image: FileImage,
  audio: FileAudio,
  archive: FileArchive,
  other: HelpCircle,
} as const;

const KIND_LABEL: Record<string, string> = {
  image: '图片',
  audio: '音频',
  archive: '压缩包',
  other: '未知',
};

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

export default function ConverterPanel() {
  const licenseFeatureAccess = useStore((s) => s.licenseFeatureAccess);
  const [files, setFiles] = useState<ConvFile[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [outDir, setOutDir] = useState<string>('');
  const [zipPwd, setZipPwd] = useState('');
  const [bitrate, setBitrate] = useState(192);
  const [showHistory, setShowHistory] = useState(true);
  const idSeq = useRef(0);

  const featureOk = licenseFeatureAccess['converter'] !== false;

  const refreshHistory = () => {
    void window.electronAPI?.converterHistory?.().then(setHistory);
  };

  useEffect(() => {
    refreshHistory();
    // 拖放：Rust 层窗口 DragDrop 事件转发（手动拖入，无 action 字段）
    const offDrop = window.electronAPI?.onConverterDrop?.((data) => {
      if (data?.action) return; // 右键菜单/命令行走 pendingConverterDrop（App 切模块后由本组件消费）
      void addPaths(data?.paths || []);
    });
    const offDone = window.electronAPI?.onConverterDone?.((data) => {
      setFiles((prev) => prev.map((f) => (f.id === data.id ? { ...f, status: 'ok', out: data.out } : f)));
      refreshHistory();
    });
    const offError = window.electronAPI?.onConverterError?.((data) => {
      setFiles((prev) => prev.map((f) => (f.id === data.id ? { ...f, status: 'fail', message: data.message } : f)));
      refreshHistory();
    });
    return () => {
      offDrop?.();
      offDone?.();
      offError?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPaths = async (paths: string[]): Promise<ConvFile[]> => {
    if (!paths.length) return [];
    const detected = (await window.electronAPI?.converterDetect?.(paths)) || [];
    const fresh: ConvFile[] = detected.map((d, i) => ({
      ...d,
      id: `local-${Date.now()}-${(idSeq.current += 1) + i}`,
      target: d.targets[0] || '',
      status: 'idle' as const,
    }));
    setFiles((prev) => {
      const known = new Set(prev.map((f) => f.path));
      return [...prev, ...fresh.filter((f) => !known.has(f.path))];
    });
    return fresh;
  };

  const pendingDrop = useStore((s) => s.pendingConverterDrop);
  const setPendingDrop = useStore((s) => s.setPendingConverterDrop);

  // 右键菜单/命令行带入：加进列表；extract 动作直接开始解压
  useEffect(() => {
    if (!pendingDrop?.paths?.length) return;
    const payload = pendingDrop;
    setPendingDrop(null);
    void (async () => {
      const fresh = await addPaths(payload.paths);
      if (payload.action !== 'extract') return;
      const archives = fresh.filter((f) => f.kind === 'archive');
      for (const item of archives) {
        void extractOne(item);
      }
      if (archives.length === 0 && fresh.length > 0) {
        setFiles((prev) =>
          prev.map((f) =>
            fresh.some((n) => n.id === f.id) ? { ...f, status: 'fail', message: '该文件不是压缩包' } : f,
          ),
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDrop]);

  const pickFiles = async () => {
    const picked = await window.electronAPI?.converterPickFiles?.();
    void addPaths(picked || []);
  };

  const convertOne = (file: ConvFile, target?: string) => {
    const t = target || file.target;
    if (!t) return;
    setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, status: 'busy', message: undefined } : f)));
    // 图片第 4 参是质量(85)；音频第 4 参是码率 kbps——Rust 端按文件类型区分使用
    void window.electronAPI?.converterConvert?.(file.path, t, 85, bitrate, outDir || null);
  };

  const extractOne = (file: ConvFile) => {
    setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, status: 'busy', message: undefined } : f)));
    void window.electronAPI?.converterExtract?.(file.path, zipPwd || null, outDir || null);
  };

  const compressSelected = async (flavor: string) => {
    const chosen = files.filter((f) => f.status === 'idle' || f.status === 'ok');
    if (!chosen.length) return;
    const id = `local-zip-${Date.now()}`;
    setFiles((prev) => prev.map((f) => (chosen.some((c) => c.id === f.id) ? { ...f, status: 'busy' } : f)));
    // 压缩整体用一个伪任务：结果事件按单 id 匹配不到列表项，直接刷新历史并整体复位
    await window.electronAPI?.converterCompress?.(chosen.map((f) => f.path), flavor, null, zipPwd || null, 6);
    setTimeout(() => {
      setFiles((prev) => prev.map((f) => (chosen.some((c) => c.id === f.id) ? { ...f, status: 'ok' } : f)));
      refreshHistory();
    }, 400);
    void id;
  };

  const pickOutDir = async () => {
    const dir = await window.electronAPI?.converterPickDir?.();
    if (dir) setOutDir(dir);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));
  const clearFiles = () => setFiles([]);

  const busyCount = files.filter((f) => f.status === 'busy').length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: 'var(--color-bg-panel)' }}>
      {/* 头部 */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <FileImage size={16} style={{ color: 'var(--color-accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>转换</span>
          {!featureOk && <span className="text-[10px]" style={{ color: '#fb923c' }}>未授权</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={pickFiles} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-all duration-150 hover:opacity-85"
            style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <FilePlus2 size={13} /> 选择文件
          </button>
          <button onClick={clearFiles} disabled={!files.length}
            className="rounded-lg px-2.5 py-1.5 text-xs transition-all duration-150 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            清空
          </button>
        </div>
      </div>

      {/* 拖放区 */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); /* 路径经 Rust DragDrop 事件到达 */ }}
        className="mx-4 mt-3 shrink-0 rounded-xl px-4 py-4 text-center text-xs"
        style={{ border: '1.5px dashed var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        将文件拖入面板任意位置，或点击"选择文件" · 支持 png/jpg/webp/bmp/gif/tiff/ico 互转 · zip/tar 系解压压缩
      </div>

      {/* 文件列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {!files.length && (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
            暂无文件
          </div>
        )}
        <div className="flex flex-col gap-2">
          {files.map((file) => {
            const Icon = KIND_ICON[(file.kind as keyof typeof KIND_ICON) || 'other'] || HelpCircle;
            return (
              <div key={file.id} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                <Icon size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs" style={{ color: 'var(--color-text-primary)' }} title={file.path}>{file.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    <span>{KIND_LABEL[file.kind] || file.kind} · {fmtSize(file.size)}</span>
                    {file.status === 'ok' && <span style={{ color: '#4ade80' }}>· 完成</span>}
                    {file.status === 'fail' && <span style={{ color: '#f87171' }}>· {file.message || '失败'}</span>}
                    {file.status === 'busy' && <span>· 处理中…</span>}
                  </div>
                </div>
                {/* 图片：目标格式选择 + 转换 */}
                {file.kind === 'image' && file.targets.length > 0 && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <select
                      value={file.target}
                      onChange={(e) => setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, target: e.target.value } : f)))}
                      className="rounded-lg px-2 py-1.5 text-xs outline-none"
                      style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                      disabled={file.status === 'busy'}
                    >
                      {!file.target && <option value="">转出为…</option>}
                      {file.targets.map((t) => (
                        <option key={t} value={t}>.{t}</option>
                      ))}
                    </select>
                    <button onClick={() => convertOne(file)} disabled={!file.target || file.status === 'busy'}
                      className="rounded-lg px-3 py-1.5 text-xs transition-all duration-150 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35"
                      style={{ background: 'var(--color-accent)', color: '#fff' }}>
                      转换
                    </button>
                  </div>
                )}
                {/* 音频：目标格式 + 码率（mp3/opus）+ 转换 */}
                {file.kind === 'audio' && (
                  file.targets.length > 0 ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <select
                        value={file.target}
                        onChange={(e) => setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, target: e.target.value } : f)))}
                        className="rounded-lg px-2 py-1.5 text-xs outline-none"
                        style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                        disabled={file.status === 'busy'}
                      >
                        {!file.target && <option value="">转出为…</option>}
                        {file.targets.map((t) => (
                          <option key={t} value={t}>.{t}</option>
                        ))}
                      </select>
                      {(file.target === 'mp3' || file.target === 'opus') && (
                        <select
                          value={String(bitrate)}
                          onChange={(e) => setBitrate(Number(e.target.value))}
                          className="rounded-lg px-2 py-1.5 text-xs outline-none"
                          style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                          disabled={file.status === 'busy'}
                          title="码率 kbps"
                        >
                          {[128, 192, 256, 320].map((b) => (
                            <option key={b} value={b}>{b}k</option>
                          ))}
                        </select>
                      )}
                      <button onClick={() => convertOne(file)} disabled={!file.target || file.status === 'busy'}
                        className="rounded-lg px-3 py-1.5 text-xs transition-all duration-150 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35"
                        style={{ background: 'var(--color-accent)', color: '#fff' }}>
                        转换
                      </button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>该输入格式暂不支持</span>
                  )
                )}
                {/* 压缩包：解压 */}
                {file.kind === 'archive' && (
                  <button onClick={() => extractOne(file)} disabled={file.status === 'busy'}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs transition-all duration-150 hover:opacity-85 disabled:opacity-35"
                    style={{ background: 'var(--color-accent)', color: '#fff' }}>
                    {file.status === 'busy' ? <Loader2 size={12} className="animate-spin" /> : null}
                    解压{file.flavor ? ` (${file.flavor})` : ''}
                  </button>
                )}
                {file.status === 'ok' && <Check size={14} style={{ color: '#4ade80', flexShrink: 0 }} />}
                {file.status === 'busy' && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
                <button onClick={() => removeFile(file.id)} className="rounded p-1 transition-all duration-150 hover:opacity-70"
                  style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} title="移除">
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部操作区：输出目录 / 密码 / 压缩所选 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button onClick={pickOutDir} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-all duration-150 hover:opacity-85"
          style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          title={outDir || '默认输出到原文件所在目录'}>
          <FolderOpen size={13} />
          {outDir ? `输出: ${outDir.length > 28 ? `…${outDir.slice(-26)}` : outDir}` : '输出: 同目录'}
        </button>
        {outDir && (
          <button onClick={() => setOutDir('')} className="rounded-lg px-2 py-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>还原</button>
        )}
        <input
          value={zipPwd}
          onChange={(e) => setZipPwd(e.target.value)}
          placeholder="zip 密码（可选）"
          className="w-36 rounded-lg px-2.5 py-1.5 text-xs outline-none"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {busyCount > 0 ? `处理中 ${busyCount}…` : '压缩所选为'}
          </span>
          {(['zip', 'tar.gz', 'tar.xz'] as const).map((f) => (
            <button key={f} onClick={() => void compressSelected(f)} disabled={!files.length || busyCount > 0}
              className="rounded-lg px-2.5 py-1.5 text-xs transition-all duration-150 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35"
              style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* 历史记录 */}
      <div className="shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-4 py-2">
          <button onClick={() => setShowHistory((v) => !v)} className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            历史记录（{history.length}）{showHistory ? '▾' : '▸'}
          </button>
          {showHistory && history.length > 0 && (
            <button
              onClick={() => { void window.electronAPI?.converterHistoryRemove?.('clear'); setHistory([]); }}
              className="flex items-center gap-1 text-[10px] transition-all duration-150 hover:opacity-70"
              style={{ color: 'var(--color-text-muted)' }}>
              <Trash2 size={11} /> 清空历史
            </button>
          )}
        </div>
        {showHistory && (
          <div className="max-h-36 overflow-y-auto px-4 pb-3">
            {!history.length && <div className="py-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>暂无记录</div>}
            <div className="flex flex-col gap-1.5">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px]"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                  <span style={{ color: h.status === 'ok' ? '#4ade80' : '#f87171' }}>{h.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }} title={h.status === 'ok' ? h.out : h.note}>
                    {h.status === 'ok' ? h.out : `${h.note || '失败'}（${h.src}）`}
                  </span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{h.time}</span>
                  {h.status === 'ok' && h.out && (
                    <button onClick={() => void window.electronAPI?.openTarget?.(h.out)} className="text-[10px]" style={{ color: 'var(--color-accent)' }}>打开</button>
                  )}
                  <button
                    onClick={() => { void window.electronAPI?.converterHistoryRemove?.(h.id); setHistory((prev) => prev.filter((x) => x.id !== h.id)); }}
                    className="rounded p-0.5 transition-all duration-150 hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} title="删除">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
