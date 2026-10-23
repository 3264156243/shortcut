import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, ChevronDown, ChevronUp, Clipboard, Copy, Download, FilePlus2, FolderOpen,
  History, Image as ImageIcon, LoaderCircle, Pause, RefreshCw, RotateCcw, Send, Settings,
  Share2, Star, Trash2, X,
} from 'lucide-react';
import { useStore } from '../store';

interface TransferMessage {
  id: string;
  type: 'text' | 'file' | 'image';
  text?: string;
  fileId?: string;
  name?: string;
  size?: number;
  mime?: string;
  sender: 'desktop' | 'mobile' | 'share';
  favorite?: boolean;
  createdAt: string;
  expiresAt?: string;
}

interface TransferShare {
  id: string;
  code: string;
  expiresAt: string;
  type: 'text' | 'file' | 'image';
  text?: string;
  name?: string;
  size?: number;
  createdAt: string;
}

interface TransferTask {
  taskId: string;
  direction: 'upload' | 'download';
  name: string;
  total: number;
  transferred: number;
  progress: number;
  speed: number;
  eta: number;
  status: 'queued' | 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
  channel: string;
  fileId?: string;
}

interface TransferHistoryItem {
  id: string;
  time: string;
  direction: 'upload' | 'download';
  name: string;
  size: number;
  status: string;
  channel: string;
  localPath?: string;
  sourcePath?: string;
  fileId?: string;
  note?: string;
}

type QueueItem = { kind: 'path'; path: string; taskId: string } | { kind: 'bytes'; name: string; base64: string; taskId: string };

function newTaskId(prefix = 'transfer') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || '文件';
}

