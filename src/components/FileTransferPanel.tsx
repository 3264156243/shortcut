import { useEffect, useRef, useState } from 'react';
import { Clipboard, Copy, FilePlus2, RefreshCw, Send, Share2, Trash2 } from 'lucide-react';
import { useStore } from '../store';

interface TransferMessage {
  id: string;
  type: 'text' | 'file' | 'image';
  text?: string;
  sender: 'desktop' | 'mobile' | 'share';
  createdAt: string;
}

export default function FileTransferPanel() {
  const addToast = useStore((s) => s.addToast);
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
  const endRef = useRef<HTMLDivElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    const result = await window.electronAPI?.fileTransferGetState?.();
    setBound(result?.bound === true);
    setBindCode(result?.binding?.code || '');
    if (result?.success) setMessages(Array.isArray(result.messages) ? result.messages : []);
    else if (result?.message) addToast(result.message, 'error');
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const sendText = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    const result = await window.electronAPI?.fileTransferSendText?.(value);
    setSending(false);
    if (!result?.success) return addToast(result?.message || '发送失败', 'error');
    setText('');
    await refresh();
  };

  const deleteMessage = async (id: string) => {
    if (!window.confirm('确定删除这条消息吗？删除后所有客户端都不可见。')) return;
    const result = await window.electronAPI?.fileTransferDelete?.(id);
    if (!result?.success) return addToast(result?.message || '删除失败', 'error');
    setMessages((items) => items.filter((item) => item.id !== id));
  };

  const claim = async () => {
    const code = claimCode.trim().toUpperCase();
    if (code.length !== 6) return addToast('请输入 6 位接收密码', 'info');
    const result = await window.electronAPI?.fileTransferClaim?.(code);
    if (!result?.success) return addToast(result?.message || '领取失败', 'error');
    const value = result?.message?.text || '';
    if (value) {
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
            <div className="mt-1 text-xs">在下方发送文本，文件分片传输正在接入</div>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((message) => {
            const mine = message.sender === 'desktop';
            return (
              <div key={message.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[74%]">
                  <div className="rounded-lg px-3 py-2.5 text-sm leading-6" style={{ background: mine ? 'var(--color-accent)' : 'var(--color-bg-card)', color: mine ? 'white' : 'var(--color-text)', border: mine ? '0' : '1px solid var(--color-border)' }}>{message.text}</div>
                  <div className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? 'justify-end' : ''}`} style={{ color: 'var(--color-text-muted)' }}>
                    <span>{new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    <button type="button" onClick={() => { void window.electronAPI?.copyText?.(message.text || ''); addToast('已复制', 'success'); }} title="复制" className="p-1"><Copy size={11} /></button>
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
          <button type="button" onClick={() => addToast('文件分片上传正在接入下一阶段', 'info')} title="选择文件" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--color-bg-card-hover)' }}><FilePlus2 size={17} /></button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(); } }} placeholder="发送文本，Enter 发送，Shift+Enter 换行" rows={1} className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none" />
          <button type="button" onClick={() => setShareOpen((open) => !open)} title="共享发送" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: shareOpen ? 'var(--color-accent)' : 'var(--color-bg-card-hover)', color: shareOpen ? 'white' : undefined }}><Share2 size={16} /></button>
          <button type="button" onClick={() => void sendText()} disabled={!text.trim() || sending} title="发送" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white disabled:opacity-40" style={{ background: 'var(--color-accent)' }}><Send size={16} /></button>
        </div>
      </footer>
    </div>
  );
}
