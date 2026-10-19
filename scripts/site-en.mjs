/**
 * 站点英文内容（供 scripts/gen-site-pages.mjs 生成 /en/ 页面）
 * ---------------------------------------------------------------------------
 * 原则：
 *   1. 英文页与中文页结构完全一致，只换文案 —— 保证维护时只需对齐 key
 *   2. 产品名、快捷键、命令、路径保持原样
 *   3. 历史版本条目保留中文原文（发布说明以中文记录），英文页明确说明这一点
 *   4. 缺项回退中文，不会出现空白页
 */

/* ── 各页面英文文案（key = 中文页面对应文件）──────────────────────────── */
export const EN_PAGES = {
  'features/shortcut.html': {
    title: 'Quick Launch — launch apps, folders and links with one key | ShortCut',
    desc: 'Keep frequently used apps, files, folders and links in one place and launch them with the keyboard. Automatic icon extraction, import installed apps, tabs and groups.',
    h1: 'Apps, folders and links,<br />one keystroke away',
    lead:
      'No more hunting for desktop icons or digging through the Start menu. Everything you need sits on one page — pick it with the arrow keys and press Enter. Icons are extracted from the programs themselves, or you can set your own.',
    crumb: 'Quick Launch',
    sectionTitle: 'Details',
    sectionDesc: 'From "add it" to "open it", with nothing in between.',
    caps: [
      ['bolt', 'Global hotkey', 'Alt+Space by default — the panel appears from any app, no need to go back to the desktop first.'],
      ['grid', 'Automatic icons', 'Icons are extracted from the program itself; you can also point to an icon file or let it fetch a site favicon.'],
      ['check', 'Import installed apps', 'Scan installed programs and add them in bulk instead of hunting for each path.'],
      ['sticky', 'Tabs and groups', 'Organise with tabs and groups, drag to reorder, move items across groups.'],
      ['send', 'Search and keyboard navigation', 'Search by name, path or note; arrow keys to select, Enter to launch — no mouse required.'],
      ['windows', 'Four entry types', 'Apps, folders, plain files and web URLs, plus shortcut groups and BAT scripts.']
    ],
    pagerPrev: null,
    pagerNext: { href: '/features/taskwall.html', label: 'Task Wall' }
  },

  'features/taskwall.html': {
    title: 'Task Wall — sticky notes for your to-dos | ShortCut',
    desc: 'A sticky-note task wall: multiple walls, long-form tasks, reminders. Pin a task from your phone and it shows up on the desktop, with two-way completion sync.',
    h1: 'Pin it on the wall,<br />and you will not forget it',
    lead:
      'Instead of building a dozen nested folders in a notes app, write the task on a sticky note and pin it to the wall. Reminders pop up through the SC ball; pin a task on your phone and it is already there when you sit back down.',
    crumb: 'Task Wall',
    sectionTitle: 'Details',
    sectionDesc: 'Lightweight, but nothing essential is missing.',
    caps: [
      ['sticky', 'Multiple walls', 'Work, personal and project walls stay separate, each with its own ordering.'],
      ['check', 'Long text and reminders', 'Notes can hold long content; to-do items can have a reminder time that pops up in the SC ball.'],
      ['clock', 'Reminder popups', 'Jump to the item or mark it done straight from the popup — no need to open the main panel.'],
      ['phone', 'Pin from your phone', 'Pin a task on mobile and it appears on the desktop immediately; offline desktops queue it and pick it up when back.'],
      ['send', 'Two-way completion', 'Tick it off on the desktop and it disappears from the phone, and vice versa.'],
      ['bolt', 'Task list ball', 'Push important tasks into the SC task-list ball so the remaining items stay in sight.']
    ],
    pagerPrev: { href: '/features/shortcut.html', label: 'Quick Launch' },
    pagerNext: { href: '/features/scball.html', label: 'SC Ball' }
  },

  'features/scball.html': {
    title: 'SC Ball — a tiny island living on your desktop | ShortCut',
    desc: 'SC Ball is a floating island for your desktop: collapsed, mini and expanded states; music cover and lyrics, task reminders, hardware stats and balance — all click-through so it never blocks your work.',
    h1: 'One little ball<br />holding music, tasks and system stats',
    lead:
      'Most of the time it is a slim pill that takes almost no space. Open it while listening to music and you get the cover, lyrics and playback controls. Turn on mouse click-through and it stops blocking desktop clicks entirely — use the hotkey to switch it back when you want to click it.',
    crumb: 'SC Ball',
    sectionTitle: 'Details',
    sectionDesc: 'It lives on your desktop, so every detail respects your attention.',
    caps: [
      ['island', 'Collapsed, mini, expanded', 'When collapsed the width follows the content; it keeps a fixed width while music plays so it does not jump around.'],
      ['send', 'Music cover and lyrics', 'Built-in NetEase Cloud Music bridge: cover, progress, word-by-word lyrics, long-line scrolling, and half-a-line lead time.'],
      ['check', 'Task reminder ball', 'Reminders pop up when a task is due; jump to it or mark it done in one click.'],
      ['bolt', 'Hardware stats and balance', 'CPU / GPU / memory usage and temperature at a glance; DeepSeek balance refreshes every minute and splits into a small side ball while music plays.'],
      ['shield', 'Click-through mode', 'Fully transparent to mouse input so it never blocks the desktop; still callable by hotkey. Alt+B toggles it.'],
      ['windows', 'Its own always-on-top window', 'Independent from the main panel: close the panel and the ball stays.']
    ],
    pagerPrev: { href: '/features/taskwall.html', label: 'Task Wall' },
    pagerNext: { href: '/features/control.html', label: 'Phone Control' }
  },

  'features/control.html': {
    title: 'Phone Control — use your phone as a keyboard and trackpad | ShortCut',
    desc: 'Control your computer from your phone: typing, trackpad, modifier combos and clipboard. Works over a relay on 4G, or directly over LAN for the lowest latency.',
    h1: 'Your phone as keyboard and trackpad,<br />controlling your computer',
    lead:
      'Pause the video on your PC without getting up: open the mobile page and you can type, move the cursor and press key combinations. Over 4G it goes through a cloud relay; on the same Wi-Fi it connects directly over LAN, where latency is almost unnoticeable.',
    crumb: 'Phone Control',
    sectionTitle: 'Details',
    sectionDesc: 'Two connection modes, picked by the situation.',
    caps: [
      ['cloud', 'Cloud relay (works on 4G)', 'Not on the same network: the phone and desktop connect securely and commands are relayed.'],
      ['bolt', 'Direct LAN connection', 'On the same Wi-Fi the phone talks directly to the desktop for the lowest latency.'],
      ['grid', 'Keyboard input', 'Chinese text, symbols and everything else your phone keyboard produces is injected into the focused window.'],
      ['phone', 'Trackpad and combos', 'Relative cursor movement, single and double clicks, one-tap modifier combinations.'],
      ['send', 'Clipboard transfer', 'Send text from your phone to the desktop clipboard, or read it back the other way.'],
      ['shield', 'Least privilege', 'You must enable the control service on the desktop and pair first; you can stop it at any time.']
    ],
    pagerPrev: { href: '/features/scball.html', label: 'SC Ball' },
    pagerNext: { href: '/features/transfer.html', label: 'File Transfer' }
  },

  'features/transfer.html': {
    title: 'File Transfer — move files between phone and PC | ShortCut',
    desc: 'Send files and text between phone and computer: chunked uploads for large files, expiry-based cleanup, share links and hash verification. No third-party cloud.',
    h1: 'Move files between phone and PC<br />without fighting with cables',
    lead:
      'Drop a file in and pick it up on the other side. Shared files expire automatically, and large uploads can resume after a network interruption.',
    crumb: 'File Transfer',
    sectionTitle: 'Details',
    sectionDesc: 'Send it and forget it; expiry handles the rest.',
    caps: [
      ['send', 'Chunked uploads', 'Large files are split into chunks; an interrupted network does not force you to start over.'],
      ['clock', 'Automatic expiry', 'Every file can carry a time-to-live and is deleted when it expires — nothing to clean up by hand.'],
      ['check', 'Hash verification', 'Both upload and download verify integrity, so you never end up with a corrupt file.'],
      ['grid', 'Text as well as files', 'Send a snippet or a link straight to the other clipboard — handier than copying across devices.'],
      ['shield', 'Never touches a third-party cloud', 'You control how long each share stays available and can revoke a link at any time.'],
      ['windows', 'Share links', 'Generate a download link with an expiry and send it to someone who does not even need the client.']
    ],
    pagerPrev: { href: '/features/control.html', label: 'Phone Control' },
    pagerNext: { href: '/features/android.html', label: 'Android App' }
  },

  'features/android.html': {
    title: 'Android App — native Android client | ShortCut',
    desc: 'The ShortCut Android app: tasks, file transfer and phone control in one mobile companion. In-app updates, direct LAN connection and device pairing.',
    h1: 'The Android app:<br />the interconnect, in your pocket',
    lead:
      'The mobile site works in any browser, while the Android app keeps everything one tap away, with in-app updates and a faster direct connection on the same Wi-Fi.',
    crumb: 'Android App',
    sectionTitle: 'Details',
    sectionDesc: 'Pick up on your phone without losing the flow from your desktop.',
    caps: [
      ['android', 'Made for Android', 'The interface and interactions are designed around the way you use your phone.'],
      ['cloud', 'In-app updates', 'Reads the update manifest, and when a new version exists it guides the install directly.'],
      ['bolt', 'Direct LAN connection', 'On the same Wi-Fi it connects to the desktop directly for lower command latency.'],
      ['phone', 'Device pairing', 'Pair the phone with the desktop once using a pairing code; it is recognised afterwards.'],
      ['send', 'Task wall, transfer, control', 'All three interconnect features are available from the phone.'],
      ['shield', 'One pairing, everything ready', 'Pair once and use tasks, file transfer and phone control without signing in again.']
    ],
    pagerPrev: { href: '/features/transfer.html', label: 'File Transfer' },
    pagerNext: null
  },

  'download.html': {
    title: 'Download ShortCut — desktop efficiency tool for Windows',
    desc: 'Download the latest ShortCut: official direct link, Lanzou cloud, Gitee and GitHub, plus the Android APK. Windows 10 / 11 64-bit.',
    h1: 'Download ShortCut',
    lead: 'Pick a channel. The official direct link always carries the newest build; Lanzou is faster in mainland China but is uploaded by hand, so its version may lag behind.',
    crumb: 'Download'
  },

  'changelog.html': {
    title: 'Changelog — ShortCut release history',
    desc: 'ShortCut release history: what changed and what was fixed in every version.',
    h1: 'Changelog',
    lead: 'The latest release is read live from the update service. Detailed historical release notes are currently maintained in Chinese; every version on record is listed below.',
    crumb: 'Changelog'
  },

  'faq.html': {
    title: 'FAQ — ShortCut',
    desc: 'ShortCut FAQ: installation and updates, features, phone interconnect, privacy and the Android app.',
    h1: 'Frequently asked questions',
    lead: 'Grouped by topic. If your question is not here, use the feedback page.',
    crumb: 'FAQ'
  },

  'feedback.html': {
    title: 'Feedback — ShortCut',
    desc: 'Report a problem, suggest a feature or ask a question about ShortCut. No account needed.',
    h1: 'Feedback',
    lead: 'Found a bug, want a feature, or just want to say something? Write it here. No account, no contact details required (but leaving one makes a reply possible).',
    crumb: 'Feedback'
  }
};

