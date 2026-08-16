import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
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
  moduleAccess?: Array<{ id: string; level?: string; allowed?: boolean }>;
  featureAccess?: Array<{ id: string; module?: string; label?: string; allowed?: boolean }>;
}

interface PolicyGroup {
  id: string;
  name: string;
  system?: boolean;
  enabled?: boolean;
  permissions: Record<string, boolean>;
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
  const [groups, setGroups] = useState<PolicyGroup[]>([]);
  const [moduleMeta, setModuleMeta] = useState<Record<string, string>>({});
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [trialUsed, setTrialUsed] = useState(false);
  const [trialActive, setTrialActive] = useState(false);
  const [trialExpiresAt, setTrialExpiresAt] = useState<string | null>(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const loadPolicy = async () => {
    try {
      const result = await window.electronAPI?.getLicensePolicy?.();
      if (result && (result as any).success) {
        const r = result as any;
        setGroups(r.groups || []);
        setModuleMeta(r.moduleMeta || {});
        setTrialEnabled(r.trialEnabled === true);
        setTrialUsed(r.trialUsed === true);
        setTrialActive(r.trialActive === true);
        setTrialExpiresAt(r.trialExpiresAt || null);
      }
    } catch {
      // 策略加载失败不阻塞激活
    }
  };

  const load = async () => {
    try {
      const gate = await window.electronAPI?.getLicenseGate?.();
      const raw = await window.electronAPI?.getLicenseState?.();
      const merged = { ...(raw || {}), ...(gate || {}) } as LicenseState;
      setState(merged);
      if (merged.code) setCode(merged.code);
      setError('');
    } catch {
      setError('无法读取激活信息');
    }
  };

  useEffect(() => {
    void load();
    void loadPolicy();
    const unsub = window.electronAPI?.onLicenseChanged?.(() => {
      void load();
      void loadPolicy();
    });
    const tick = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => {
      unsub?.();
      window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startTrial = async () => {
    if (trialBusy) return;
    setTrialBusy(true);
    setError('');
    try {
      const result = await window.electronAPI?.startTrial?.();
      const r = result as any;
      if (r && r.success) {
        if (r.code) setCode(r.code);
        await load();
        await loadPolicy();
      } else {
        setError(r?.message || '免费试用开启失败');
      }
    } catch {
      setError('无法连接激活服务器，请检查网络');
    } finally {
      setTrialBusy(false);
    }
  };

  const trialRemainMs = trialActive && trialExpiresAt ? new Date(trialExpiresAt).getTime() - nowTick : 0;
  const trialRemainMin = Math.max(0, Math.ceil(trialRemainMs / 60000));

  const activate = async (targetCode?: string) => {
    const value = (targetCode ?? code).trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI?.activateLicense(value);
      const r = result as any;
      if (r && r.success) {
        setCode(value);
        await load();
        await loadPolicy();
      } else {
        setError(r?.message || '激活失败，请检查激活码');
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
      await window.electronAPI?.checkLicense?.();
      await load();
      await loadPolicy();
    } catch {
      setError('无法连接激活服务器，请检查网络');
    } finally {
      setChecking(false);
    }
  };

  const activated = state?.status === 'active' && !!state?.code;
  const availableIds = getAvailableModuleIds(config).filter((id) => licenseModuleAccess[id] !== false);
  const visibleModules = availableIds
    .map((id) => MODULE_REGISTRY.find((meta) => meta.id === id))
    .filter((meta): meta is NonNullable<typeof meta> => !!meta);
  const moduleLabels = visibleModules.map((meta) => meta.label).join('、');
  const moduleLabel = (id: string) => moduleMeta[id] || MODULE_REGISTRY.find((meta) => meta.id === id)?.label || id;

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      {/* 激活状态 */}
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

      {/* 激活码填写 */}
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

        {/* 免费试用 */}
        {!activated && trialEnabled && (
          <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(124,58,237,.08)', border: '1px dashed rgba(124,58,237,.4)' }}>
            {trialActive && trialExpiresAt ? (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>免费试用进行中，剩余约 {trialRemainMin} 分钟</span>
                <span className="text-[11px] font-medium" style={{ color: '#a78bfa' }}>试用中</span>
              </div>
            ) : trialUsed ? (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>该设备已使用过免费试用</span>
                <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>已使用</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>每个设备有且仅有一次免费体验机会，绑定机器码</span>
                <button
                  type="button"
                  disabled={trialBusy}
                  onClick={() => void startTrial()}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-85 disabled:opacity-50"
                  style={{ background: 'var(--color-accent)', color: 'white' }}
                >
                  {trialBusy ? <Loader2 size={13} className="animate-spin" /> : '免费试用 10 分钟'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {POLICY_TEXT[state?.activationPolicy || licensePolicy] || state?.activationPolicy || licensePolicy}
        </div>
        <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          当前可用板块：{moduleLabels || '（无）'}
        </div>
      </div>

      {/* 权限策略：全部分组的板块权限（标签形式） */}
      <div style={cardStyle}>
        <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>权限策略</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>管理后台配置的分组板块权限</p>
        <div className="mt-2 flex flex-col gap-2.5">
          {groups.length === 0 && (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>策略加载中或未连接服务器...</div>
          )}
          {groups.map((group) => (
            <div key={group.id} className="rounded-xl px-3 py-2.5" style={{ background: 'var(--color-bg-card-hover)', border: '1px solid var(--color-border)', opacity: group.enabled === false ? 0.55 : 1 }}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{group.name}</span>
                {group.system && <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'rgba(251,146,60,.16)', color: '#fb923c' }}>游客</span>}
                {group.enabled === false && <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'rgba(239,68,68,.14)', color: '#ef4444' }}>已停用</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(moduleMeta).map((mid) => {
                  const allowed = group.permissions[mid] === true;
                  return (
                    <span
                      key={mid}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                      style={{
                        background: allowed ? 'rgba(99,211,145,.12)' : 'rgba(251,146,60,.1)',
                        border: `1px solid ${allowed ? 'rgba(99,211,145,.35)' : 'rgba(251,146,60,.3)'}`,
                        color: allowed ? '#63d391' : '#fb923c',
                      }}
                    >
                      {allowed ? <CheckCircle2 size={10} /> : <Lock size={9} />}
                      {moduleLabel(mid)}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <ShieldCheck size={14} />
        {state?.contactLine || '激活码请联系管理员获取'}
      </div>
    </div>
  );
}