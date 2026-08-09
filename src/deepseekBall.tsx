import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './deepseekBall.css';

function DeepseekBall() {
  const [balance, setBalance] = useState<string>('?');
  const [style, setStyle] = useState('capsule');

  useEffect(() => {
    void window.electronAPI?.readConfig?.().then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        setStyle(parsed?.island?.style || 'capsule');
      } catch {}
    });
    const fetchBalance = () => {
      void window.electronAPI?.getDeepseekBalance?.().then((data: unknown) => {
        const value = data as { balance?: number | null; configured?: boolean; error?: string };
        if (value && value.balance != null) {
          setBalance(String(Math.round(Number(value.balance))));
        } else if (value?.configured === false || value?.error) {
          setBalance('未配置');
        } else {
          setBalance('?');
        }
      });
    };
    fetchBalance();
    const timer = window.setInterval(fetchBalance, 60000);
    const hide = window.electronAPI?.onDeepseekMerge?.(() => {
      document.querySelector('.deepseek-ball-root')?.classList.add('merge');
    });
    return () => {
      window.clearInterval(timer);
      hide?.();
    };
  }, []);

  const openPlatform = () => {
    void window.electronAPI?.openDeepseekPlatform?.();
  };

  return (
    <div className={['deepseek-ball-root', style, 'expand'].join(' ')} onClick={openPlatform} title="打开 DeepSeek 平台">
      {balance}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<DeepseekBall />);