/* ── 英文界面通用文案（data.js 运行时使用）────────────────────────────── */
export const EN_UI = {
  nav: [
    { id: 'home', label: 'Home', href: '/' },
    {
      id: 'features', label: 'Features', href: '/features/shortcut.html',
      children: [
        { label: 'Quick Launch', href: '/features/shortcut.html' },
        { label: 'Task Wall', href: '/features/taskwall.html' },
        { label: 'SC Ball', href: '/features/scball.html' },
        { label: 'Phone Control', href: '/features/control.html' },
        { label: 'File Transfer', href: '/features/transfer.html' },
        { label: 'Android App', href: '/features/android.html' }
      ]
    },
    { id: 'download', label: 'Download', href: '/download.html' },
    { id: 'changelog', label: 'Changelog', href: '/changelog.html' },
    { id: 'faq', label: 'FAQ', href: '/faq.html' },
    { id: 'feedback', label: 'Feedback', href: '/feedback.html' }
  ],
  features: {
    shortcut: { label: 'Quick Launch', tagline: 'Apps, files, folders and links in one place, launched by keyboard', points: ['Global hotkey', 'Automatic icons', 'Import installed apps', 'Tabs and groups'] },
    taskwall: { label: 'Task Wall', tagline: 'Sticky-note tasks — pinned means remembered', points: ['Multiple walls', 'Long text and reminders', 'Pin from phone', 'Two-way completion'] },
    scball: { label: 'SC Ball', tagline: 'A small island: music, tasks and system stats in one pill', points: ['Three states', 'Music cover and lyrics', 'Hardware stats', 'DeepSeek balance'] },
    control: { label: 'Phone Control', tagline: 'Your phone as keyboard and trackpad, from any network', points: ['Cloud relay', 'Direct LAN', 'Clipboard', 'Key combos'] },
    transfer: { label: 'File Transfer', tagline: 'Move files between phone and PC without third-party clouds', points: ['Chunked upload', 'Auto expiry', 'Share links', 'Hash checks'] },
    android: { label: 'Android App', tagline: 'The ShortCut experience, made for your phone', points: ['Made for Android', 'In-app updates', 'Direct LAN', 'Device pairing'] }
  },
  hotkeys: {
    'Alt+Space': 'Show / hide the main panel',
    'Alt+B': 'Toggle SC Ball click-through',
    'Alt+I': 'Show / hide SC Ball',
    'Alt+U': 'Show / hide SC task-list ball',
    'Alt+E': 'Translate selected text',
    'Alt+S': 'Capture the full screen to clipboard',
    'Alt+D': 'Capture a screen region',
    'Alt+Z': 'Previous track',
    'Alt+X': 'Play / pause',
    'Alt+C': 'Next track',
    '长按 Space 0.5 秒': 'Hold Space for 0.5 s to cycle modules',
    'Z / X': 'Previous / next module'
  },
  channels: {
    server: { label: 'Official download', desc: 'Latest version · speed depends on your connection' },
    lanzou: { label: 'Lanzou Cloud', desc: 'Usually fast in mainland China · access code required' },
    android: { label: 'Android APK', desc: 'Mobile installer · pair with your desktop by QR code' }
  },
  faq: [
    {
      group: 'Installation and updates',
      items: [
        { q: 'Which versions of Windows are supported?', a: 'Windows 10 and Windows 11, 64-bit. Windows 11 works out of the box; on some Windows 10 PCs the installer will prompt for a required component.' },
        { q: 'What should I do about the “unknown publisher” warning?', a: 'The installer does not have a Windows digital signature yet, so SmartScreen may show an unknown publisher. Choose “More info → Run anyway”. Updates are still checked before installation.' },
        { q: 'Will installing a new version remove my tasks or shortcuts?', a: 'No. Shortcuts, tasks and settings are preserved during an upgrade, and ShortCut keeps the three most recent local backups.' },
        { q: 'How do I check for updates?', a: 'Open the main panel, go to Updates and choose Check for updates. If a new version is available, ShortCut shows its version and release notes and waits for your confirmation before downloading.' },
        { q: 'What if a very old version cannot check for updates?', a: 'Versions 2.4.x and earlier may not be able to update in-app. Download 2.5.1 or a newer build once and install it over the old version; your data will be preserved.' }
      ]
    },
    {
      group: 'Using ShortCut',
      items: [
        { q: 'Can I add web links?', a: 'Yes. Shortcuts support apps, folders, files, URLs, shortcut groups and BAT scripts.' },
        { q: 'Why do some apps show a generic icon?', a: 'Icons are read from each program’s own resources. If an icon is packed into a special library or format, ShortCut falls back to a generic icon; you can also choose an icon file manually.' },
        { q: 'What if a global hotkey conflicts with another app?', a: 'You can change global hotkeys in Settings. ShortCut also tells you when Windows cannot register a shortcut.' }
      ]
    },
    {
      group: 'Phone interconnect',
      items: [
        { q: 'What do I need for phone control?', a: 'In cloud mode the desktop only needs to stay running, and the phone can connect from any network. On the same Wi-Fi, direct LAN mode gives lower latency.' },
        { q: 'Will a task disappear if my desktop is offline?', a: 'No. The task waits in a secure relay queue and is delivered when the desktop comes back online. The phone shows when it is queued.' },
        { q: 'Where are files kept during file transfer?', a: 'Files are kept only until the share expires, then cleaned up automatically. They never pass through a third-party cloud drive.' }
      ]
    },
    {
      group: 'Privacy and data',
      items: [
        { q: 'Does my data go to the internet?', a: 'Shortcuts, task walls and usage history stay on your computer. Only when you actively use phone interconnect (task sync, file transfer or phone control) does data move through ShortCut’s secure link.' },
        { q: 'Do I need an account?', a: 'The desktop app is activated with an activation code; phone interconnect is paired with a binding code. No account registration is required.' }
      ]
    },
    {
      group: 'Android app',
      items: [
        { q: 'What is the difference between the Android app and the mobile site?', a: 'The Android app supports in-app updates, direct LAN connection and system notifications. The mobile site opens in any browser without installation.' },
        { q: 'How do I update the Android app?', a: 'Use Check for updates inside the app, or download the latest APK from this site.' }
      ]
    }
  ],
  footer: {
    product: 'Product',
    features: 'Features',
    repos: 'Repositories',
    download: 'Download',
    changelog: 'Changelog',
    faq: 'FAQ',
    feedback: 'Feedback',
    overview: 'Feature overview',
    legal: 'Proprietary software · All rights reserved',
    note: 'This site is bilingual. Release notes are recorded in Chinese.'
  }
};