export default function FileTransferPanel() {
  const addToast = useStore((s) => s.addToast);
  const transferConfig = useStore((s) => s.config.fileTransfer || {});
  const [messages, setMessages] = useState<TransferMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [bound, setBound] = useState(false);
  const [bindCode, setBindCode] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [shareHours, setShareHours] = useState(1);
  const [shares, setShares] = useState<TransferShare[]>([]);
  const [sharesOpen, setSharesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<TransferHistoryItem[]>([]);
  const [tasks, setTasks] = useState<Record<string, TransferTask>>({});
  const [dragActive, setDragActive] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const previewUrlsRef = useRef<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const refreshingRef = useRef(false);
  const lastRefreshErrorRef = useRef('');
  const autoScrollRef = useRef(true);
  const initializedMessagesRef = useRef(false);
  const seenMessagesRef = useRef(new Set<string>());
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const currentTaskIdRef = useRef('');

  const saveTransferConfig = useCallback((patch: Record<string, unknown>) => {
    useStore.setState((state) => ({ config: { ...state.config, fileTransfer: { ...(state.config.fileTransfer || {}), ...patch } } }));
    void useStore.getState().saveConfig();
  }, []);

  const hydrateImagePreviews = useCallback((items: TransferMessage[]) => {
    items.filter((item) => item.type === 'image' && item.fileId && !previewUrlsRef.current[item.fileId]).forEach((item) => {
      previewUrlsRef.current[item.fileId!] = '__loading__';
      void window.electronAPI?.fileTransferPreviewUrl?.(item.fileId!).then((url) => {
        if (url) {
          previewUrlsRef.current[item.fileId!] = url;
          setPreviewUrls((current) => ({ ...current, [item.fileId!]: url }));
        } else {
          delete previewUrlsRef.current[item.fileId!];
        }
      });
    });
  }, []);

  const refresh = useCallback(async (showLoading = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const result = await window.electronAPI?.fileTransferGetState?.();
      setBound(result?.bound === true);
      setBindCode(result?.binding?.code || '');
      if (result?.success) {
        const next = Array.isArray(result.messages) ? result.messages as TransferMessage[] : [];
        if (initializedMessagesRef.current && transferConfig.autoCopyText) {
          const received = next.filter((item) => item.sender === 'mobile' && item.type === 'text' && item.text && !seenMessagesRef.current.has(item.id));
          const latest = received[received.length - 1];
          if (latest?.text) {
            void window.electronAPI?.copyText?.(latest.text);
            addToast('收到的文本已复制', 'success');
          }
        }
        seenMessagesRef.current = new Set(next.map((item) => item.id));
        initializedMessagesRef.current = true;
        setMessages(next);
        hydrateImagePreviews(next);
        lastRefreshErrorRef.current = '';
      } else if (result?.message && result.message !== lastRefreshErrorRef.current) {
        lastRefreshErrorRef.current = result.message;
        addToast(result.message, 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取快传消息失败';
      if (message !== lastRefreshErrorRef.current) addToast(message, 'error');
      lastRefreshErrorRef.current = message;
    } finally {
      refreshingRef.current = false;
      setLoading(false);
    }
  }, [addToast, hydrateImagePreviews, transferConfig.autoCopyText]);

  const loadHistory = useCallback(async () => {
    const result = await window.electronAPI?.fileTransferHistory?.();
    if (result?.success) setHistoryItems(Array.isArray(result.history) ? result.history : []);
  }, []);

  const drainQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (queueRef.current.length) {
        const item = queueRef.current.shift()!;
        currentTaskIdRef.current = item.taskId;
        const name = item.kind === 'path' ? fileName(item.path) : item.name;
        setTasks((current) => ({ ...current, [item.taskId]: { taskId: item.taskId, direction: 'upload', name, total: 0, transferred: 0, progress: 0, speed: 0, eta: 0, status: 'preparing', channel: 'cloud' } }));
        try {
          const result = item.kind === 'path'
            ? await window.electronAPI?.fileTransferSendFile?.(item.taskId, item.path)
            : await window.electronAPI?.fileTransferSendBytes?.(item.taskId, item.name, item.base64);
          if (!result?.success && !result?.cancelled) addToast(result?.message || `${name} 发送失败`, 'error');
          if (result?.success) addToast(`${name} 已发送`, 'success');
          await refresh();
          await loadHistory();
        } catch (error) {
          setTasks((current) => current[item.taskId] ? { ...current, [item.taskId]: { ...current[item.taskId], status: 'failed' } } : current);
          addToast(error instanceof Error ? error.message : `${name} 发送失败`, 'error');
        } finally {
          currentTaskIdRef.current = '';
        }
      }
    } finally {
      currentTaskIdRef.current = '';
      processingRef.current = false;
    }
  }, [addToast, loadHistory, refresh]);

  const enqueuePaths = useCallback((paths: string[]) => {
    const unique = paths.filter(Boolean).filter((path, index, list) => list.indexOf(path) === index);
    unique.forEach((path) => {
      const taskId = newTaskId('upload');
      queueRef.current.push({ kind: 'path', path, taskId });
      setTasks((current) => ({ ...current, [taskId]: { taskId, direction: 'upload', name: fileName(path), total: 0, transferred: 0, progress: 0, speed: 0, eta: 0, status: 'queued', channel: 'cloud' } }));
    });
    if (unique.length) void drainQueue();
  }, [drainQueue]);

  useEffect(() => {
    void refresh(true);
    void loadHistory();
    void window.electronAPI?.fileTransferActiveTasks?.().then((result) => {
      if (!result?.success || !Array.isArray(result.tasks)) return;
      setTasks(Object.fromEntries(result.tasks.map((task: TransferTask) => [task.taskId, task])));
    });
    const timer = window.setInterval(() => void refresh(), 3000);
    const offProgress = window.electronAPI?.onFileTransferProgress?.((task) => {
      if (!task?.taskId) return;
      setTasks((current) => ({ ...current, [task.taskId]: task as TransferTask }));
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') void loadHistory();
    });
    const offDrop = window.electronAPI?.onFileTransferDrop?.((payload) => enqueuePaths(payload?.paths || []));
    const offDrag = window.electronAPI?.onFileTransferDragover?.((payload) => setDragActive(!!payload?.active));
    return () => {
      window.clearInterval(timer);
      offProgress?.(); offDrop?.(); offDrag?.();
    };
  }, [enqueuePaths, loadHistory, refresh]);

  useEffect(() => {
    if (autoScrollRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendText = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      const result = await window.electronAPI?.fileTransferSendText?.(value);
      if (!result?.success) return addToast(result?.message || '发送失败', 'error');
      setText('');
      await refresh();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '发送失败', 'error');
    } finally { setSending(false); }
  };

  const pickFiles = async () => {
    const paths = await window.electronAPI?.fileTransferPickFiles?.();
    if (paths?.length) enqueuePaths(paths);
  };

  const onPaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(event.clipboardData.items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (!image) return;
    event.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || '').split(',')[1] || '';
      if (!base64) return addToast('剪贴板图片读取失败', 'error');
      const taskId = newTaskId('paste');
      queueRef.current.push({ kind: 'bytes', name: image.name || `粘贴图片-${Date.now()}.png`, base64, taskId });
      setTasks((current) => ({ ...current, [taskId]: { taskId, direction: 'upload', name: image.name || '粘贴图片.png', total: image.size, transferred: 0, progress: 0, speed: 0, eta: 0, status: 'queued', channel: 'cloud' } }));
      void drainQueue();
    };
    reader.readAsDataURL(image);
  };

  const ensureDownloadDirectory = async () => {
    if (transferConfig.downloadDirectoryAsked) return true;
    const useDefault = window.confirm('首次下载：确定使用系统“下载/ShortCut 快传”目录；取消可选择自定义目录。');
    if (useDefault) {
      saveTransferConfig({ downloadDirectoryAsked: true });
      return true;
    }
    const dir = await window.electronAPI?.openFolder?.();
    if (!dir) return false;
    saveTransferConfig({ downloadDirectoryAsked: true, downloadDirectory: dir });
    return true;
  };

  const downloadFile = async (message: TransferMessage) => {
    if (!message.fileId || !message.name || !(await ensureDownloadDirectory())) return;
    const taskId = newTaskId('download');
    const result = await window.electronAPI?.fileTransferDownload?.(taskId, message.fileId, message.name);
    if (!result?.success) return addToast(result?.message || '下载失败', result?.cancelled ? 'info' : 'error');
    addToast(`已保存：${result.path || message.name}`, 'success');
  };

  const deleteMessage = async (id: string) => {
    if (!window.confirm('确定删除这条消息吗？删除后所有客户端都不可见。')) return;
    const result = await window.electronAPI?.fileTransferDelete?.(id);
    if (!result?.success) return addToast(result?.message || '删除失败', 'error');
    setMessages((items) => items.filter((item) => item.id !== id));
  };

  const favoriteMessage = async (message: TransferMessage) => {
    const result = await window.electronAPI?.fileTransferFavorite?.(message.id, !message.favorite);
    if (!result?.success) return addToast(result?.message || '收藏失败', 'error');
    setMessages((items) => items.map((item) => item.id === message.id ? { ...item, favorite: !message.favorite } : item));
  };

  const claim = async () => {
    const code = claimCode.trim().toUpperCase();
    if (code.length !== 6) return addToast('请输入 6 位接收密码', 'info');
    const result = await window.electronAPI?.fileTransferClaim?.(code);
    if (!result?.success) return addToast(result?.message || '领取失败', 'error');
    const claimed = result?.message || {};
    if ((claimed.type === 'file' || claimed.type === 'image') && claimed.fileId) {
      if (!result.downloadToken || !(await ensureDownloadDirectory())) return addToast('共享下载令牌无效，请重新领取', 'error');
      const taskId = newTaskId('claim');
      const download = await window.electronAPI?.fileTransferDownloadShared?.(taskId, result.downloadToken, claimed.fileId, claimed.name || '共享文件');
      if (!download?.success) return addToast(download?.message || '共享文件下载失败', 'error');
      addToast(`共享文件已保存：${download.path || claimed.name}`, 'success');
    } else if (claimed.text) {
      await window.electronAPI?.copyText?.(claimed.text);
      addToast('文本已复制到剪贴板', 'success');
    }
    setClaimCode('');
  };

  const loadShares = async () => {
    const result = await window.electronAPI?.fileTransferShareList?.();
    if (result?.success) setShares(Array.isArray(result.shares) ? result.shares : []);
  };

  const createShare = async () => {
    const value = text.trim();
    if (!value) return addToast('请先在输入框填写要共享的文本', 'info');
    const result = await window.electronAPI?.fileTransferShareText?.(value, shareCode.trim().toUpperCase(), shareHours);
    if (!result?.success) return addToast(result?.message || '共享创建失败', 'error');
    setShareOpen(false); setShareCode(result.code || '');
    addToast(`接收密码：${result.code}`, 'success');
    await loadShares();
  };

  const createFileShare = async (message: TransferMessage) => {
    const result = await window.electronAPI?.fileTransferShareFile?.(message.id, shareCode.trim().toUpperCase(), shareHours);
    if (!result?.success) return addToast(result?.message || '文件共享创建失败', 'error');
    setShareCode(result.code || '');
    addToast(`文件接收密码：${result.code}`, 'success');
    await loadShares();
  };

  const deleteShare = async (id: string) => {
    if (!window.confirm('确定删除这条共享？')) return;
    const result = await window.electronAPI?.fileTransferShareDelete?.(id);
    if (!result?.success) return addToast(result?.message || '删除失败', 'error');
    setShares((items) => items.filter((item) => item.id !== id));
  };

  const chooseDownloadDirectory = async () => {
    const dir = await window.electronAPI?.openFolder?.();
    if (dir) saveTransferConfig({ downloadDirectoryAsked: true, downloadDirectory: dir });
  };

  const cancelTask = (taskId: string) => {
    const queued = queueRef.current.some((item) => item.taskId === taskId);
    if (queued) {
      queueRef.current = queueRef.current.filter((item) => item.taskId !== taskId);
      setTasks((current) => current[taskId]
        ? { ...current, [taskId]: { ...current[taskId], status: 'cancelled' } }
        : current);
      return;
    }
    if (currentTaskIdRef.current === taskId) void window.electronAPI?.fileTransferCancel?.(taskId);
  };

  const retryHistory = async (item: TransferHistoryItem) => {
    if (item.direction === 'upload' && item.sourcePath) {
      enqueuePaths([item.sourcePath]);
      return;
    }
    if (item.direction === 'download' && item.fileId) {
      const message = messages.find((entry) => entry.fileId === item.fileId);
      await downloadFile(message || { id: item.id, type: 'file', fileId: item.fileId, name: item.name, size: item.size, sender: 'mobile', createdAt: item.time });
    }
  };

  const activeTasks = useMemo(() => Object.values(tasks).filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status)), [tasks]);

  return (
    <div className="relative flex h-full min-h-0 flex-col" style={{ color: 'var(--color-text)' }}>
      <header className="flex min-h-14 shrink-0 items-center gap-3 px-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: 'var(--color-accent)' }}><Send size={17} /></div>
        <div className="min-w-0"><div className="text-sm font-semibold">文件快传</div><div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{bound ? `已绑定 · ${bindCode}` : '正在建立联动绑定'}</div></div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg px-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><input value={claimCode} onChange={(e) => setClaimCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter') void claim(); }} placeholder="接收密码" className="h-8 w-24 bg-transparent text-xs outline-none" /><button type="button" onClick={() => void claim()} title="领取共享内容" className="p-1"><Clipboard size={14} /></button></div>
          <IconButton title="传输历史" active={historyOpen} onClick={() => { setHistoryOpen((v) => !v); if (!historyOpen) void loadHistory(); }}><History size={14} /></IconButton>
          <IconButton title="快传设置" active={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}><Settings size={14} /></IconButton>
          <IconButton title="刷新消息" onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></IconButton>
        </div>
      </header>

      {activeTasks.length > 0 && <TaskStrip tasks={activeTasks} onCancel={cancelTask} />}

      {settingsOpen && <div className="grid shrink-0 grid-cols-[1fr_auto] gap-3 px-5 py-3 text-xs" style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}><div><div className="font-medium">下载目录</div><div className="mt-1 truncate" style={{ color: 'var(--color-text-muted)' }}>{transferConfig.downloadDirectory || '系统下载目录 / ShortCut 快传'}</div></div><button type="button" onClick={() => void chooseDownloadDirectory()} className="flex items-center gap-1 rounded-md px-3" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><FolderOpen size={13} /> 更改</button><label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={!!transferConfig.autoCopyText} onChange={(e) => saveTransferConfig({ autoCopyText: e.target.checked })} />收到文本时自动复制到剪贴板</label></div>}
      {historyOpen && <HistoryPanel items={historyItems} onRetry={(item) => void retryHistory(item)} onRemove={async (id) => { await window.electronAPI?.fileTransferHistoryRemove?.(id); await loadHistory(); }} />}

      <div ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; }} className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ background: 'var(--color-bg)' }}>
        {messages.length === 0 && !loading && <div className="flex h-full flex-col items-center justify-center text-center" style={{ color: 'var(--color-text-muted)' }}><Send size={30} strokeWidth={1.4} /><div className="mt-3 text-sm">还没有快传消息</div><div className="mt-1 text-xs">发送文本、选择文件，或直接拖入多个文件</div></div>}
        <div className="mx-auto flex max-w-3xl flex-col gap-3">{messages.map((message) => <MessageBubble key={message.id} message={message} previewUrl={message.fileId && previewUrls[message.fileId] !== '__loading__' ? previewUrls[message.fileId] : ''} onDownload={downloadFile} onFavorite={favoriteMessage} onShare={createFileShare} onDelete={deleteMessage} addToast={addToast} />)}<div ref={endRef} /></div>
      </div>

      <footer className="shrink-0 p-4" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
        {sharesOpen && <ShareList shares={shares} onDelete={deleteShare} />}
        {shareOpen && <div className="mx-auto mb-3 flex max-w-3xl items-center gap-2 rounded-lg p-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><Share2 size={14} style={{ color: 'var(--color-accent)' }} /><input value={shareCode} onChange={(e) => setShareCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6))} placeholder="留空自动生成密码" className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none" /><select value={shareHours} onChange={(e) => setShareHours(Number(e.target.value))} className="h-8 rounded-md px-2 text-xs" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>{[1, 3, 6, 12, 24].map((hour) => <option key={hour} value={hour}>{hour} 小时</option>)}</select><button type="button" onClick={() => void createShare()} className="h-8 rounded-md px-3 text-xs text-white" style={{ background: 'var(--color-accent)' }}>共享输入框文本</button></div>}
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg p-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><button type="button" onClick={() => void pickFiles()} title="选择一个或多个文件" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--color-bg-card-hover)' }}><FilePlus2 size={17} /></button><textarea value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => void onPaste(e)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(); } }} placeholder="发送文本；也可以粘贴图片、拖入多个文件" rows={1} className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none" /><IconButton title="共享发送" active={shareOpen} onClick={() => setShareOpen((open) => !open)}><Share2 size={16} /></IconButton><IconButton title="我的共享" active={sharesOpen} onClick={() => { const next = !sharesOpen; setSharesOpen(next); if (next) void loadShares(); }}>{sharesOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</IconButton><button type="button" onClick={() => void sendText()} disabled={!text.trim() || sending} title="发送" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white disabled:opacity-40" style={{ background: 'var(--color-accent)' }}>{sending ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}</button></div>
      </footer>

      {dragActive && <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed text-sm font-medium" style={{ background: 'color-mix(in srgb, var(--color-bg) 88%, transparent)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}><FilePlus2 className="mr-2" size={20} />松开发送文件</div>}
    </div>
  );
}

