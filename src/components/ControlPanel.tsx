import { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorSmartphone, Play, Power, RefreshCw, RotateCcw, Copy, QrCode, ShieldAlert, Cloud, Wifi } from 'lucide-react';
import QRCode from 'qrcode';
import { useStore } from '../store';

interface LanStatus {
  running: boolean;
  starting?: boolean;
  port: number;
  injector: boolean;
  pairCode?: string | null;
  clients?: number;
  urls: string[];
}

interface CloudStatus {
  active: boolean;
  connected: boolean;
  connecting: boolean;
  injector: boolean;
  lastError: string;
}

type Mode = 'none' | 'cloud' | 'lan';

export default function ControlPanel() {
  const addToast = useStore((s) => s.addToast);
  const [lan, setLan] = useState<LanStatus | null>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState<Mode>('none');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const modeRef = useRef<Mode>('none');

  const refresh = useCallback(async () => {
    const [lanResult, cloudResult] = await Promise.all([
      window.electronAPI?.getControlStatus?.(),
      window.electronAPI?.getCloudControlStatus?.(),
    ]);
    if (lanResult) setLan(lanResult);
    if (cloudResult) setCloud(cloudResult);
    const activeMode: Mode = cloudResult?.active ? 'cloud' : lanResult?.running ? 'lan' : 'none';
    modeRef.current = activeMode;
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const lanRunning = !!lan?.running && !lan?.starting;
  const cloudActive = !!cloud?.active;
  const mode: Mode = cloudActive ? 'cloud' : lanRunning ? 'lan' : 'none';

  // 局域网模式：生成首个地址二维码；云模式：生成云控制页二维码（手机扫码直达）
  useEffect(() => {
    const primary = mode === 'cloud' ? 'https://shortcut.326415.xyz/control/app/' : lan?.urls?.[0];
    if (!primary) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(primary, { width: 220, margin: 1, color: { dark: '#1c1917', light: '#ffffff' } })
      .then((url: string) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [mode, lan?.urls]);

  const startCloud = async () => {
    setBusy('cloud');
    const result = await window.electronAPI?.startCloudControl?.();
    setBusy('none');
    if (!result?.success) return addToast(result?.error || '云端连接启动失败', 'error');
    addToast('云端连接已启动', 'success');
    await refresh();
  };

  const startLan = async () => {
    setBusy('lan');
    const result = await window.electronAPI?.startControl?.();
    setBusy('none');
    if (!result?.success) return addToast(result?.error || '启动失败', 'error');
    addToast('局域网控制服务已启动', 'success');
    await refresh();
  };

  const stopAll = async () => {
    setBusy(mode === 'cloud' ? 'cloud' : 'lan');
    await window.electronAPI?.stopCloudControl?.();
    await window.electronAPI?.stopControl?.();
    setBusy('none');
    addToast('控制服务已停止', 'info');
    await refresh();
  };

  const copy = async (text: string, tip: string) => {
    await window.electronAPI?.copyText?.(text);
    addToast(tip, 'success');
  };

  const cardStyle = { background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' };
  const mutedStyle = { color: 'var(--color-text-muted)' };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ color: 'var(--color-text)' }}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--color-accent)', color: 'white' }}><MonitorSmartphone size={17} /></div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">控制</div>
          <div className="text-[11px]" style={mutedStyle}>
            {mode === 'cloud'
              ? cloud?.connected ? '云端连接 · 运行中' : cloud?.connecting ? '云端连接中…' : '云端连接 · 等待重连'
              : mode === 'lan'
                ? `局域网 · 端口 ${lan?.port}`
                : '已停止'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => void refresh()} title="刷新状态" className="flex h-8 w-8 items-center justify-center rounded-lg" style={cardStyle}><RefreshCw size={14} /></button>
          {mode !== 'none' && (
            <button type="button" onClick={() => void stopAll()} disabled={busy !== 'none'} className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-white disabled:opacity-50" style={{ background: '#b3564e' }}><Power size={13} />停止</button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ background: 'var(--color-bg)' }}>
        <div className="mx-auto flex max-w-3xl flex-col gap-4">

          {/* ===== 模式选择（未运行） ===== */}
          {mode === 'none' && (
            <section className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void startCloud()}
                disabled={busy !== 'none'}
                className="rounded-xl p-4 text-left transition-transform active:scale-[.99] disabled:opacity-60"
                style={{ ...cardStyle, borderColor: 'var(--color-accent)' }}
              >
                <div className="flex items-center gap-2 text-sm font-semibold"><Cloud size={16} style={{ color: 'var(--color-accent)' }} />云端连接（推荐）</div>
                <div className="mt-2 text-xs leading-5" style={mutedStyle}>手机经云端中继连接电脑，<b>任何网络都可用</b>（4G / 别处 Wi-Fi 均可）。使用 ShortCut 绑定身份自动配对，无需输入额外连接码。</div>
                <div className="mt-2 text-[11px]" style={mutedStyle}>延迟约 30~80ms · 打字流畅 · 触控板可用</div>
              </button>
              <button
                type="button"
                onClick={() => void startLan()}
                disabled={busy !== 'none'}
                className="rounded-xl p-4 text-left transition-transform active:scale-[.99] disabled:opacity-60"
                style={cardStyle}
              >
                <div className="flex items-center gap-2 text-sm font-semibold"><Wifi size={16} style={{ color: 'var(--color-accent)' }} />局域网直连</div>
                <div className="mt-2 text-xs leading-5" style={mutedStyle}>手机与电脑连接<b>同一网络</b>时使用，延迟最低。手机扫码或输入地址 + 6 位绑定码连接。</div>
                <div className="mt-2 text-[11px]" style={mutedStyle}>延迟约 5~15ms · 最快响应</div>
              </button>
            </section>
          )}

          {/* ===== 云模式状态 ===== */}
          {mode === 'cloud' && cloud && (
            <>
              <section className="rounded-xl p-4" style={cardStyle}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
                  <Cloud size={13} style={{ color: 'var(--color-accent)' }} />云端连接状态
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                    <div className="text-lg font-bold">{cloud.connected ? '已连接' : cloud.connecting ? '连接中' : '重连中'}</div>
                    <div className="mt-1 text-[11px]" style={mutedStyle}>云端通道</div>
                  </div>
                  <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                    <div className="text-lg font-bold">{cloud.injector ? '就绪' : '等待'}</div>
                    <div className="mt-1 text-[11px]" style={mutedStyle}>输入注入</div>
                  </div>
                  <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                    <div className="text-lg font-bold">{cloud.connected ? '在线' : '—'}</div>
                    <div className="mt-1 text-[11px]" style={mutedStyle}>手机接入</div>
                  </div>
                </div>
                {cloud.lastError && <div className="mt-3 text-[11px]" style={{ color: '#c97b74' }}>最近错误：{cloud.lastError}</div>}
              </section>

              <section className="rounded-xl p-4" style={cardStyle}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold"><QrCode size={13} />手机接入（扫码直达）</div>
                <div className="flex items-start gap-4">
                  {qrDataUrl ? (
                    <div className="shrink-0 rounded-lg p-2" style={{ background: '#ffffff' }}>
                      <img src={qrDataUrl} alt="手机扫码打开云控制页" width={150} height={150} />
                      <div className="mt-1 text-center text-[10px]" style={{ color: '#57534e' }}>扫码打开云控制页</div>
                    </div>
                  ) : <div className="flex h-[150px] w-[150px] items-center justify-center rounded-lg text-xs" style={{ background: 'var(--color-bg-card-hover)' }}>…</div>}
                  <div className="min-w-0 flex-1 text-[11px] leading-5" style={mutedStyle}>
                    手机打开 <b>shortcut.326415.xyz/mobile</b> → 「电脑控制」→「云端连接」，或直接扫左侧二维码。<br /><br />
                    连接使用 ShortCut 绑定身份自动配对，<b>无需输入连接码</b>。启动后保持本窗口开启即可；点击「停止」断开。
                  </div>
                </div>
              </section>
            </>
          )}

          {/* ===== 局域网模式状态 ===== */}
          {mode === 'lan' && lan && (
            <>
              <section className="rounded-xl p-4" style={cardStyle}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
                  <span className="h-2 w-2 rounded-full" style={{ background: '#63b582' }} />局域网服务状态
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                    <div className="text-lg font-bold">运行中</div>
                    <div className="mt-1 text-[11px]" style={mutedStyle}>端口 {lan.port}</div>
                  </div>
                  <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                    <div className="text-lg font-bold">{lan.injector ? '就绪' : '等待'}</div>
                    <div className="mt-1 text-[11px]" style={mutedStyle}>输入注入</div>
                  </div>
                  <div className="rounded-lg py-3" style={{ background: 'var(--color-bg-card-hover)' }}>
                    <div className="text-lg font-bold">{lan.clients ?? '—'}</div>
                    <div className="mt-1 text-[11px]" style={mutedStyle}>已连接手机</div>
                  </div>
                </div>
              </section>

              {lan.pairCode && (
                <section className="rounded-xl p-4" style={cardStyle}>
                  <div className="mb-2 text-xs font-semibold">绑定码</div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 text-center text-3xl font-bold tracking-[0.35em]" style={{ fontFamily: 'ui-monospace, Consolas, monospace', color: 'var(--color-accent)' }}>{lan.pairCode}</div>
                    <button type="button" onClick={() => void copy(lan.pairCode || '', '绑定码已复制')} title="复制绑定码" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--color-bg-card-hover)' }}><Copy size={14} /></button>
                  </div>
                </section>
              )}

              <section className="rounded-xl p-4" style={cardStyle}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold"><QrCode size={13} />手机接入（需与电脑同一网络）</div>
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    {(lan.urls?.length ? lan.urls : []).map((url) => (
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
                    {!lan.urls?.length && <div className="py-2 text-xs" style={mutedStyle}>未检测到局域网地址</div>}
                    <div className="text-[11px] leading-5" style={mutedStyle}>
                      手机浏览器打开上方地址（或扫码）→ 输入绑定码 → 即可用手机控制电脑。
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
            </>
          )}

          {/* ===== 安全提示 ===== */}
          {mode !== 'none' && (
            <section className="flex items-start gap-2 rounded-xl p-4 text-[11px] leading-5" style={{ background: 'rgba(179,86,78,.08)', border: '1px solid rgba(179,86,78,.25)', ...mutedStyle }}>
              <ShieldAlert size={15} className="mt-0.5 shrink-0" style={{ color: '#c97b74' }} />
              <span>连接使用 ShortCut 绑定身份加密配对，云端只转发加密通道数据、不存储输入内容。离开时点击「停止」关闭服务——任何能通过你绑定身份的人都能操作电脑，请注意账号安全。</span>
            </section>
          )}

          {/* ===== 未运行说明 ===== */}
          {mode === 'none' && (
            <section className="flex flex-col items-center justify-center rounded-xl py-8 text-center" style={{ background: 'var(--color-bg-card)', border: '1px dashed var(--color-border)' }}>
              <MonitorSmartphone size={30} strokeWidth={1.4} style={mutedStyle} />
              <div className="mt-3 text-sm">把手机变成电脑的远程输入面板</div>
              <div className="mt-1 max-w-sm text-xs leading-5" style={mutedStyle}>
                选择上方任一连接方式启动服务：手机向电脑缓冲打字、触控板鼠标、横屏虚拟键盘、电脑粘贴板。
              </div>
              <button type="button" onClick={() => void refresh()} className="mt-3 flex items-center gap-1 text-[11px]" style={mutedStyle}><RotateCcw size={11} />刷新状态</button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
