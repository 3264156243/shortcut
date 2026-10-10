import { useCallback, useEffect, useId, useState } from 'react';
import { Battery, BatteryCharging, CircleGauge, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { CockpitData } from '../types';

const missing = '未获取到数据';

/** 驾驶舱提权状态（对应 Rust 侧 cockpitElevationStatus） */
interface ElevationStatus {
  success: boolean;
  selfElevated?: boolean;
  taskName?: string;
  taskExists?: boolean;
  taskExeMatches?: boolean;
  taskExe?: string;
  sidecarPath?: string;
  mode?: string;
  tempsAvailable?: boolean;
}
const format = (value: number | null | undefined, unit: string) => typeof value === 'number' ? `${value.toFixed(1)}${unit}` : missing;
const point = (radius: number, degree: number) => {
  const angle = (degree - 90) * Math.PI / 180;
  return { x: 100 + radius * Math.cos(angle), y: 100 + radius * Math.sin(angle) };
};

function Dial({ label, name, temperature, usage, color, small = false }: {
  label: string; name?: string; temperature?: number | null; usage?: number | null; color: string; small?: boolean;
}) {
  const clip = useId().replace(/:/g, '');
  const level = Math.max(0, Math.min(100, usage ?? 0));
  const waterY = 150 - level * 0.82;
  return <section className={`flex min-w-0 flex-col items-center ${small ? 'max-w-[170px]' : 'max-w-[310px]'}`}>
    <svg viewBox="0 0 200 200" className="aspect-square w-full" aria-label={`${label} 仪表盘`}>
      <circle cx="100" cy="100" r="91" fill="#11151a" stroke="#313740" strokeWidth="2" />
      <circle cx="100" cy="100" r="85" fill="none" stroke="#20262d" strokeWidth="8" />
      {Array.from({ length: 25 }, (_, i) => {
        const degree = 225 + i * 11.25;
        const outer = point(82, degree);
        const inner = point(i % 4 ? 73 : 69, degree);
        const threshold = i * 5;
        const active = typeof temperature === 'number' && temperature >= threshold;
        const stroke = active ? (threshold >= 90 ? '#ef5350' : threshold >= 65 ? '#ffb74d' : color) : '#3b4048';
        return <line key={degree} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={stroke} strokeWidth={i % 4 ? 1.5 : 3} strokeLinecap="round" />;
      })}
      {[0, 30, 60, 90, 120].map((item, i) => {
        const p = point(61, 225 + i * 67.5);
        return <text key={item} x={p.x} y={p.y + 3} textAnchor="middle" fill="#8c949e" fontSize="7">{item}</text>;
      })}
      <defs><clipPath id={clip}><circle cx="100" cy="107" r="45" /></clipPath></defs>
      <circle cx="100" cy="107" r="47" fill="#090c0f" stroke="#3b424b" strokeWidth="2" />
      <g clipPath={`url(#${clip})`}><rect x="54" y={waterY} width="92" height={160 - waterY} fill={color} opacity=".78" /><path d={`M52 ${waterY} Q68 ${waterY - 4} 84 ${waterY} T116 ${waterY} T148 ${waterY}`} fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="2" /></g>
      <text x="100" y="94" textAnchor="middle" fill="#f4f6f8" fontSize={small ? 13 : 15} fontWeight="700">{typeof usage === 'number' ? `${usage.toFixed(1)}%` : '--'}</text>
      <text x="100" y="111" textAnchor="middle" fill="#9ca4ad" fontSize="7">使用率</text>
      <text x="100" y="132" textAnchor="middle" fill={typeof temperature === 'number' ? '#f4f6f8' : '#69717b'} fontSize="8">{format(temperature, '°C')}</text>
      <text x="100" y="177" textAnchor="middle" fill={color} fontSize="11" fontWeight="700">{label}</text>
    </svg>
    <p className="mt-1 max-w-full truncate text-center text-xs text-zinc-400" title={name || missing}>{name || missing}</p>
  </section>;
}

const BatteryValue = ({ label, value }: { label: string; value: string }) =>
  <div className="min-w-0"><div className="text-[11px] text-zinc-500">{label}</div><div className="mt-1 truncate text-sm font-semibold text-zinc-200" title={value}>{value}</div></div>;

export default function CockpitPanel() {
  const [data, setData] = useState<CockpitData | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<ElevationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupMsg, setSetupMsg] = useState('');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.startCockpit || !api.onCockpitData) { setError('硬件监控组件不可用'); return; }
    const off = api.onCockpitData((value) => {
      const next = value as CockpitData;
      if (next.error) setError(next.error); else { setError(''); setData(next); }
    });
    api.startCockpit().then((result) => { if (!result.success) setError(result.error || '硬件监控启动失败'); });
    return () => { off(); void api.stopCockpit?.(); };
  }, []);

  const refreshStatus = useCallback(async () => {
    const result = await window.electronAPI?.cockpitElevationStatus?.();
    if (result?.success) setStatus(result as ElevationStatus);
  }, []);

  // 温度要等侧车连上管道后才有值，所以状态轮询要跟着数据一起刷新
  useEffect(() => { void refreshStatus(); }, [refreshStatus, data?.timestamp]);

  const setup = useCallback(async () => {
    setBusy(true);
    setSetupMsg('');
    try {
      const result = await window.electronAPI?.cockpitSetupElevation?.();
      setSetupMsg(result?.success ? '已授权，正在切换到温度通道…' : (result?.error || '授权失败'));
      // 切换需要 1~2 秒（建管道 → 拉任务 → 首帧数据）
      setTimeout(() => { void refreshStatus(); }, 2500);
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  const battery = data?.battery;
  const level = typeof battery?.level === 'number' ? Math.max(0, Math.min(100, battery.level)) : 0;
  const updated = data?.timestamp ? new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--';
  const metricMissing = !data || ['cpu', 'gpu', 'memory'].some((key) => (data as any)?.[key]?.usage == null);
  const tempMissing = !data || ['cpu', 'gpu', 'memory'].some((key) => (data as any)?.[key]?.temperature == null);
  const authorized = status?.taskExists === true && status?.taskExeMatches === true;
  const selfElevated = status?.selfElevated === true;
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#0b0e12] px-5 pb-5 pt-3 text-zinc-100">
    <header className="flex shrink-0 items-center justify-between border-b border-white/10 pb-3">
      <div className="flex items-center gap-3"><CircleGauge size={20} className="text-orange-400" /><div><h1 className="text-sm font-semibold">电脑驾驶舱</h1><p className="mt-0.5 text-[11px] text-zinc-500">实时硬件状态</p></div></div>
      <div className="flex items-center gap-2 text-xs text-zinc-500"><span className={`h-2 w-2 rounded-full ${error ? 'bg-red-500' : data ? 'bg-emerald-400' : 'bg-amber-400'}`} />{error || (data ? `更新于 ${updated}` : '正在连接传感器')}</div>
    </header>
    {metricMissing ? (
      <div className="mt-3 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.12)', color: '#fca5a5' }}>
        <ShieldAlert size={14} />
        <span>未获取到数据，硬件监控组件可能未启动</span>
      </div>
    ) : null}
    {selfElevated ? (
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.12)', color: '#fca5a5' }}>
        <ShieldAlert size={14} />
        <span>当前以管理员权限运行：Windows 限制下，从资源管理器拖入的文件（SC 球 / 转换面板）会失效。建议改用普通权限启动 —— 温度改为「一次授权」即可拿到，不必整体提权。</span>
      </div>
    ) : null}
    {tempMissing && !selfElevated ? (
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(245,158,11,.35)', background: 'rgba(245,158,11,.12)', color: '#fbbf24' }}>
        {authorized ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
        <span className="flex-1">
          {authorized
            ? '已授权，正在等待温度数据…'
            : 'CPU 温度 / 内存温度需要读取 ring0 传感器（需管理员）。授权只影响这一个读取温度的独立进程：主程序仍以普通权限运行，文件拖放等功能完全不受影响。'}
        </span>
        {authorized ? null : (
          <button type="button" onClick={() => void setup()} disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/15 px-2 py-1 font-medium text-amber-200 transition hover:bg-amber-400/25 disabled:opacity-60">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
            {busy ? '等待系统授权…' : '一次授权并启用温度'}
          </button>
        )}
      </div>
    ) : null}
    {setupMsg ? <p className="mt-2 shrink-0 text-[11px] text-zinc-400">{setupMsg}</p> : null}
    <div className="grid min-h-[310px] flex-1 grid-cols-2 items-center justify-items-center gap-3 py-2 md:grid-cols-[minmax(180px,1fr)_minmax(120px,170px)_minmax(180px,1fr)]">
      <Dial label="CPU" name={data?.cpu?.name} temperature={data?.cpu?.temperature} usage={data?.cpu?.usage} color="#29b6f6" />
      <div className="col-span-2 row-start-1 max-w-[150px] self-start pt-3 md:col-span-1 md:col-start-2 md:max-w-none"><Dial small label="内存" name={data?.memory?.name} temperature={data?.memory?.temperature} usage={data?.memory?.usage} color="#ffb74d" /></div>
      <Dial label="GPU" name={data?.gpu?.name} temperature={data?.gpu?.temperature} usage={data?.gpu?.usage} color="#ef5350" />
    </div>
    <section className="shrink-0 border-t border-white/10 pt-4">
      <div className="mb-3 flex items-center gap-2"><BatteryCharging size={17} className="text-emerald-400" /><h2 className="text-xs font-semibold text-zinc-300">电池系统</h2></div>
      <div className="grid grid-cols-2 items-center gap-4 md:grid-cols-[minmax(180px,1.5fr)_repeat(3,minmax(90px,1fr))] md:gap-5">
        <div className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1"><Battery size={25} className="shrink-0 text-emerald-400" /><div className="min-w-0 flex-1"><div className="mb-1.5 flex justify-between text-xs"><span className="text-zinc-500">剩余电量</span><span className="font-semibold text-zinc-200">{format(battery?.level, '%')}</span></div><div className="h-2 overflow-hidden rounded bg-zinc-800"><div className="h-full rounded bg-emerald-400 transition-[width] duration-500" style={{ width: `${level}%` }} /></div></div></div>
        <BatteryValue label="状态" value={battery?.status || missing} /><BatteryValue label="电压" value={format(battery?.voltage, ' V')} /><BatteryValue label="健康值" value={format(battery?.health, '%')} />
      </div>
    </section>
  </div>;
}
