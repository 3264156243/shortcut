import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useStore } from '../store';
import { MODULE_REGISTRY, getAvailableModuleIds } from '../moduleRegistry';
import type { ActivationPolicy } from '../types';

interface LicenseState {
  code?: string;
  status?: string;
  plan?: string | null;
  tier?: string;
  expiresAt?: string;
  activationPolicy?: ActivationPolicy;
  guestEnabled?: boolean;
  contactLine?: string;
  message?: string;
  machineCode?: string;
}

const POLICY_TEXT: Record<string, string> = {
  none: '无需激活，全部板块开放',
  premium_only: '需要激活；未激活用户可先使用开放的板块（游客模式）',
  all: '必须激活后才能使用',
};

export default function ActivationPanel() {
  const licenseModuleAccess = useStore((s) => s.licenseModuleAccess);
  const licensePolicy = useStore((s) => s.licensePolicy);
  const config = useStore((s) => s.config);
  const [state, setState] = useState<LicenseState | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const gate = await window.electronAPI?.getLicenseGate?.();
      const raw = await window.electronAPI?.getLicenseState?.();
      setState({ ...(raw || {}), ...(gate || {}) });
      const storedCode = (raw as any)?.code || '';
      setCode(storedCode ? storedCode : code);
      setError('');
    } catch {
      setError('无法读取激活信息');
    }
  };

  useEffect(() => {
    void load();
    const unsub = window.electronAPI?.onLicenseChanged?.(() => {
      void load();
    });
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activate = async (targetCode?: string) => {
    const value = (targetCode ?? code).trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI?.activateLicense(value);
      if (result && (result as any).success) {
        setCode(value);
        await load();
      } else {
        setError((result as any)?.message || '激活失败，请检查激活码');
      }
    } catch {
      setError('无法连接激活服务器，请检查网络');
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    setError('');
    try {
      const result = await window.electronAPI?.checkLicense?.();
      if (result && (result as any).message) {
        setError('');
      }
      await load();
    } catch {
      setError('无法连接激活服务器，请检查网络');
    } finally {
      setChecking(false);
    }
  };

  const activated = state?.status === 'active' || !!(state?.code && state?.status === 'active');
  const availableIds = getAvailableModuleIds(config).filter((id) => licenseModuleAccess[id] !== false);
  const visibleModules = availableIds
    .map((id) => MODULE_REGISTRY.find((meta) => meta.id === id))
    .filter((meta): meta is NonNullable<typeof meta> => !!meta);
  const moduleLabels = visibleModules.map((meta) => meta.label).join('、');

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div style={cardStyle}>
        <div className="mb-1 flex items-center gap-2">
          <KeyRound size={16} style={{ color: 'var(--color-accent)' }} />
          <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>激活状态</h3>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>是否已激活</span>
            <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: activated ? '#63d391' : '#fb923c' }}>
              {activated ? <CheckCircle2 size={15} /> : <ShieldCheck size={15} />}
              {activated ? '已激活' : '未激活'}
            </span>
          </div>
          {state?.tier ? (
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>授权档位</span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{state.tier}</span>
            </div>
          ) : null}
          {activated && state?.expiresAt ? (
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>有效期至</span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{state.expiresAt}</span>
            </div>
          ) : null}
          {state?.machineCode ? (
            <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)' }}>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>本机机器码</div>
              <div className="mt-1 break-all font-mono text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{state.machineCode}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={cardStyle}>
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>当前权限策略</h3>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {POLICY_TEXT[state?.activationPolicy || licensePolicy] || state?.activationPolicy || licensePolicy}
        </p>
        <div className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          当前可用板块：{moduleLabels || '（无）'}
        </div>
      </div>

      <div style={cardStyle}>
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>激活码</h3>
        <div className="mt-2 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void activate(); }}
            placeholder="请输入激活码"
            className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none transition-all duration-150"
            style={{
              background: 'var(--color-bg-card-hover)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void activate()}
            className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : '激活'}
          </button>
          <button
            type="button"
            disabled={checking}
            onClick={() => void recheck()}
            className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
            重新检测
          </button>
        </div>
        {error && <div className="mt-2 text-xs" style={{ color: '#ef4444' }}>{error}</div>}
        {state?.message && !error && (
          <div className="mt-2 text-xs" style={{ color: state?.status === 'active' ? '#63d391' : 'var(--color-text-muted)' }}>{state.message}</div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <ShieldCheck size={14} />
        {state?.contactLine || '激活码请联系管理员获取'}
      </div>
    </div>
  );
}