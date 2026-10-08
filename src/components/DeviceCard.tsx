import { useCallback, useEffect, useState } from 'react';
import { Monitor, Smartphone, Trash2, RefreshCw, Pencil, Check, X, ShieldCheck } from 'lucide-react';

/**
 * 已绑定设备管理（身份层）。
 *
 * 为什么要有它：绑定只有二维码和绑定码时，用户既不知道"当前到底绑了哪几台设备"，
 * 也没法收拾 —— 一台旧手机丢了/换了，只能靠"重新绑定"把新的顶上去，而且旧设备在服务端
 * 仍留着凭证（原来的单槽模型下则是静默被覆写、旧手机直接 403 却毫无提示）。
 * 现在设备是一份列表，桌面端作为绑定建立方充当管理入口。
 *
 * 语义（与桌面端 Rust / 服务端 api.php 一致）：
 *   - 列表只显示设备标识/名称/端类型/绑定时间/最后活跃，**不含任何凭证**；
 *   - 「移除」只撤销该设备凭证（它下次请求即失效并自动跳回绑定页），
 *     **不清理**它提交过的任务/消息/文件 —— 那些数据按"绑定"归属，不按设备归属；
 *   - 本机（当前这台电脑）不可移除：移除它等于立刻失去设备管理能力。
 */

interface DeviceRow {
  deviceId: string;
  deviceName: string;
  side: string;
  boundAt: string;
  lastSeenAt: string;
  current?: boolean;
}

interface DeviceListResult {
  success?: boolean;
  message?: string;
  devices?: DeviceRow[];
  mobileCount?: number;
  mobileLimit?: number;
  selfDeviceId?: string;
}

