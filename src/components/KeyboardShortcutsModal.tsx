import { Keyboard, X } from 'lucide-react';
import { useStore } from '../store';

const sections = [
  {
    title: '全局',
    items: [
      { keys: ['Alt', 'Space'], description: '显示或隐藏 ShortCut' },
      { keys: ['Alt', 'E'], description: '翻译当前选中的文字' },
      { keys: ['Alt', 'S'], description: '截取鼠标所在的整个屏幕到剪贴板' },
      { keys: ['Alt', 'D'], description: '进入区域截屏模式' },
      { keys: ['长按 Space 0.5 秒'], description: '循环切换快捷、任务、驾驶舱与翻译板块' },
      { keys: ['Z'], description: '切换到上一个板块' },
      { keys: ['X'], description: '切换到下一个板块' },
    ],
  },
  {
    title: 'SC球与音乐',
    items: [
      { keys: ['Alt', 'I'], description: '显示或隐藏 SC球' },
      { keys: ['Alt', 'Z'], description: '音乐上一首' },
      { keys: ['Alt', 'X'], description: '音乐播放或暂停' },
      { keys: ['Alt', 'C'], description: '音乐下一首' },
      { keys: ['Alt', 'U'], description: '显示或隐藏任务清单球' },
    ],
  },
  {
    title: '快捷板块',
    items: [
      { keys: ['Space'], description: '切换到下一个快捷页面' },
      { keys: ['双击 Space'], description: '聚焦搜索框' },
      { keys: ['Ctrl', 'K'], description: '聚焦搜索框' },
      { keys: ['↑', '↓', '←', '→'], description: '移动快捷方式选择光标，支持跨行循环' },
      { keys: ['W', 'A', 'S', 'D'], description: '非输入状态下映射为上下左右移动' },
      { keys: ['Enter'], description: '打开当前选中的快捷方式' },
      { keys: ['Esc'], description: '清空搜索或退出搜索框' },
    ],
  },
  {
    title: '翻译板块',
    items: [
      { keys: ['双击 Space'], description: '进入或退出原文输入模式' },
      { keys: ['Alt', 'E'], description: '在任意程序中翻译当前选中的文字' },
    ],
  },
  {
    title: '语音输入（胶囊）',
    items: [
      { keys: ['Alt', 'H'], description: '打开 / 关闭语音输入胶囊' },
      { keys: ['Space'], description: '暂停 / 继续识别' },
      { keys: ['Enter'], description: '确认：整理结构并输入到光标处' },
      { keys: ['Esc'], description: '取消，不输入' },
    ],
  },
  {
    title: '任务墙',
    items: [
      { keys: ['Space'], description: '切换到下一个任务墙' },
      { keys: ['双击 Space'], description: '聚焦底部任务输入栏' },
      { keys: ['1'], description: '开启或关闭长文本任务' },
      { keys: ['2'], description: '开启或关闭待办提醒' },
      { keys: ['Enter'], description: '提交任务或进入任务编辑' },
      { keys: ['Esc'], description: '关闭当前编辑弹窗' },
    ],
  },
];

export default function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const globalHotkey = useStore((state) => state.config.globalHotkey);
  const displaySections = sections.map((section) => section.title === '全局'
    ? { ...section, items: [{ keys: globalHotkey.split('+'), description: '显示或隐藏 ShortCut' }, ...section.items.slice(1)] }
    : section);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-5" style={{ background: 'var(--color-overlay)' }} onClick={onClose} data-keyboard-shortcuts-modal>
      <section className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', boxShadow: '0 24px 70px var(--color-shadow)' }} onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-md" style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}><Keyboard size={18} /></div>
          <div className="min-w-0 flex-1"><h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>快捷键</h2><p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>ShortCut 当前支持的键盘操作</p></div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md transition-opacity hover:opacity-75" title="关闭"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {displaySections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{section.title}</h3>
              <div className="overflow-hidden rounded-md" style={{ border: '1px solid var(--color-border)' }}>
                {section.items.map((item, index) => (
                  <div key={`${section.title}-${index}`} className="flex min-h-12 items-center justify-between gap-4 px-4 py-2.5" style={{ background: 'var(--color-bg-card)', borderTop: index ? '1px solid var(--color-border)' : 'none' }}>
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{item.description}</span>
                    <div className="flex shrink-0 items-center gap-1.5">{item.keys.map((key, keyIndex) => <span key={`${key}-${keyIndex}`} className="flex items-center gap-1.5">{keyIndex > 0 && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>+</span>}<kbd className="min-w-7 rounded border px-2 py-1 text-center text-xs font-medium shadow-sm" style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{key}</kbd></span>)}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