/* ── 首页（index.html）英文替换表 ─────────────────────────────────────── */
export const EN_INDEX_REPLACE = [
  ['<img src="/assets/img/screens/shortcut-panel.png" width="1180" height="710" alt="ShortCut 快捷启动页面，左侧为功能导航，右侧为快捷方式分组与图标" fetchpriority="high" />', '<img src="/assets/img/screens/shortcut-panel.png" width="1180" height="710" alt="ShortCut Quick Launch page with the navigation rail on the left and shortcut groups on the right" fetchpriority="high" />'],
  ['<li><span>输入</span>名称、路径或备注都能找到</li>', '<li><span>Find</span>By name, path or note</li>'],
  ['<li><span>移动</span>方向键选中，长按也能循环切换</li>', '<li><span>Move</span>Arrow keys select; holding one wraps around</li>'],
  ['<li><span>启动</span>应用、网页、脚本和一组入口</li>', '<li><span>Launch</span>Apps, links, scripts and groups</li>'],
  ['<div class="launch-board__top"><span>常用</span><span>工作</span><span>工具</span><b>+</b></div>', '<div class="launch-board__top"><span>Daily</span><span>Work</span><span>Tools</span><b>+</b></div>'],
  ['<div class="key-hint"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><span>移动</span><kbd>Enter</kbd><span>打开</span></div>', '<div class="key-hint"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><span>move</span><kbd>Enter</kbd><span>open</span></div>'],
  ['<li><span>写法</span>一句话，或者展开成一张长纸条</li>', '<li><span>Write</span>A short line or a full long-form note</li>'],
  ['<li><span>提醒</span>到时间由 SC球 把任务递到你面前</li>', '<li><span>Remind</span>SC Ball brings it back when the time comes</li>'],
  ['<li><span>同步</span>手机上钉入，回到电脑继续处理</li>', '<li><span>Sync</span>Pin it on your phone, continue at your desk</li>'],
  ['<li><span>桌面</span>收起、迷你、展开三种状态</li>', '<li><span>Desktop</span>Compact, mini and expanded states</li>'],
  ['<li><span>音乐</span>封面、歌词和播放控制都在球里</li>', '<li><span>Music</span>Cover art, lyrics and playback in one place</li>'],
  ['<li><span>手机</span>任务、文件和控制，接着用同一台电脑</li>', '<li><span>Phone</span>Tasks, files and control for the same computer</li>'],
  ['<span class="home-eyebrow">需要时再打开</span>', '<span class="home-eyebrow">When you need them</span>'],
  ['<a class="home-text-link" href="/features/control.html">查看全部功能 <span>→</span></a>', '<a class="home-text-link" href="/features/control.html">View all features <span>→</span></a>'],
  ['在手机上接任务、传文件、查看联动状态；也可以直接用浏览器打开移动页，无需安装。', 'Pick up tasks, transfer files and check the connection from your phone, or use the mobile site in a browser without installing anything.'],
  ['<b>查看安卓端 →</b>', '<b>View the Android app →</b>'],
  ['<b>查看快捷键 →</b>', '<b>View shortcuts →</b>'],
  ['<b>查看系统状态 →</b>', '<b>View system status →</b>'],
  ['<b>查看常见问题 →</b>', '<b>Read the FAQ →</b>'],
  ['<a class="home-button home-button--outline" href="/changelog.html">查看更新记录</a>', '<a class="home-button home-button--outline" href="/changelog.html">View release notes</a>'],
  ['<title>ShortCut — 把常用的事，收进一页</title>', '<title>ShortCut — the things you use, all within reach</title>'],
  ['content="ShortCut 是一款 Windows 桌面效率工具。快捷启动常用软件、文件和网页，用纸条任务墙安排事情，让 SC球 常驻桌面，并通过手机联动随手同步任务与文件。"', 'content="ShortCut is a Windows desktop tool for quick launch, a sticky-note task wall, the always-present SC Ball, and a simple handoff between your phone and computer."'],
  ['content="ShortCut — 把常用的事，收进一页"', 'content="ShortCut — the things you use, all within reach"'],
  ['content="快捷启动、纸条任务墙、SC球与手机联动。Windows 上更顺手的一页。"', 'content="Quick launch, a sticky-note task wall, SC Ball and phone handoff, in one calmer Windows workspace."'],
  ['ShortCut · Windows 桌面效率工具', 'ShortCut · A Windows desktop workspace'],
  ['把常用的事，<br /><span>收进一页。</span>', 'The things you use,<br /><span>all within reach.</span>'],
  ['软件、文件、网页和待办，不必散落在桌面、开始菜单和各种窗口里。ShortCut 把每天会用到的东西放到手边，键盘一按就能继续手上的事。', 'Apps, files, links and tasks should not be scattered across your desktop, Start menu and a pile of windows. ShortCut keeps everyday actions close, so a keypress is often all it takes to keep moving.'],
  ['免费下载 Windows 版', 'Download for Windows'],
  ['看看它能做什么', 'See what it does'],
  ['当前版本', 'Current version'],
  ['无需登录', 'No account required'],
  ['快捷键选中，回车即启动', 'Select with keys, press Enter'],
  ['ShortCut 主界面', 'ShortCut main panel'],
  ['真实截图', 'Real interface'],
  ['随时唤出', 'anywhere'],
  ['从打开软件，到记住一件小事', 'From opening an app to remembering a small task'],
  ['一个窗口，接着做', 'One place to keep moving'],
  ['手机也能顺手接上', 'Your phone can pick up the thread'],
  ['让每天重复的小动作，<strong>少绕几步。</strong>', 'A little less friction, <strong>every day.</strong>'],
  ['三件最常用的事', 'Three everyday actions'],
  ['打开、记住、随手接上。', 'Launch. Remember. Carry on.'],
  ['首页不负责展示全部功能。先从最常发生的三个动作开始，其他能力都在需要时出现。', 'The home page is not a feature inventory. These three actions matter most; everything else is there when you need it.'],
  ['01 / 快捷启动', '01 / Quick Launch'],
  ['不用再找图标，<br />键盘选中就打开。', 'Stop hunting for icons.<br />Pick one with the keyboard.'],
  ['把软件、文件夹、文件和网页放进同一个页面。方向键移动，回车启动；常用的东西还能分组、排序、搜索。', 'Keep apps, folders, files and links on one page. Move with the arrow keys, press Enter to launch, and organise the things you use most.'],
  ['名称、路径或备注都能找到', 'Find by name, path or note'],
  ['方向键选中，长按也能循环切换', 'Arrow keys select; holding one wraps around'],
  ['应用、网页、脚本和一组入口', 'Apps, links, scripts and groups'],
  ['了解快捷启动 ', 'Explore Quick Launch '],
  ['快捷启动的键盘操作演示', 'Keyboard navigation demonstration'],
  ['编辑器', 'Editor'], ['资料', 'Files'], ['工作台', 'Workspace'], ['终端', 'Terminal'],
  ['搜索快捷方式', 'Search shortcuts'], ['移动', 'move'], ['打开', 'open'],
  ['02 / 任务墙', '02 / Task Wall'],
  ['不是再开一个待办软件，<br />是把事情贴在眼前。', 'Not another to-do app.<br />Put the work in front of you.'],
  ['每件事就是一张纸条，写标题、补充正文、定时提醒。多面任务墙把工作、生活和临时想法分开，移开视线也不会从脑子里消失。', 'Each task is a note. Add a title, write the details, set a reminder. Separate walls keep work, life and quick thoughts apart without letting them disappear.'],
  ['一句话，或者展开成一张长纸条', 'A short line or a full long-form note'],
  ['到时间由 SC球 把任务递到你面前', 'SC Ball brings it back when the time comes'],
  ['手机上钉入，回到电脑继续处理', 'Pin it on your phone, continue at your desk'],
  ['看看任务墙 ', 'Explore Task Wall '],
  ['ShortCut 任务墙，不同颜色的纸条任务按自由位置贴在墙上', 'ShortCut Task Wall with coloured sticky notes arranged freely'],
  ['长文本可以展开写', 'Long notes expand'], ['到点提醒，不忘', 'Reminders stay visible'],
  ['03 / SC球与手机联动', '03 / SC Ball + phone handoff'],
  ['桌面上留一颗小球，<br />重要的事不藏进后台。', 'A small presence on your desktop.<br />Important things stay visible.'],
  ['SC球 收起时只占很小一块，需要时再展开。音乐、待办提醒、电脑状态和余额都能在这里看一眼；手机与电脑绑定后，任务也能从手机递过来。', 'SC Ball tucks into a small strip and opens when needed. Music, reminders, system stats and balance are always within a glance; pair your phone to hand tasks over from mobile.'],
  ['收起、迷你、展开三种状态', 'Compact, mini and expanded states'],
  ['封面、歌词和播放控制都在球里', 'Cover art, lyrics and playback in one place'],
  ['任务、文件和控制，接着用同一台电脑', 'Tasks, files and control for the same computer'],
  ['了解 SC球 ', 'Meet SC Ball '],
  ['正在播放的一首歌', 'Now playing'], ['歌手名 · 下一句歌词', 'Artist · next lyric'],
  ['把今天的记录整理好', 'Sort through today’s notes'], ['任务提醒', 'Task reminder'], ['查看', 'View'],
  ['ShortCut 联动', 'ShortCut Connect'], ['已连接', 'Connected'],
  ['手机钉入的任务', 'Pinned on your phone'], ['回到电脑上继续', 'Continue on your computer'], ['从手机发送', 'Send from phone'],
  ['需要时再打开', 'When you need them'],
  ['还有这些顺手的能力。', 'A few more useful things.'],
  ['查看全部功能 ', 'View all features '],
  ['手机控电脑', 'Phone control'], ['把手机当键盘和触控板。同一 Wi-Fi 下直连，出门在外也能通过云端中继操作电脑。', 'Use your phone as a keyboard and trackpad. Connect directly on the same Wi-Fi or operate the computer remotely through the cloud.'],
  ['键盘、触控板、剪贴板 →', 'Keyboard, trackpad and clipboard →'],
  ['文件快传', 'File transfer'], ['手机与电脑之间发送文件或文本，不必登录第三方网盘。分享时间由你决定，过期后自动清理。', 'Send files or text between phone and computer without a third-party drive. You choose the share window; expired items are cleaned up automatically.'],
  ['发送与领取 →', 'Send and receive →'],
  ['安卓端', 'Android app'], ['在手机上接任务、传文件、查看联动状态；也可以直接用浏览器打开移动页，无需安装。', 'Pick up tasks, transfer files and check the connection from your phone, or use the mobile site in a browser without installing anything.'],
  ['查看安卓端 →', 'View the Android app →'],
  ['屏幕与翻译', 'Screenshots and translation'], ['Alt+S 截取整个屏幕到剪贴板，Alt+E 翻译选中的文字，结果用一张纸条浮在最上层。', 'Alt+S copies the whole screen to the clipboard; Alt+E translates selected text in a note that stays above other windows.'],
  ['查看快捷键 →', 'View shortcuts →'],
  ['电脑驾驶舱', 'System dashboard'], ['CPU、GPU、内存的使用率和温度收进 SC球；需要看细节时再进驾驶舱页面。', 'CPU, GPU and memory usage and temperature live in SC Ball; open the dashboard when you want the full picture.'],
  ['查看系统状态 →', 'View system status →'],
  ['本地优先', 'Local-first'], ['快捷方式、任务和使用记录默认留在本机。只有你主动使用手机联动时，数据才会经过 ShortCut 的安全联动通道。', 'Shortcuts, tasks and usage history stay on your computer by default. Data only moves through the secure ShortCut link when you actively use phone handoff.'],
  ['查看常见问题 →', 'Read the FAQ →'],
  ['最近更新', 'Latest release'], ['正在读取最新版本…', 'Reading the latest version…'], ['查看更新记录', 'View release notes'],
  ['Windows 10 / 11 · 免费下载', 'Windows 10 / 11 · free download'],
  ['把电脑桌面，<br />换成更顺手的样子。', 'Make your desktop<br />feel a little more natural.'],
  ['下载后即可使用。覆盖安装会保留已有快捷方式和任务。', 'Ready after download. Installing over an older version keeps your shortcuts and tasks.'],
  ['下载最新版本', 'Download the latest version'],
  ['<html lang="zh-CN">', '<html lang="en">'],
  ['<title>ShortCut — Windows 桌面效率工具｜快捷启动 · 任务墙 · SC球灵动岛</title>',
   '<title>ShortCut — desktop efficiency tool for Windows | Quick Launch · Task Wall · SC Ball</title>'],
  ['content="ShortCut 是一款 Windows 桌面效率工具：快捷启动、任务墙、SC球灵动岛、文件转换、截图翻译，并可与手机联动——任务同步、文件快传、手机控电脑。无需登录，数据默认留在本机。"',
   'content="ShortCut is a Windows desktop efficiency tool: quick launch, task wall, SC Ball island, file conversion and screenshot translation — plus phone interconnect (task sync, file transfer, phone control). No account, data stays local by default."'],
  ['content="ShortCut — Windows 桌面效率工具"', 'content="ShortCut — desktop efficiency tool for Windows"'],
  ['content="快捷启动、任务墙、SC球灵动岛，并可与手机联动。数据默认留在本机。"',
   'content="Quick launch, task wall and the SC Ball island, plus phone interconnect. Data stays local by default."'],
  ['content="zh-CN"', 'content="en"'],
  ['Windows 10 / 11 桌面效率工具', 'Desktop efficiency tool for Windows 10 / 11'],
  ['集中启动，<span class="grad">一键直达</span><br />SC球常驻，效率升级',
   'Everything in one place, <span class="grad">one keystroke away</span><br />with SC Ball on your desktop'],
  ['把常用软件、文件、文件夹、网页集中到一处，键盘一按直达；\n          任务用纸条贴在墙上，常驻桌面的 SC球 把音乐、任务、驾驶舱和余额收进一颗小球。\n          <strong>不用改变现有习惯，也不用登录账号。</strong>',
   'Keep your frequently used apps, files, folders and links in one place and open them with a keystroke. Tasks live on a sticky-note wall, and the always-on-screen SC Ball folds music, tasks, system stats and balance into one little pill. <strong>Nothing about your habits has to change, and there is no account to create.</strong>'],
  ['>免费下载<', '>Download free<'],
  ['>看看能做什么<', '>See what it does<'],
  ['当前版本', 'Current version'],
  ['安装包体积', 'Installer size'],
  ['数据不上传', 'Data stays local'],
  ['六件事，一个工具做完', 'Six things, one tool'],
  ['桌面端四块、移动互联两块。每一块都能单独用，也可以串起来用。',
   'Four on the desktop and two across devices. Each works on its own, and they work together.'],
  ['手机上做的事，电脑上接着完成', 'Start on your phone, finish on your computer'],
  ['任务墙双向同步、文件互传，还能把手机当电脑的键盘与触控板。所有数据走你自己的服务器。',
   'Two-way task sync, file transfer, and your phone acting as the keyboard and trackpad. Everything moves through one private handoff.'],
  ['>手机<', '>Phone<'],
  ['云端中继 · 局域网直连', 'Cloud relay · direct LAN'],
  ['>电脑<', '>Computer<'],
  ['>任务墙同步<', '>Task sync<'],
  ['手机上钉一条任务，电脑任务墙立刻出现；桌面端离线也不会丢，上线自动接收。',
   'Pin a task on your phone and it shows up on the desktop at once — offline desktops queue it and receive it once back online.'],
  ['>文件快传<', '>File transfer<'],
  ['手机与电脑互传文件与文本，分片上传大文件，按有效期自动清理。',
   'Move files and text between phone and computer, chunked uploads for big files, cleaned up by expiry.'],
  ['>手机控电脑<', '>Phone control<'],
  ['手机当键盘触控板：打字、组合键、剪贴板互传。4G 也能连，同 Wi-Fi 延迟更低。',
   'Turn your phone into a keyboard and trackpad: typing, key combos, clipboard sync. Works on 4G, faster on the same Wi-Fi.'],
  ['轻、快、不打扰', 'Light, fast, unobtrusive'],
  ['不改变你现在的使用习惯，也不会在后台偷偷做事。',
   'Your habits stay as they are, and nothing happens behind your back.'],
  ['7 MB，启动即用', '7 MB, ready on launch'],
  ['Tauri 2 重构后体积比旧版减少约 94%，内存占用下降约 30%。',
   'After the Tauri 2 rewrite the installer is about 94% smaller and memory use is down about 30%.'],
  ['数据默认留在本机', 'Data stays on your machine'],
  ['快捷方式、任务墙、使用记录都存在你电脑里；只有你用移动互联时才走自建服务器。',
   'Shortcuts, tasks and usage records live on your computer; only the interconnect features use a secure transfer link.'],
  ['不改变使用习惯', 'No change to your habits'],
  ['SC球 可穿透、可隐藏，不挡桌面点击；不想用时按 Alt+I 直接收起。',
   'SC Ball can be click-through or hidden and never blocks desktop clicks; press Alt+I to tuck it away.'],
  ['>最新版本<', '>Latest release<'],
  ['正在读取版本信息…', 'Reading version…'],
  ['>全部更新<', '>View all changes<'],
  ['试试 <span class="grad">ShortCut</span>', 'Try <span class="grad">ShortCut</span>'],
  ['Windows 10 / 11 · 免费下载 · 无需登录', 'Windows 10 / 11 · free download · no account needed'],
  ['>下载最新版本<', '>Download the latest<'],
  ['>先看看常见问题<', '>Read the FAQ first<'],
  ['搜索快捷方式…', 'Search shortcuts…'],
  /* 示意图里的界面文字（可见，必须翻译）*/
  ['任务墙同步', 'Task sync'],
  ['ShortCut 联动', 'ShortCut Connect'],
  ['任务墙 · 钉一条任务', 'Task Wall · pin a task'],
  ['快捷方式', 'Shortcuts'],
  ['驾驶舱', 'Dashboard'],
  ['使用记录', 'Usage log'],
  ['设备与绑定', 'Devices & pairing'],
  ['任务墙', 'Task Wall'],
  ['电脑控制', 'PC control'],
  ['在这输入，电脑上直接出现', 'Type here — it appears on the PC'],
  ['正在播放', 'Now playing'],
  ['核心功能', 'Core features'],
  ['移动互联', 'Interconnect'],
  ['为什么选它', 'Why ShortCut'],
  ['为什么用它', 'Why use it'],
  ['了解更多 ', 'Learn more '],
  ['无需登录', 'No account needed'],
  ['数据不上传', 'No uploads'],
  ['本地保存', 'Stored locally'],
  ['免费下载', 'Download free'],
  ['翻译', 'Translate'],
  ['控制', 'Control']
];

/* ── 英文页需要替换的界面小文案（生成器直接套用）────────────────────── */
export const EN_CTA = {
  heading: 'Try <span class="grad">ShortCut</span>',
  sub: 'Windows 10 / 11 · free download · no account needed',
  primary: 'Download the latest',
  ghost: 'Read the FAQ first'
};

export const EN_LABELS = {
  prev: 'Previous feature',
  next: 'Next feature',
  home: 'Home',
  features: 'Features'
};