function IconButton({ children, title, active, onClick }: { children: React.ReactNode; title: string; active?: boolean; onClick: () => void }) {
  return <button type="button" title={title} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: active ? 'var(--color-accent)' : 'var(--color-bg-card)', color: active ? 'white' : undefined, border: '1px solid var(--color-border)' }}>{children}</button>;
}

function TaskStrip({ tasks, onCancel }: { tasks: TransferTask[]; onCancel: (id: string) => void }) {
  return <div className="flex shrink-0 gap-2 overflow-x-auto px-5 py-2" style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>{tasks.map((task) => <div key={task.taskId} className="min-w-56 max-w-72 flex-1 rounded-lg p-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><div className="flex items-center gap-2 text-xs"><LoaderCircle size={13} className={task.status === 'queued' ? '' : 'animate-spin'} /><span className="min-w-0 flex-1 truncate">{task.name}</span><button type="button" title="取消" onClick={() => onCancel(task.taskId)}><X size={13} /></button></div><div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-card-hover)' }}><div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, task.progress * 100)}%`, background: 'var(--color-accent)' }} /></div><div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--color-text-muted)' }}><span>{task.status === 'queued' ? '等待中' : `${formatBytes(task.transferred)} / ${formatBytes(task.total)}`}</span><span>{task.speed > 0 ? `${formatBytes(task.speed)}/s · ${formatDuration(task.eta)}` : task.channel}</span></div></div>)}</div>;
}

function MessageBubble({ message, previewUrl, onDownload, onFavorite, onShare, onDelete, addToast }: { message: TransferMessage; previewUrl: string; onDownload: (m: TransferMessage) => void; onFavorite: (m: TransferMessage) => void; onShare: (m: TransferMessage) => void; onDelete: (id: string) => void; addToast: (message: string, type?: 'success' | 'error' | 'info') => void }) {
  const mine = message.sender === 'desktop';
  return <div className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}><div className="max-w-[74%]"><div className="overflow-hidden rounded-lg text-sm leading-6" style={{ background: mine ? 'var(--color-accent)' : 'var(--color-bg-card)', color: mine ? 'white' : 'var(--color-text)', border: mine ? '0' : '1px solid var(--color-border)' }}>{message.type === 'image' ? <button type="button" onClick={() => void onDownload(message)} className="block max-w-sm text-left">{previewUrl ? <img src={previewUrl} alt={message.name || '图片'} className="max-h-64 w-full object-contain" /> : <div className="flex h-32 items-center justify-center px-10"><ImageIcon size={28} /></div>}<span className="flex items-center justify-between gap-3 px-3 py-2"><b className="truncate font-medium">{message.name || '图片'}</b><small className="shrink-0 opacity-70">{formatBytes(message.size || 0)}</small></span></button> : message.type === 'file' ? <button type="button" onClick={() => void onDownload(message)} className="flex items-center gap-2 px-3 py-2.5 text-left"><Download size={16} /><span><b className="block font-medium">{message.name}</b><small className="opacity-70">{formatBytes(message.size || 0)}</small></span></button> : <div className="whitespace-pre-wrap break-words px-3 py-2.5">{message.text}</div>}</div><div className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? 'justify-end' : ''}`} style={{ color: 'var(--color-text-muted)' }}><span>{new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>{message.type === 'text' && <button type="button" onClick={() => { void window.electronAPI?.copyText?.(message.text || ''); addToast('已复制', 'success'); }} title="复制" className="p-1"><Copy size={11} /></button>}<button type="button" onClick={() => void onFavorite(message)} title={message.favorite ? '取消收藏' : '收藏'} className="p-1"><Star size={11} fill={message.favorite ? 'currentColor' : 'none'} /></button>{message.type !== 'text' && <button type="button" onClick={() => void onShare(message)} title="创建文件共享" className="p-1"><Share2 size={11} /></button>}<button type="button" onClick={() => void onDelete(message.id)} title="删除" className="p-1"><Trash2 size={11} /></button></div></div></div>;
}

function ShareList({ shares, onDelete }: { shares: TransferShare[]; onDelete: (id: string) => void }) {
  return <div className="mx-auto mb-3 max-w-3xl rounded-lg p-3" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><Share2 size={13} style={{ color: 'var(--color-accent)' }} />我的共享<span className="text-[10px] font-normal" style={{ color: 'var(--color-text-muted)' }}>{shares.length} 条</span></div>{shares.length === 0 ? <div className="py-2 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>暂无共享</div> : <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">{shares.map((share) => <div key={share.id} className="flex items-center gap-2 rounded-md px-2.5 py-2" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}><span className="rounded px-1.5 py-0.5 text-[10px] text-white" style={{ background: share.type === 'text' ? '#6b5d50' : '#4f6d5c' }}>{share.type === 'text' ? '文本' : share.type === 'image' ? '图片' : '文件'}</span><span className="min-w-0 flex-1 truncate text-xs">{share.name || share.text || '共享内容'}</span><span className="font-mono text-[10px]" style={{ color: '#d8b46a' }}>{share.code}</span><span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>至 {new Date(share.expiresAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><button type="button" onClick={() => void onDelete(share.id)} title="删除共享" className="p-1 text-[#e5a19a]"><Trash2 size={13} /></button></div>)}</div>}</div>;
}

function HistoryPanel({ items, onRetry, onRemove }: { items: TransferHistoryItem[]; onRetry: (item: TransferHistoryItem) => void; onRemove: (id: string) => void }) {
  return <div className="max-h-56 shrink-0 overflow-y-auto px-5 py-3" style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}><div className="mb-2 flex items-center text-xs font-semibold"><History size={13} className="mr-1" />本地传输历史<button type="button" className="ml-auto text-[10px]" onClick={() => void onRemove('clear')}>清空</button></div>{items.length === 0 ? <div className="py-4 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>暂无传输历史</div> : <div className="grid gap-1.5">{items.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>{item.status === 'completed' ? <CheckCircle2 size={13} className="text-emerald-500" /> : item.status === 'cancelled' ? <Pause size={13} /> : <X size={13} className="text-red-400" />}<span className="min-w-0 flex-1 truncate">{item.name}</span><span style={{ color: 'var(--color-text-muted)' }}>{item.direction === 'upload' ? '发送' : '下载'} · {formatBytes(item.size)}</span>{item.status !== 'completed' && (item.sourcePath || item.fileId) && <button type="button" title="继续或重试" onClick={() => onRetry(item)}><RotateCcw size={13} /></button>}<button type="button" title="删除记录" onClick={() => void onRemove(item.id)}><Trash2 size={13} /></button></div>)}</div>}</div>;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '计算中';
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}