/** 友好时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期 */
function friendlyTime(value: string): string {
  if (!value) return '未知';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '未知';
  const diff = Date.now() - at.getTime();
  if (diff < 0) return '刚刚';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

export default function DeviceCard() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [mobileCount, setMobileCount] = useState(0);
  const [mobileLimit, setMobileLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draftName, setDraftName] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setMessage('');
    void window.electronAPI?.syncListDevices?.()
      .then((r: unknown) => {
        const res = (r || {}) as DeviceListResult;
        if (res.success) {
          setDevices(Array.isArray(res.devices) ? res.devices : []);
          setMobileCount(res.mobileCount ?? 0);
          setMobileLimit(res.mobileLimit ?? 0);
        } else {
          setDevices(null);
          setMessage(res.message || '设备列表加载失败');
        }
      })
      .catch(() => {
        setDevices(null);
        setMessage('设备列表加载失败，请检查网络后刷新');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const doRemove = (deviceId: string) => {
    setBusyId(deviceId);
    setMessage('');
    void window.electronAPI?.syncRemoveDevice?.(deviceId)
      .then((r: unknown) => {
        const res = (r || {}) as DeviceListResult;
        if (res.success) {
          setDevices(Array.isArray(res.devices) ? res.devices : []);
          setMessage('已移除该设备，它需要重新绑定才能继续使用');
        } else {
          setMessage(res.message || '移除失败');
        }
      })
      .catch(() => setMessage('移除失败，请稍后再试'))
      .finally(() => { setBusyId(''); setConfirmId(''); });
  };

  const saveName = (deviceId: string) => {
    const name = draftName.trim();
    if (!name) { setEditingId(''); return; }
    setBusyId(deviceId);
    setMessage('');
    void window.electronAPI?.syncRenameDevice?.(deviceId, name)
      .then((r: unknown) => {
        const res = (r || {}) as { success?: boolean; deviceName?: string; message?: string };
        if (res.success) {
          const finalName = res.deviceName || name;
          setDevices((prev) => (prev || []).map((d) => (d.deviceId === deviceId ? { ...d, deviceName: finalName } : d)));
          setEditingId('');
        } else {
          setMessage(res.message || '改名失败');
        }
      })
      .catch(() => setMessage('改名失败，请稍后再试'))
      .finally(() => setBusyId(''));
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
  };
  const rowStyle: React.CSSProperties = {
    background: 'var(--color-bg-card-hover)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
  };
  const iconButtonStyle: React.CSSProperties = {
    background: 'var(--color-bg-card)',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border)',
  };

  return (
    <div style={cardStyle}>
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={15} style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>已绑定设备</span>
        {devices && devices.length > 0 && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: 'rgba(52, 211, 153, .14)', color: '#34d399' }}
          >
            {devices.length} 台
            {mobileLimit > 0 ? `（手机 ${mobileCount}/${mobileLimit}）` : ''}
          </span>
        )}
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-opacity hover:opacity-80 disabled:opacity-40"
          style={iconButtonStyle}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>
      <p className="text-[11px] leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
        这里是当前绑定下所有已授权的设备。移除后该设备立即失效，需要重新扫码绑定；已同步过的任务、消息和文件不受影响。
      </p>

      {message && (
        <div
          className="mb-2 rounded-lg px-2.5 py-1.5 text-[11px]"
          style={{ background: 'rgba(248, 113, 113, .12)', color: '#f87171' }}
        >
          {message}
        </div>
      )}

      {loading && !devices ? (
        <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>读取设备列表…</div>
      ) : devices && devices.length > 0 ? (
        <div className="flex flex-col gap-2">
          {devices.map((device) => {
            const isMobile = device.side === 'mobile';
            const isSelf = !!device.current;
            const isEditing = editingId === device.deviceId;
            const isConfirming = confirmId === device.deviceId;
            return (
              <div key={device.deviceId} style={rowStyle}>
                <div className="flex items-center gap-2">
                  {isMobile
                    ? <Smartphone size={14} style={{ color: 'var(--color-accent)' }} />
                    : <Monitor size={14} style={{ color: 'var(--color-accent)' }} />}

                  {isEditing ? (
                    <input
                      autoFocus
                      value={draftName}
                      maxLength={30}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveName(device.deviceId);
                        if (e.key === 'Escape') setEditingId('');
                      }}
                      className="min-w-0 flex-1 px-2 py-1 rounded-md text-xs outline-none"
                      style={{ background: 'var(--color-bg-card)', color: 'var(--color-text)', border: '1px solid var(--color-accent)' }}
                    />
                  ) : (
                    <span className="min-w-0 truncate text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                      {device.deviceName || (isMobile ? '我的手机' : '本机电脑')}
                    </span>
                  )}

                  <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-muted)' }}>
                    {isMobile ? '手机' : '电脑'}
                  </span>
                  {isSelf && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(52, 211, 153, .14)', color: '#34d399' }}>
                      本机
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveName(device.deviceId)}
                          disabled={busyId === device.deviceId}
                          className="p-1.5 rounded-lg hover:opacity-80 disabled:opacity-40"
                          style={{ color: '#34d399' }}
                          title="保存"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId('')}
                          className="p-1.5 rounded-lg hover:opacity-80"
                          style={{ color: 'var(--color-text-muted)' }}
                          title="取消"
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => { setEditingId(device.deviceId); setDraftName(device.deviceName || ''); setConfirmId(''); }}
                          className="p-1.5 rounded-lg hover:opacity-80"
                          style={{ color: 'var(--color-text-secondary)' }}
                          title="重命名"
                        >
                          <Pencil size={12} />
                        </button>
                        {isSelf ? (
                          <span className="px-1.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }} title="不能移除当前正在使用的设备">—</span>
                        ) : isConfirming ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => doRemove(device.deviceId)}
                              disabled={busyId === device.deviceId}
                              className="rounded-lg px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
                              style={{ background: '#f87171', color: 'white' }}
                            >
                              {busyId === device.deviceId ? '移除中…' : '确认移除'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId('')}
                              className="rounded-lg px-1.5 py-1 text-[10px]"
                              style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)' }}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmId(device.deviceId)}
                            className="p-1.5 rounded-lg hover:opacity-80"
                            style={{ color: '#f87171' }}
                            title="移除该设备"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  <span>绑定于 {friendlyTime(device.boundAt)}</span>
                  <span>最后活跃 {friendlyTime(device.lastSeenAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {devices ? '还没有其他设备绑定。用手机扫描上方二维码即可加入。' : '设备列表暂不可用，请点刷新重试'}
        </div>
      )}
    </div>
  );
}
