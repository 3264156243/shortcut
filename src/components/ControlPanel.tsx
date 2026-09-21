import { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone, Play, Power, RefreshCw, RotateCcw, Copy, QrCode, ShieldAlert } from 'lucide-react';
import QRCode from 'qrcode';
import { useStore } from '../store';

interface ControlStatus {
  running: boolean;
  starting?: boolean;
  port: number;
  injector: boolean;
  authMode?: string;
  pairCode?: string | null;
  clients?: number;
  urls: string[];
}

export default function ControlPanel() {
  const addToast = useStore((s) => s.addToast);
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const refresh = useCallback(async () => {
    const result = await window.electronAPI?.getControlStatus?.();
    if (result) setStatus(result);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // 生成首个局域网地址的二维码（手机扫码直达控制页）
  useEffect(() => {
    const primary = status?.urls?.[0];
    if (!primary || !status?.running || status.starting) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(primary, { width: 220, margin: 1, color: { dark: '#1c1917', light: '#ffffff' } })
      .then((url: string) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [status?.running, status?.starting, status?.urls]);

  const start = async () => {
    setBusy(true);
    const result = await window.electronAPI?.startControl?.();
    setBusy(false);
    if (!result?.success) return addToast(result?.error || '启动失败', 'error');
    addToast('控制服务已启动', 'success');
    await refresh();
  };

  const stop = async () => {
    setBusy(true);
    await window.electronAPI?.stopControl?.();
    setBusy(false);
    addToast('控制服务已停止', 'info');
    await refresh();
  };

  const restart = async () => {
    setBusy(true);
    const result = await window.electronAPI?.restartControl?.();
    setBusy(false);
    if (!result?.success) return addToast(result?.error || '重启失败', 'error');
    addToast('控制服务已重启', 'success');
    await refresh();
  };

  const resetCode = async () => {
    if (!window.confirm('重置绑定码？已连接的手机将全部失效，需要重新输入新绑定码。')) return;
    const result = await window.electronAPI?.resetControlCode?.();
    if (!result?.success) return addToast(result?.error || '重置失败', 'error');
    addToast('绑定码已重置', 'success');
    await refresh();
  };

  const copy = async (text: string, tip: string) => {
    await window.electronAPI?.copyText?.(text);
    addToast(tip, 'success');
  };

  const running = !!status?.running && !status?.starting;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ color: 'var(--color-text)' }}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--color-accent)', color: 'white' }}><MonitorSmartphone size={17} /></div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">控制</div>
          <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {status?.running ? (status.starting ? '服务启动中…' : `运行中 · 端口 ${status.port}`) : '已停止'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {status?.running && (
            <button type="button" onClick={() => void restart()} disabled={busy} title="重启服务" className="flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-50" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><RotateCcw size={14} /></button>
          )}
          <button type="button" onClick={() => void refresh()} title="刷新状态" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}><RefreshCw size={14} /></button>
          {running ? (
            <button type="button" onClick={() => void stop()} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-white disabled:opacity-50" style={{ background: '#b3564e' }}><Power size={13} />停止</button>
          ) : (
            <button type="button" onClick={() => void start()} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-white disabled:opacity-50" style={{ background: 'var(--color-accent)' }}><Play size={13} />启动</button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ background: 'var(--color-bg)' }}>
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {/* 服务状态 */}
          <section className="rounded-xl p-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
              <span className={`h-2 w-2 rounded-full ${running ? '' : 'opacity-40'}`} style={{ background: running ? '#63b582' : 'var(--color-text-muted)' }} />
              服务状态
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                <div className="text-lg font-bold">{status?.running ? (status.starting ? '启动中' : '运行中') : '停止'}</div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>服务</div>
              </div>
              <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                <div className="text-lg font-bold">{status?.injector ? '就绪' : (running ? '等待' : '—')}</div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>输入注入</div>
              </div>
              <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                <div className="text-lg font-bold">{status?.clients ?? '—'}</div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>已连接手机</div>
              </div>
            </div>
          </section>

          {running && (
            <>
              {/* 绑定码 */}
              <section className="rounded-xl p-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                <div className="mb-2 text-xs font-semibold">绑定码</div>
                {status?.pairCode ? (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 text-center text-3xl font-bold tracking-[0.35em]" style={{ fontFamily: 'ui-monospace, Consolas, monospace', color: 'var(--color-accent)' }}>{status.pairCode}</div>
                    <button type="button" onClick={() => void copy(status.pairCode || '', '绑定码已复制')} title="复制绑定码" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--color-bg-card-hover)' }}><Copy size={14} /></button>
                    <button type="button" onClick={() => void resetCode()} title="重置绑定码" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--color-bg-card-hover)' }}><RotateCcw size={14} /></button>
                  </div>
                ) : (
                  <div className="py-2 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>等待服务就绪后显示…</div>
                )}
                <div className="mt-2 text-[11px] leading-5" style={{ color: 'var(--color-text-muted)' }}>
                  在手机控制页输入该绑定码完成配对。绑定码仅本机生成，重置后旧连接全部失效。
                </div>
              </section>

              {/* 局域网地址 + 二维码 */}
              <section className="rounded-xl p-4" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold"><QrCode size={13} />手机接入（需与电脑同一网络）</div>
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    {(status?.urls?.length ? status.urls : []).map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => void copy(url, '地址已复制')}
                        className="mb-2 block w-full truncate rounded-lg px-3 py-2 text-left text-xs transition-opacity hover:opacity-80"
                        style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', fontFamily: 'ui-monospace, Consolas, monospace', color: 'var(--color-accent)' }}
                        title="点击复制"
                      >
                        {url}
                      </button>
                    ))}
                    {!status?.urls?.length && <div className="py-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>未检测到局域网地址</div>}
                    <div className="text-[11px] leading-5" style={{ color: 'var(--color-text-muted)' }}>
                      手机浏览器打开上方地址（或扫码）→ 输入绑定码 → 即可用手机向电脑打字、控制鼠标、使用电脑粘贴板。
                    </div>
                  </div>
                  {qrDataUrl && (
                    <div className="shrink-0 rounded-lg p-2" style={{ background: '#ffffff' }}>
                      <img src={qrDataUrl} alt="手机扫码接入" width={150} height={150} />
                      <div className="mt-1 text-center text-[10px]" style={{ color: '#57534e' }}>扫码打开控制页</div>
                    </div>
                  )}
                </div>
              </section>

              {/* 安全提示 */}
              <section className="flex items-start gap-2 rounded-xl p-4 text-[11px] leading-5" style={{ background: 'rgba(179,86,78,.08)', border: '1px solid rgba(179,86,78,.25)', color: 'var(--color-text-muted)' }}>
                <ShieldAlert size={15} className="mt-0.5 shrink-0" style={{ color: '#c97b74' }} />
                <span>控制服务只在本机与局域网内可用，绑定码是唯一凭证；离开时点击「停止」关闭服务。任何人拿到绑定码即可操作你的电脑，请勿泄露。</span>
              </section>
            </>
          )}

          {!running && (
            <section className="flex flex-col items-center justify-center rounded-xl py-10 text-center" style={{ background: 'var(--color-bg-card)', border: '1px dashed var(--color-border)' }}>
              <MonitorSmartphone size={30} strokeWidth={1.4} style={{ color: 'var(--color-text-muted)' }} />
              <div className="mt-3 text-sm">把手机变成电脑的远程输入面板</div>
              <div className="mt-1 max-w-xs text-xs leading-5" style={{ color: 'var(--color-text-muted)' }}>
                点击「启动」开启控制服务，手机与电脑连同一网络后扫码或输入地址即可：缓冲打字、触控板、虚拟键盘、电脑粘贴板。
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
