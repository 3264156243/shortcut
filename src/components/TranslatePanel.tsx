import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Copy, Languages, LoaderCircle, Trash2 } from 'lucide-react';
import { useStore } from '../store';

const languageOptions = [
  ['auto', '自动检测'], ['zh', '简体中文'], ['en', '英语'], ['jp', '日语'], ['kor', '韩语'],
  ['fra', '法语'], ['de', '德语'], ['ru', '俄语'], ['spa', '西班牙语'], ['ara', '阿拉伯语'],
  ['th', '泰语'], ['it', '意大利语'], ['pt', '葡萄牙语'], ['vie', '越南语'],
] as const;

export default function TranslatePanel() {
  const addToast = useStore((state) => state.addToast);
  const [from, setFrom] = useState('auto');
  const [to, setTo] = useState('zh');
  const [source, setSource] = useState('');
  const [result, setResult] = useState('');
  const [detectedFrom, setDetectedFrom] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const text = source.trim();
    if (!text) { setResult(''); setLoading(false); return; }
    const currentId = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await window.electronAPI?.translateText(text, from, to);
        if (currentId !== requestId.current) return;
        if (response?.success) {
          setResult(response.translatedText || '');
          setDetectedFrom(response.from || '');
        } else {
          setResult('');
          addToast(`翻译失败：${response?.error || '翻译服务暂不可用'}`, 'error');
        }
      } catch (error: any) {
        if (currentId === requestId.current) addToast(`翻译失败：${error.message}`, 'error');
      } finally {
        if (currentId === requestId.current) setLoading(false);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [addToast, from, source, to]);

  const swap = () => {
    const nextFrom = to;
    const nextTo = from === 'auto' ? (detectedFrom || 'en') : from;
    setFrom(nextFrom);
    setTo(nextTo === nextFrom ? (nextFrom === 'zh' ? 'en' : 'zh') : nextTo);
    if (result) { setSource(result); setResult(source); }
  };

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
    addToast('译文已复制', 'success');
  };

  const selectStyle = { background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-5 pb-5" style={{ background: 'var(--color-bg)' }}>
      <div className="flex h-16 shrink-0 items-center px-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <select value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 w-44 rounded-md border px-3 text-sm outline-none" style={selectStyle}>{languageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <button onClick={swap} className="flex h-9 w-9 items-center justify-center rounded-md transition-all hover:opacity-75" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-accent)' }} title="对换语言"><ArrowLeftRight size={17} /></button>
          <select value={to} onChange={(event) => setTo(event.target.value)} className="h-9 w-44 rounded-md border px-3 text-sm outline-none" style={selectStyle}>{languageOptions.filter(([value]) => value !== 'auto').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden rounded-lg border">
        <section className="relative flex min-h-0 flex-col border-r" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex h-12 shrink-0 items-center justify-between px-5 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}><span>原文</span><button onClick={() => setSource('')} disabled={!source} className="flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-25" title="清空"><Trash2 size={15} /></button></div>
          <textarea autoFocus value={source} onChange={(event) => setSource(event.target.value.slice(0, 5000))} placeholder="在这里输入或粘贴文字" className="min-h-0 flex-1 resize-none bg-transparent px-5 py-4 pb-10 text-[15px] leading-7 outline-none" style={{ color: 'var(--color-text)' }} />
          <span className="absolute bottom-3 right-4 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{source.length}/5000</span>
        </section>
        <section className="relative flex min-h-0 flex-col" style={{ background: 'var(--color-bg-secondary)' }}>
          <div className="flex h-11 shrink-0 items-center justify-between px-4 text-xs font-medium" style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}><span className="flex items-center gap-2">译文{loading && <LoaderCircle size={13} className="animate-spin" />}</span></div>
          {result ? <><div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 pr-14 text-[15px] leading-7" style={{ color: 'var(--color-text)' }}>{result}</div><button onClick={() => void copyResult()} className="absolute right-4 top-15 flex h-8 w-8 items-center justify-center rounded-md border" style={{ borderColor: 'var(--color-border)', color: copied ? 'var(--color-success)' : 'var(--color-text-secondary)' }} title="复制译文">{copied ? <Check size={15} /> : <Copy size={15} />}</button></> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3" style={{ color: 'var(--color-text-muted)' }}><Languages size={28} strokeWidth={1.5} /><span className="text-sm">译文将在这里自动显示</span></div>}
        </section>
      </div>
    </div>
  );
}