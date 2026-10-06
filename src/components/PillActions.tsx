import React from 'react';

/**
 * 可复用椭圆（胶囊）按钮组。
 * 需求：docs/island-drop-convert-rework.md §2.3 / 三.3 —— 后续文件类型变多时按钮数量不一致，
 * 所以组件只接收数据描述，自己负责换行、禁用、下拉变体与点击回调。
 */

export interface PillSelectOption {
  value: string;
  label: string;
}

export interface PillItem {
  /** 唯一 key（也用于 title） */
  key: string;
  label: string;
  /** 视觉优先级：default=普通，primary=强调，ghost=次要（取消） */
  tone?: 'default' | 'primary' | 'ghost';
  disabled?: boolean;
  /** 带下拉的变体（例如「转为 PNG ▾」）：当前值 + 选项 */
  select?: {
    value: string;
    options: PillSelectOption[];
    onChange: (value: string) => void;
    /** 下拉宽度（胶囊内） */
    width?: number;
  };
  onClick?: () => void;
}

export interface PillActionsProps {
  items: PillItem[];
  /** 换行（岛窗口窄，默认允许换行） */
  wrap?: boolean;
  className?: string;
}

export default function PillActions({ items, wrap = true, className = '' }: PillActionsProps) {
  if (!items.length) return null;
  return (
    <div className={['pill-actions', wrap ? 'wrap' : '', className].join(' ')}>
      {items.map((item) => {
        const tone = item.tone || 'default';
        if (item.select) {
          return (
            <span
              key={item.key}
              className={['pill', tone, item.disabled ? 'disabled' : '', 'has-select'].join(' ')}
              title={item.label}
            >
              <button
                type="button"
                className="pill-main"
                disabled={item.disabled}
                onClick={item.onClick}
              >
                {item.label}
              </button>
              <select
                className="pill-select"
                disabled={item.disabled}
                value={item.select.value}
                style={item.select.width ? { width: item.select.width } : undefined}
                onChange={(e) => item.select!.onChange(e.target.value)}
              >
                {item.select.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </span>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            className={['pill', tone, item.disabled ? 'disabled' : ''].join(' ')}
            disabled={item.disabled}
            title={item.label}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
