import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, Copy, RefreshCw, CheckCircle2 } from 'lucide-react';

interface BindInfo {
  bindId?: string;
  code?: string;
  bindUrl?: string;
}

export default function BindCard() {
  const [info, setInfo] = useState<BindInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedTarget, setCopiedTarget] = useState<'url' | 'code' | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [message, setMessage] = useState('');

  const refresh = () => {
    setLoading(true);
    setMessage('');
    void window.electronAPI?.syncGetBinding?.()
      .then((r: any) => {
        if (r?.success) {
          setInfo({ bindId: r.bindId, code: r.code, bindUrl: r.bindUrl });
        } else {
          setInfo(null);
          setMessage(r?.message || '暂时无法获取绑定信息');
        }
      })
      .catch(() => {
        setInfo(null);
        setMessage('暂时无法获取绑定信息，请检查网络');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    let cancelled = false;
    if (!info?.bindUrl) {
      setQrCode('');
      return;
    }
    void QRCode.toDataURL(info.bindUrl, {
      width: 168,
      margin: 1,
      color: { dark: '#34271f', light: '#fffaf0' },
      errorCorrectionLevel: 'M',
    }).then((url) => {
      if (!cancelled) setQrCode(url);
    }).catch(() => {
      if (!cancelled) setQrCode('');
    });
    return () => { cancelled = true; };
  }, [info?.bindUrl]);

  const copyBind = () => {
    if (!info?.bindUrl) return;
    void window.electronAPI?.copyText?.(info.bindUrl);
    setCopiedTarget('url');
    setTimeout(() => setCopiedTarget(null), 2000);
  };

  const copyCode = () => {
    if (!info?.code) return;
    void window.electronAPI?.copyText?.(info.code);
    setCopiedTarget('code');
    setTimeout(() => setCopiedTarget(null), 2000);
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
  };
  const subStyle: React.CSSProperties = {
    background: 'var(--color-bg-card-hover)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
  };

  return (
    <div style={cardStyle}>
      <div className="flex items-center gap-2 mb-2">
        <Smartphone size={15} style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>联动绑定</span>
        {info?.code && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(52, 211, 153, .14)', color: '#34d399' }}>
            已绑定 {info.code}
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-secondary)' }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>
      <p className="text-[11px] leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
        手机浏览器访问绑定地址或输入绑定码，可将手机、网页提交的任务同步到桌面端任务墙。绑定永久有效，后续其他联动板块复用同一身份。
      </p>

      {loading ? (
        <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>获取绑定信息…</div>
      ) : info ? (
        <div className="flex flex-col gap-2.5">
          <div className="grid gap-3 sm:grid-cols-[168px_minmax(0,1fr)]">
            <div style={{ ...subStyle, display: 'grid', placeItems: 'center', minHeight: 168 }}>
              {qrCode ? (
                <img src={qrCode} alt="手机联动二维码" width={168} height={168} style={{ borderRadius: 8, maxWidth: '100%' }} />
              ) : (
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>二维码生成中…</span>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2.5">
          <div style={subStyle}>
            <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-muted)' }}>绑定地址</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={info.bindUrl || ''}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: 'var(--color-bg-card)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                onClick={copyBind}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-80"
                style={{ background: copiedTarget === 'url' ? '#34d399' : 'var(--color-accent)', color: 'white' }}
              >
                {copiedTarget === 'url' ? '已复制' : <><Copy size={11} /> 复制</>}
              </button>
            </div>
          </div>
          {info.code && (
            <div style={subStyle}>
              <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-muted)' }}>绑定码</div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-bold tracking-widest" style={{ color: 'var(--color-accent)', fontFamily: 'monospace' }}>
                  {info.code}
                </span>
                <button type="button" onClick={copyCode} className="p-2 rounded-lg hover:opacity-80" title="复制绑定码" style={{ color: 'var(--color-text-secondary)' }}>
                  {copiedTarget === 'code' ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          )}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{message || '暂未获取到绑定信息，请检查网络后刷新'}</div>
      )}
    </div>
  );
}
