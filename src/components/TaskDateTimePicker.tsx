import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3 } from 'lucide-react';

interface TaskDateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
}

const pad = (value: number) => String(value).padStart(2, '0');

const formatLocalValue = (date: Date) => [
  date.getFullYear(),
  '-',
  pad(date.getMonth() + 1),
  '-',
  pad(date.getDate()),
  'T',
  pad(date.getHours()),
  ':',
  pad(date.getMinutes()),
].join('');

const parseLocalValue = (value: string) => {
  if (!value) return null;
  const [datePart, timePart = '00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const createDefaultReminderValue = () => {
  const date = new Date();
  date.setSeconds(0, 0);
  const minutesToNextHalfHour = 30 - (date.getMinutes() % 30);
  date.setMinutes(date.getMinutes() + minutesToNextHalfHour);
  return formatLocalValue(date);
};

const sameDay = (left: Date, right: Date) => (
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate()
);

export default function TaskDateTimePicker({ value, onChange }: TaskDateTimePickerProps) {
  const selected = useMemo(() => parseLocalValue(value), [value]);
  const initial = selected || parseLocalValue(createDefaultReminderValue()) || new Date();
  const [viewMonth, setViewMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const today = new Date();

  useEffect(() => {
    if (selected) {
      setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    }
  }, [selected?.getFullYear(), selected?.getMonth()]);

  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const leadingBlanks = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = index - leadingBlanks + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });

  const updateDate = (nextDate: Date) => {
    nextDate.setSeconds(0, 0);
    onChange(formatLocalValue(nextDate));
  };

  const chooseDay = (day: number) => {
    const base = selected ? new Date(selected) : parseLocalValue(createDefaultReminderValue()) || new Date();
    base.setFullYear(viewMonth.getFullYear(), viewMonth.getMonth(), day);
    updateDate(base);
  };

  const adjustTime = (unit: 'hour' | 'minute', amount: number) => {
    const base = selected ? new Date(selected) : parseLocalValue(createDefaultReminderValue()) || new Date();
    if (unit === 'hour') {
      base.setHours(base.getHours() + amount);
    } else {
      base.setMinutes(base.getMinutes() + amount);
    }
    updateDate(base);
  };

  const changeTimePart = (unit: 'hour' | 'minute', raw: string) => {
    const base = selected ? new Date(selected) : parseLocalValue(createDefaultReminderValue()) || new Date();
    const number = parseInt(raw, 10);
    if (!Number.isFinite(number)) return;
    if (unit === 'hour') {
      base.setHours(Math.max(0, Math.min(23, number)));
    } else {
      base.setMinutes(Math.max(0, Math.min(59, number)));
    }
    updateDate(base);
  };

  const chooseTomorrowMorning = () => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    updateDate(date);
  };

  const chooseTonight = () => {
    const date = new Date();
    date.setHours(20, 0, 0, 0);
    if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
    updateDate(date);
  };

  const moveMonth = (offset: number) => {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const monthLabel = String(viewMonth.getFullYear()) + '年' + String(viewMonth.getMonth() + 1) + '月';
  const selectedLabel = selected
    ? selected.toLocaleString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : '请选择提醒时间';

  return (
    <div
      className="overflow-hidden border md:grid md:grid-cols-[minmax(0,1fr)_184px]"
      style={{ borderColor: '#cfc2ae', background: '#fffdf8', boxShadow: '0 8px 24px rgba(44,36,22,.08)' }}
    >
      <section className="min-w-0 p-4">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => moveMonth(-1)}
            className="flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-[#eee5d8]"
            style={{ color: '#665845' }}
            title="上个月"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#2c2416' }}>
            <CalendarDays size={15} style={{ color: '#9b2335' }} />
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={() => moveMonth(1)}
            className="flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-[#eee5d8]"
            style={{ color: '#665845' }}
            title="下个月"
          >
            <ChevronRight size={17} />
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 text-center text-[11px]" style={{ color: '#8a7d69' }}>
          {['一', '二', '三', '四', '五', '六', '日'].map((weekday) => (
            <div key={weekday} className="py-1">{weekday}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) => {
            if (!day) return <div key={'blank-' + String(index)} className="aspect-square" />;
            const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
            const active = !!selected && sameDay(selected, date);
            const currentDay = sameDay(today, date);
            return (
              <button
                key={day}
                type="button"
                onClick={() => chooseDay(day)}
                className="aspect-square rounded text-xs font-medium transition-all duration-150 hover:bg-[#eadfce]"
                style={{
                  background: active ? '#9b2335' : 'transparent',
                  color: active ? '#fffaf1' : '#3c3225',
                  boxShadow: currentDay && !active ? 'inset 0 0 0 1px #52735d' : 'none',
                }}
                aria-label={String(viewMonth.getMonth() + 1) + '月' + String(day) + '日'}
              >
                {day}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col justify-between p-4" style={{ background: '#29231f', color: '#f5f0e8' }}>
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs uppercase" style={{ color: '#c8bba8' }}>
            <Clock3 size={14} />
            提醒时间
          </div>
          <div className="mb-5 min-h-10 text-sm leading-relaxed" style={{ color: '#fff8ed' }}>{selectedLabel}</div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => adjustTime('hour', 1)}
                className="flex h-7 w-10 items-center justify-center rounded hover:bg-white/10"
                title="小时增加"
              >
                <ChevronUp size={16} />
              </button>
              <input
                type="number"
                min={0}
                max={23}
                value={pad(selected?.getHours() ?? initial.getHours())}
                onChange={(e) => changeTimePart('hour', e.target.value)}
                className="w-14 py-1 text-center text-2xl font-semibold tabular-nums outline-none"
                style={{ background: 'rgba(245,240,232,.08)', border: '1px solid rgba(245,240,232,.2)', borderRadius: 8, color: '#f5f0e8' }}
              />
              <button
                type="button"
                onClick={() => adjustTime('hour', -1)}
                className="flex h-7 w-10 items-center justify-center rounded hover:bg-white/10"
                title="小时减少"
              >
                <ChevronDown size={16} />
              </button>
            </div>
            <span className="text-xl" style={{ color: '#a98f68' }}>:</span>
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => adjustTime('minute', 1)}
                className="flex h-7 w-10 items-center justify-center rounded hover:bg-white/10"
                title="分钟增加"
              >
                <ChevronUp size={16} />
              </button>
              <input
                type="number"
                min={0}
                max={59}
                step={1}
                value={pad(selected?.getMinutes() ?? initial.getMinutes())}
                onChange={(e) => changeTimePart('minute', e.target.value)}
                className="w-14 py-1 text-center text-2xl font-semibold tabular-nums outline-none"
                style={{ background: 'rgba(245,240,232,.08)', border: '1px solid rgba(245,240,232,.2)', borderRadius: 8, color: '#f5f0e8' }}
              />
              <button
                type="button"
                onClick={() => adjustTime('minute', -1)}
                className="flex h-7 w-10 items-center justify-center rounded hover:bg-white/10"
                title="分钟减少"
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={chooseTonight}
            className="rounded border px-2 py-2 text-xs transition-colors hover:bg-white/10"
            style={{ borderColor: 'rgba(245,240,232,.2)', color: '#e8ddd0' }}
          >
            今晚 20:00
          </button>
          <button
            type="button"
            onClick={chooseTomorrowMorning}
            className="rounded border px-2 py-2 text-xs transition-colors hover:bg-white/10"
            style={{ borderColor: 'rgba(245,240,232,.2)', color: '#e8ddd0' }}
          >
            明早 09:00
          </button>
        </div>
      </section>
    </div>
  );
}
