import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Clipboard, Copy, Download, FilePlus2, RefreshCw, Send, Share2, Trash2 } from 'lucide-react';
import { useStore } from '../store';

interface TransferMessage {
  id: string;
  type: 'text' | 'file' | 'image';
  text?: string;
  fileId?: string;
  name?: string;
  size?: number;
  sender: 'desktop' | 'mobile' | 'share';
  createdAt: string;
}

interface TransferShare {
  id: string;
  code: string;
  expiresAt: string;
  type: 'text' | 'file';
  text?: string;
  name?: string;
  size?: number;
  createdAt: string;
}

export default function FileTransferPanel() {
  const addToast = useStore((s) => s.addToast);
  const [messages, setMessages] = useState<TransferMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bound, setBound] = useState(false);
  const [bindCode, setBindCode] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [shareHours, setShareHours] = useState(1);
  const [shares, setShares] = useState<TransferShare[]>([]);
  const [sharesOpen, setSharesOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const refreshingRef = useRef(false);
  const lastRefreshErrorRef = useRef('');

  const refresh = useCallback(async (showLoading = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const result = await window.electronAPI?.fileTransferGetState?.();
      setBound(result?.bound === true);
      setBindCode(result?.binding?.code || '');
      if (result?.success) {
        setMessages(Array.isArray(result.messages) ? result.messages : []);
        lastRefreshErrorRef.current = '';
      } else if (result?.message && result.message !== lastRefreshErrorRef.current) {
        lastRefreshErrorRef.current = result.message;
        addToast(result.message, 'error');
      }
    } finally {
      refreshingRef.current = false;
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const sendText = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      const result = await window.electronAPI?.fileTransferSendText?.(value);
      if (!result?.success) return addToast(result?.message || '发送失败', 'error');
      setText('');
      await refresh();
    } finally { setSending(false); }
  };

  const deleteMessage = async (id: string) => {
    if (!window.confirm('确定删除这条消息吗？删除后所有客户端都不可见。')) return;
    const result = await window.electronAPI?.fileTransferDelete?.(id);
    if (!result?.success) return addToast(result?.message || '删除失败', 'error');
    setMessages((items) => items.filter((item) => item.id !== id));
  };

  const sendFile = async () => {
    const filePath = await window.electronAPI?.openFile?.();
    if (!filePath) return;
    setUploading(true);
    try {
      const result = await window.electronAPI?.fileTransferSendFile?.(filePath);
      if (!result?.success) return addToast(result?.message || '文件发送失败', 'error');
      addToast('文件已发送', 'success');
      await refresh();
    } finally { setUploading(false); }
  };

  const downloadFile = async (message: TransferMessage) => {
    if (!message.fileId || !message.name) return;
    const result = await window.electronAPI?.fileTransferDownload?.(message.fileId, message.name);
    if (!result?.success) return addToast(result?.message || '下载失败', 'error');
    addToast(`已保存：${result.path || message.name}`, 'success');
  };

  const claim = async () => {
    const code = claimCode.trim().toUpperCase();
    if (code.length !== 6) return addToast('请输入 6 位接收密码', 'info');
    const result = await window.electronAPI?.fileTransferClaim?.(code);
    if (!result?.success) return addToast(result?.message || '领取失败', 'error');
    const claimed = result?.message || {};
    const value = claimed.text || '';
    if ((claimed.type === 'file' || claimed.type === 'image') && claimed.fileId) {
      if (!result.downloadToken) return addToast('共享下载令牌无效，请重新领取', 'error');
      const download = await window.electronAPI?.fileTransferDownloadShared?.(result.downloadToken, claimed.name || '共享文件');
      if (!download?.success) return addToast(download?.message || '共享文件下载失败', 'error');
      addToast(`共享文件已保存：${download.path || claimed.name}`, 'success');
    } else if (value) {
      await window.electronAPI?.copyText?.(value);
      addToast('文本已复制到剪贴板', 'success');
    }
    setClaimCode('');
  };

  const createShare = async () => {
    const value = text.trim();
    if (!value) return addToast('请先在输入框填写要共享的文本', 'info');
    const result = await window.electronAPI?.fileTransferShareText?.(value, shareCode.trim().toUpperCase(), shareHours);
    if (!result?.success) return addToast(result?.message || '共享创建失败', 'error');
    setShareOpen(false);
    setShareCode(result.code || '');
    addToast(`接收密码：${result.code}`, 'success');
    await loadShares();
  };

  const createFileShare = async (message: TransferMessage) => {
    if (!message.id) return;
    const result = await window.electronAPI?.fileTransferShareFile?.(message.id, shareCode.trim().toUpperCase(), shareHours);
    if (!result?.success) return addToast(result?.message || '文件共享创建失败', 'error');
    setShareCode(result.code || '');
    addToast(`文件接收密码：${result.code}`, 'success');
    await loadShares();
  };

  const loadShares = async () => {
    const result = await window.electronAPI?.fileTransferShareList?.();
    if (result?.success) setShares(Array.isArray(result.shares) ? result.shares : []);
  };

  const deleteShare = async (id: string) => {
    if (!window.confirm('确定删除这条共享？')) return;
    const result = await window.electronAPI?.fileTransferShareDelete?.(id);
    if (!result?.success) return addToast(result?.message || '删除失败', 'error');
    setShares((items) => items.filter((item) => item.id !== id));
    addToast('共享已删除', 'success');
  };

  const toggleShares = async () => {
    const next = !sharesOpen;
    setSharesOpen(next);
    if (next) await loadShares();
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ color: 'var(--color-text)' }}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--color-accent)', color: 'white' }}><Send size={17} /></div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">文件快传</div>
          <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{bound ? `已绑定 · ${bindCode}` : '正在建立联动绑定'}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg px-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <input value={claimCode} onChange={(e) => setClaimCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6))} placeholder="接收密码" className="h-8 w-24 bg-transparent text-xs outline-none" />
            <button type="button" onClick={claim} title="领取共享内容" className="p-1"><Clipboard size={14} /></button>
          </div>
          <button type="button" onClick={() => void refresh()} title="刷新消息" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ background: 'var(--color-bg)' }}>
        {messages.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center text-center" style={{ color: 'var(--color-text-muted)' }}>
            <Send size={30} strokeWidth={1.4} />
            <div className="mt-3 text-sm">还没有快传消息</div>
            <div className="mt-1 text-xs">在下方发送文本或文件</div>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((message) => {
            const mine = message.sender === 'desktop';
            return (
              <div key={message.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[74%]">
                  <div className="rounded-lg px-3 py-2.5 text-sm leading-6" style={{ background: mine ? 'var(--color-accent)' : 'var(--color-bg-card)', color: mine ? 'white' : 'var(--color-text)', border: mine ? '0' : '1px solid var(--color-border)' }}>
                    {message.type === 'file' || message.type === 'image' ? <button type="button" onClick={() => void downloadFile(message)} className="flex items-center gap-2 text-left"><Download size={16} /><span><b className="block font-medium">{message.name}</b><small className="opacity-70">{formatBytes(message.size || 0)}</small></span></button> : message.text}
                  </div>
                  <div className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? 'justify-end' : ''}`} style={{ color: 'var(--color-text-muted)' }}>
                    <span>{new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    {message.type === 'text' && <button type="button" onClick={() => { void window.electronAPI?.copyText?.(message.text || ''); addToast('已复制', 'success'); }} title="复制" className="p-1"><Copy size={11} /></button>}
                    {(message.type === 'file' || message.type === 'image') && <button type="button" onClick={() => void createFileShare(message)} title="创建文件共享" className="p-1"><Share2 size={11} /></button>}
                    <button type="button" onClick={() => void deleteMessage(message.id)} title="删除" className="p-1"><Trash2 size={11} /></button>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="shrink-0 p-4" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
        {sharesOpen && (
          <div className="mx-auto mb-3 max-w-3xl rounded-lg p-3" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
              <Share2 size={13} style={{ color: 'var(--color-accent)' }} /> 我的共享
              <span className="text-[10px] font-normal" style={{ color: 'var(--color-text-muted)' }}>{shares.length} 条未删除</span>
            </div>
            {shares.length === 0 ? (
              <div className="py-2 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>暂无共享</div>
            ) : (
              <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
                {shares.map((share) => (
                  <div key={share.id} className="flex items-center gap-2 rounded-md px-2.5 py-2" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white" style={{ background: share.type === 'file' ? '#4f6d5c' : '#6b5d50' }}>
                      {share.type === 'file' ? '文件' : '文本'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--color-text)' }}>
                      {share.name || share.text || '共享内容'}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono" style={{ color: '#d8b46a' }}>{share.code}</span>
                    <span className="shrink-0 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>至 {new Date(share.expiresAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    <button type="button" onClick={() => void deleteShare(share.id)} title="删除共享" className="shrink-0 p-1 text-[#e5a19a] transition-opacity hover:opacity-70"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {shareOpen && (
          <div className="mx-auto mb-3 flex max-w-3xl items-center gap-2 rounded-lg p-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <Share2 size={14} style={{ color: 'var(--color-accent)' }} />
            <input value={shareCode} onChange={(e) => setShareCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6))} placeholder="留空自动生成密码" className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none" />
            <select value={shareHours} onChange={(e) => setShareHours(Number(e.target.value))} className="h-8 rounded-md px-2 text-xs" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>
              {[1, 3, 6, 12, 24].map((hour) => <option key={hour} value={hour}>{hour} 小时</option>)}
            </select>
            <button type="button" onClick={() => void createShare()} className="h-8 rounded-md px-3 text-xs text-white" style={{ background: 'var(--color-accent)' }}>生成</button>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg p-2" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
          <button type="button" onClick={() => void sendFile()} disabled={uploading} title="选择文件" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md disabled:opacity-50" style={{ background: 'var(--color-bg-card-hover)' }}><FilePlus2 size={17} /></button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(); } }} placeholder="发送文本，Enter 发送，Shift+Enter 换行" rows={1} className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none" />
          <button type="button" onClick={() => setShareOpen((open) => !open)} title="共享发送" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: shareOpen ? 'var(--color-accent)' : 'var(--color-bg-card-hover)', color: shareOpen ? 'white' : undefined }}><Share2 size={16} /></button>
          <button type="button" onClick={() => void toggleShares()} title="我的共享" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: sharesOpen ? 'var(--color-accent)' : 'var(--color-bg-card-hover)', color: sharesOpen ? 'white' : undefined }}>{sharesOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
          <button type="button" onClick={() => void sendText()} disabled={!text.trim() || sending} title="发送" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white disabled:opacity-40" style={{ background: 'var(--color-accent)' }}><Send size={16} /></button>
        </div>
      </footer>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
