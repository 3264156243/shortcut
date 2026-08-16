import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './deepseekBall.css';
import type { BalanceData, BalanceProvider } from './types';

function DeepseekBall() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [provider, setProvider] = useState<BalanceProvider>('none');
  const [style, setStyle] = useState('capsule');

  useEffect(() => {
    void window.electronAPI?.readConfig?.().then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const island = parsed?.island || {};
        setStyle(island.style || 'capsule');
        setProvider(
          island.balanceProvider === 'deepseek' || island.balanceProvider === 'opencode'
            ? island.balanceProvider
            : island.deepseekEnabled === true ? 'deepseek' : 'none'
        );
      } catch {}
    });
    const fetchBalance = () => {
      void window.electronAPI?.getBalanceData?.().then((value: unknown) => {
        if (value) setData(value as BalanceData);
      });
    };
    fetchBalance();
    const timer = window.setInterval(fetchBalance, 60000);
    const hide = window.electronAPI?.onBalanceMerge?.(() => {
      document.querySelector('.deepseek-ball-root')?.classList.add('merge');
    });
    return () => {
      window.clearInterval(timer);
      hide?.();
    };
  }, []);

  const openPlatform = () => {
    void window.electronAPI?.openBalancePlatform?.(provider);
  };

  const rollingPercent = data && data.provider === 'opencode' ? data.rolling?.percent : undefined;
  const balanceText = data && data.provider === 'deepseek' && data.balance != null
    ? String(Math.round(Number(data.balance)))
    : data && data.provider === 'deepseek' && (data.configured === false || data.error)
      ? '未配置'
      : '?';
  const radius = 17;
  const stroke = 4;
  const circumference = 2 * Math.PI * radius;
  const raw = Number(rollingPercent);
  const percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  const offset = circumference * (1 - percent / 100);

  return (
    <div
      className={['deepseek-ball-root', style, 'expand'].join(' ')}
      onClick={openPlatform}
      title={provider === 'opencode' ? 'OpenCode Go 5小时用量' : '打开 DeepSeek 平台'}
    >
      {provider === 'opencode' ? (
        <svg className="deepseek-ball-ring" width="38" height="38" viewBox="0 0 38 38">
          <circle className="deepseek-ball-ring-track" cx="19" cy="19" r={radius} fill="none" strokeWidth={stroke} />
          <circle
            className="deepseek-ball-ring-fill"
            cx="19"
            cy="19"
            r={radius}
            fill="none"
            stroke="#22d3ee"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 19 19)"
          />
        </svg>
      ) : null}
      <span className="deepseek-ball-value">{provider === 'opencode' ? (Number.isFinite(raw) ? `${Math.round(raw)}%` : '?') : balanceText}</span>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<DeepseekBall />);
