import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Copy, Languages, LoaderCircle, Trash2 } from 'lucide-react';
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
    addToast('译文已复制', 'success');
  };

  const selectStyle = { background: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--color-bg)' }}>
      <div className="flex shrink-0 items-center border-b px-5 py-3" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <select value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 min-w-40 rounded-md border px-3 text-sm outline-none" style={selectStyle}>{languageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <button onClick={swap} className="flex h-10 w-10 items-center justify-center rounded-md transition-all hover:opacity-75" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-accent)' }} title="对换语言"><ArrowLeftRight size={17} /></button>
          <select value={to} onChange={(event) => setTo(event.target.value)} className="h-10 min-w-40 rounded-md border px-3 text-sm outline-none" style={selectStyle}>{languageOptions.filter(([value]) => value !== 'auto').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <section className="relative flex min-h-0 flex-col border-r" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex h-11 shrink-0 items-center justify-between px-4 text-xs font-medium" style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}><span>原文</span><button onClick={() => setSource('')} disabled={!source} className="flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30" title="清空"><Trash2 size={14} /></button></div>
          <textarea autoFocus value={source} onChange={(event) => setSource(event.target.value.slice(0, 5000))} placeholder="输入需要翻译的文字" className="min-h-0 flex-1 resize-none bg-transparent p-5 text-base leading-8 outline-none" style={{ color: 'var(--color-text)' }} />
          <span className="absolute bottom-3 right-4 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{source.length}/5000</span>
        </section>
        <section className="relative flex min-h-0 flex-col" style={{ background: 'var(--color-bg-secondary)' }}>
          <div className="flex h-11 shrink-0 items-center justify-between px-4 text-xs font-medium" style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}><span className="flex items-center gap-2">译文{loading && <LoaderCircle size={13} className="animate-spin" />}</span><button onClick={() => void copyResult()} disabled={!result} className="flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30" title="复制译文"><Copy size={14} /></button></div>
          {result ? <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-5 text-base leading-8" style={{ color: 'var(--color-text)' }}>{result}</div> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3" style={{ color: 'var(--color-text-muted)' }}><Languages size={28} strokeWidth={1.5} /><span className="text-sm">译文将在这里自动显示</span></div>}
        </section>
      </div>
    </div>
  );
}