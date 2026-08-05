import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import appIcon from '../assets/app-icon.png';

interface ActivationGateProps {
  checking: boolean;
  machineCode?: string;
  initialCode?: string;
  message?: string;
  onActivated: () => void;
}

export default function ActivationGate({ checking, machineCode, initialCode, message, onActivated }: ActivationGateProps) {
  const [code, setCode] = useState(initialCode || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setCode(initialCode || '');
  }, [initialCode]);

  const activate = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI?.activateLicense(code.trim());
      if (result && (result as any).success) {
        onActivated();
      } else {
        setError((result as any)?.message || '激活失败，请检查激活码');
      }
    } catch {
      setError('无法连接激活服务器，请检查网络');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'var(--color-overlay)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 20px 60px var(--color-shadow)',
        }}
      >
        <div className="flex flex-col items-center mb-5">
          <img src={appIcon} alt="" className="h-12 w-12 object-contain" />
          <h1 className="mt-3 text-lg font-semibold" style={{ color: 'var(--color-text)' }}>ShortCut</h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>请先激活后再使用</p>
        </div>

        {checking ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>正在核对激活状态...</span>
          </div>
        ) : (
          <>
            <label className="block text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>激活码</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void activate(); }}
              placeholder="请输入激活码"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
              style={{
                background: 'var(--color-bg-card-hover)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
            <button
              onClick={() => void activate()}
              disabled={busy || !code.trim()}
              className="mt-3 w-full py-2.5 rounded-xl text-sm transition-all duration-150 disabled:opacity-50"
              style={{ background: 'var(--color-accent)', color: 'white' }}
            >
              {busy ? '核对中...' : '激活'}
            </button>
            {(error || message) && (
              <p className="mt-3 text-xs" style={{ color: '#ff6b6b' }}>{error || message}</p>
            )}
            {machineCode && (
              <p className="mt-4 text-[11px] break-all" style={{ color: 'var(--color-text-muted)' }}>
                机器码：{machineCode}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
