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
      ['cloud', 'Cloud relay (works on 4G)', 'Not on the same network: phone and desktop each connect to your own server and commands are relayed.'],
      ['bolt', 'Direct LAN connection', 'On the same Wi-Fi it talks straight to port 9823 on the desktop — no server in between, lowest latency.'],
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
      'Drop a file in and pick it up on the other side. Files live on your own server and expire automatically — no third-party cloud involved. Large files upload in chunks, so an interrupted transfer can resume.',
    crumb: 'File Transfer',
    sectionTitle: 'Details',
    sectionDesc: 'Send it and forget it; expiry handles the rest.',
    caps: [
      ['send', 'Chunked uploads', 'Large files are split into chunks; an interrupted network does not force you to start over.'],
      ['clock', 'Automatic expiry', 'Every file can carry a time-to-live and is deleted when it expires — nothing to clean up by hand.'],
      ['check', 'Hash verification', 'Both upload and download verify integrity, so you never end up with a corrupt file.'],
      ['grid', 'Text as well as files', 'Send a snippet or a link straight to the other clipboard — handier than copying across devices.'],
      ['shield', 'Never touches a third-party cloud', 'Files stay on the server you deployed; links are yours to revoke at any time.'],
      ['windows', 'Share links', 'Generate a download link with an expiry and send it to someone who does not even need the client.']
    ],
    pagerPrev: { href: '/features/control.html', label: 'Phone Control' },
    pagerNext: { href: '/features/android.html', label: 'Android App' }
  },

  'features/android.html': {
    title: 'Android App — native Android client | ShortCut',
    desc: 'The ShortCut Android app: a native Kotlin client speaking the same contract as the desktop app. In-app updates, direct LAN connection and device pairing.',
    h1: 'The Android app:<br />the interconnect, in your pocket',
    lead:
      'The mobile web pages work in any browser, while the Android app is native — smoother, with in-app updates and a direct LAN connection on the same Wi-Fi. It speaks the same API contract as the desktop app, so features ship together.',
    crumb: 'Android App',
    sectionTitle: 'Details',
    sectionDesc: 'One contract with the desktop, features moving forward together.',
    caps: [
      ['android', 'Native Kotlin client', 'Not a wrapped web view — the UI and interactions follow Android conventions.'],
      ['cloud', 'In-app updates', 'Reads the update manifest, and when a new version exists it guides the install directly.'],
      ['bolt', 'Direct LAN connection', 'On the same Wi-Fi it connects to the desktop directly for lower command latency.'],
      ['phone', 'Device pairing', 'Pair the phone with the desktop once using a pairing code; it is recognised afterwards.'],
      ['send', 'Task wall, transfer, control', 'All three interconnect features are available from the phone.'],
      ['shield', 'A single API contract', 'Every endpoint and field follows the interconnect contract, so the two ends never disagree.']
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
    lead: 'The latest release is read live from the update manifest. Every version on record is listed below — click one to expand its notes.',
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
    android: { label: 'Android App', tagline: 'Native Kotlin client sharing one contract with the desktop', points: ['Native UI', 'In-app updates', 'Direct LAN', 'Device pairing'] }
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
   'Two-way task sync, file transfer, and your phone acting as the keyboard and trackpad. All of it goes through your own server.'],
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
   'Shortcuts, tasks and usage records live on your computer; only the interconnect features talk to your own server.'],
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
