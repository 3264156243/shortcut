/**
 * ShortCut 官网 · 站点数据（唯一真源）
 * ---------------------------------------------------------------------------
 * 改文案/版本/渠道/日志/FAQ 只改这里，不需要动 9 个 HTML。
 *
 * 设计原则：
 *   1. 能动态取的（版本号、安装包体积、安卓版本）不写死 —— 见 download.js
 *   2. 取不到时用本文件的兜底值，页面绝不显示错误（官网不能报错）
 *   3. 渠道/链接集中在这里，改一处全站生效
 */
(function (global) {
  'use strict';

  /* ── 基础信息 ─────────────────────────────────────────────────────────── */
  var SITE = {
    name: 'ShortCut',
    nameZh: 'SC',
    tagline: '把常用的事，收进一页',
    description: '快捷启动、纸条任务墙、SC球与手机联动，把每天重复的小动作收进一个顺手的 Windows 工具。',
    themeColor: '#f3eee4',
    accent: '#e45b25',
    // 更新清单（同域，无 CORS）
    latestJson: '/updates/latest.json',
    androidLatestJson: '/updates/android/latest.json',
    updatesBase: '/updates/',
    androidBase: '/updates/android/'
  };

  /* ── 导航 ─────────────────────────────────────────────────────────────── */
  // id 用于当前页高亮（对应每个 HTML 上的 <body data-page="xxx">）
  var NAV = [
    { id: 'home', label: '首页', href: '/' },
    {
      id: 'features', label: '功能', href: '/features/shortcut.html',
      children: [
        { label: '快捷启动', href: '/features/shortcut.html' },
        { label: '任务墙', href: '/features/taskwall.html' },
        { label: 'SC球 灵动岛', href: '/features/scball.html' },
        { label: '手机控电脑', href: '/features/control.html' },
        { label: '文件快传', href: '/features/transfer.html' },
        { label: '安卓端', href: '/features/android.html' }
      ]
    },
    { id: 'download', label: '下载', href: '/download.html' },
    { id: 'changelog', label: '更新日志', href: '/changelog.html' },
    { id: 'faq', label: '常见问题', href: '/faq.html' },
    { id: 'feedback', label: '问题反馈', href: '/feedback.html' }
  ];

  /* ── 功能清单（首页卡片 + 功能页导航共用）────────────────────────────── */
  var FEATURES = [
    {
      id: 'shortcut', label: '快捷启动', icon: 'grid',
      tagline: '常用软件、文件、文件夹、网页集中一处，键盘一按直达',
      href: '/features/shortcut.html',
      points: ['全局快捷键唤出', '图标自动提取', '导入已安装软件', '页签与分组']
    },
    {
      id: 'taskwall', label: '任务墙', icon: 'sticky',
      tagline: '纸条式任务墙，贴上去就不会忘',
      href: '/features/taskwall.html',
      points: ['多面任务墙', '长文本与待办提醒', '手机钉任务同步', '完成状态双向同步']
    },
    {
      id: 'scball', label: 'SC球 灵动岛', icon: 'island',
      tagline: '常驻桌面的小岛：音乐、任务、驾驶舱、余额一屏掌握',
      href: '/features/scball.html',
      points: ['收起/迷你/展开三态', '音乐封面与歌词', '驾驶舱温度', 'DeepSeek 余额']
    },
    {
      id: 'control', label: '手机控电脑', icon: 'phone',
      tagline: '手机当键盘触控板，任意网络都能连',
      href: '/features/control.html',
      points: ['云端中继（4G 可用）', '局域网低延迟直连', '剪贴板互传', '常用组合键']
    },
    {
      id: 'transfer', label: '文件快传', icon: 'send',
      tagline: '手机与电脑之间发送文件或文本，分享时间由你决定',
      href: '/features/transfer.html',
      points: ['手机与电脑互传', '自定义分享时长', '文本与文件都能发', '到期自动清理']
    },
    {
      id: 'android', label: '安卓端', icon: 'android',
      tagline: '在手机上接任务、传文件，也能直接用浏览器打开移动页',
      href: '/features/android.html',
      points: ['手机接任务', '文件快传入口', '局域网联动', '设备绑定']
    }
  ];

  /* ── 下载渠道（四渠道平铺；顺序即展示顺序）──────────────────────────── */
  var CHANNELS = [
    {
      id: 'server', label: '官网直链', icon: 'download', recommend: true,
      desc: '最新版本 · 速度取决于你的网络',
      // url 由 download.js 依 latest.json 动态填充；下面是兜底
      fallbackUrl: '/updates/ShortCut_2.5.1_x64-setup.exe'
    },
    {
      id: 'lanzou', label: '蓝奏云', icon: 'cloud',
      desc: '国内下载较快 · 需提取码',
      url: 'https://wwbac.lanzoue.com/ijE7j45ylf5a',
      code: '9akr',
      // 每次发版需手动上传新包；版本可能滞后于官网直链
      mayBeStale: true
    },
    {
      id: 'android', label: '安卓端 APK', icon: 'android',
      desc: '手机安装包 · 与桌面端扫码绑定',
      url: '/download.html#android'
    }
  ];

  /* ── 版本兜底值（接口失败时使用，不显示错误）────────────────────────── */
  var FALLBACK_VERSION = {
    desktop: { version: '2.5.1', pubDate: '2026-10-18', size: 7338426 },
    android: { version: '0.2.4', versionCode: 6, size: 37030859 }
  };

  /* ── 更新日志历史（最新版从 latest.json 动态读，这里只放历史）───────── */
  var CHANGELOG = [
    {
      version: '2.5.1', date: '2026-10-18',
      items: [
        '修复部分情况下检查更新一直失败的问题',
        '修复下载时进度条不更新的问题',
        '更新检查会更清楚地告诉你是否有新版本'
      ]
    },
    {
      version: '2.5.0', date: '2026-10-17',
      items: [
        '完成桌面端体验升级，启动更快、占用更低',
        '已有快捷方式和任务可以继续使用',
        '修复重复启动和资源路径相关的问题',
        'SC球鼠标穿透快捷键调整为 Alt+B'
      ]
    },
    {
      version: '2.4.6', date: '2026-09-30',
      items: ['桌面端运行更轻量，安装包体积进一步减小', 'SC球设置完整生效，常用能力保持一致']
    },
    {
      version: '2.4.5', date: '2026-09-29',
      items: ['新增手机控电脑：支持云端与局域网连接', '文件快传增加完整性检查与到期清理']
    }
  ];

  /* ── 快捷键表 ─────────────────────────────────────────────────────────── */
  var HOTKEYS = [
    { keys: ['Alt', 'Space'], desc: '显示 / 隐藏主面板' },
    { keys: ['Alt', 'B'], desc: '切换 SC球 鼠标穿透' },
    { keys: ['Alt', 'I'], desc: '显示 / 隐藏 SC球' },
    { keys: ['Alt', 'U'], desc: '显示 / 隐藏 SC任务清单球' },
    { keys: ['Alt', 'E'], desc: '翻译选中的文字' },
    { keys: ['Alt', 'S'], desc: '截取整个屏幕到剪贴板' },
    { keys: ['Alt', 'D'], desc: '进入区域截屏' },
    { keys: ['Alt', 'Z'], desc: '音乐上一首' },
    { keys: ['Alt', 'X'], desc: '音乐播放 / 暂停' },
    { keys: ['Alt', 'C'], desc: '音乐下一首' },
    { keys: ['长按 Space 0.5 秒'], desc: '循环切换板块' },
    { keys: ['Z', '/', 'X'], desc: '上一个 / 下一个板块' }
  ];

  /* ── FAQ ──────────────────────────────────────────────────────────────── */
  var FAQ = [
    {
      group: '安装与更新',
      items: [
        { q: '支持哪些系统？', a: '支持 Windows 10 / 11 64 位。Windows 11 可以直接运行；部分 Windows 10 电脑会由安装程序提示补齐系统组件。' },
        { q: '安装时提示「未知发布者」怎么办？', a: '当前安装包未做代码签名，Windows SmartScreen 会提示未知发布者。点击「更多信息 → 仍要运行」即可。更新包本身有签名校验，不会被替换。' },
        { q: '安装新版本会丢失任务和快捷方式吗？', a: '不会。快捷方式、任务和设置在覆盖安装时会保留，并且软件会保留最近三份本地备份。' },
        { q: '如何检查更新？', a: '打开主面板进入「更新」页，点击检查更新。发现新版本后会展示版本号与更新说明，由你确认后才下载。' },
        { q: '很旧的版本无法检查更新怎么办？', a: '2.4.x 及更早版本可能无法在软件里完成更新。手动下载一次 2.5.1 或更新版本覆盖安装即可，原有数据会保留。' }
      ]
    },
    {
      group: '功能使用',
      items: [
        { q: '可以添加网页地址吗？', a: '可以。快捷方式支持应用、文件夹、普通文件、URL、快捷方式组和 BAT 脚本。' },
        { q: '为什么部分程序没有原始图标？', a: '图标从程序自身资源提取，若程序把图标打包在动态库或使用特殊格式，会回退为通用图标；你也可以手动指定图标文件。' },
        { q: '快捷键冲突了怎么办？', a: '在设置里可以修改全局快捷键，程序会在注册失败时给出提示。' }
      ]
    },
    {
      group: '移动互联',
      items: [
        { q: '手机控电脑需要什么条件？', a: '云端模式：桌面端保持运行即可，手机在任意网络（4G / 异地 Wi-Fi）都能连。局域网模式：手机与电脑连同一 Wi-Fi，延迟更低。' },
        { q: '手机钉的任务桌面端离线了会丢吗？', a: '不会。任务会先进入安全中转队列，桌面端上线后自动接收。桌面端离线时手机端会提示「已排队」。' },
        { q: '文件快传的文件存在哪？', a: '文件只在分享有效期内保留，到期后自动清理，不经过任何第三方网盘。' }
      ]
    },
    {
      group: '隐私与数据',
      items: [
        { q: '数据会上传到网络吗？', a: '快捷方式、任务墙、使用记录等桌面数据全部保存在本机。只有你主动使用移动互联功能（任务同步、文件快传、手机控电脑）时，数据才会通过 ShortCut 的加密联动通道传输。' },
        { q: '需要登录账号吗？', a: '桌面端使用激活码激活；移动互联使用绑定码把手机与电脑配对，不需要注册账号。' }
      ]
    },
    {
      group: '安卓端',
      items: [
        { q: '安卓端和手机网页有什么区别？', a: '安卓端是原生 App，支持应用内更新、局域网直连与系统级通知；手机网页用浏览器打开即可，无需安装。' },
        { q: '安卓端怎么更新？', a: 'App 内「检查更新」会读取官网更新清单并引导安装；也可以在本站下载页手动下载 APK。' }
      ]
    }
  ];

  /* ── 页脚 ─────────────────────────────────────────────────────────────── */
  var FOOTER = {
    columns: [
      {
        key: 'product', title: '产品', links: [
          { key: 'overview', label: '功能总览', href: '/features/shortcut.html' },
          { key: 'download', label: '下载', href: '/download.html' },
          { key: 'changelog', label: '更新日志', href: '/changelog.html' },
          { key: 'faq', label: '常见问题', href: '/faq.html' },
          { key: 'feedback', label: '问题反馈', href: '/feedback.html' }
        ]
      },
      {
        key: 'features', title: '功能',
        links: FEATURES.map(function (f) { return { key: f.id, label: f.label, href: f.href }; })
      },
      {
        key: 'repos', title: '仓库', links: [
          { key: 'gitee', label: 'Gitee', href: 'https://gitee.com/wanan6/short-cut', external: true },
          { key: 'github', label: 'GitHub', href: 'https://github.com/3264156243/shortcut', external: true }
        ]
      }
    ],
    legal: '专有软件 · 保留所有权利',
    copyright: '© 2026 ShortCut'
  };


  /* ═══ 英文站点：切换数据（英文页先引入 data-en.js）═══════════════════════ */
  var LANG = (document.documentElement.getAttribute('lang') || 'zh-CN').toLowerCase();
  if (LANG.indexOf('en') === 0 && global.SC_EN) {
    var EN = global.SC_EN;

    function enHref(h) {
      if (!h || h.charAt(0) !== '/') return h;
      return h.indexOf('/en/') === 0 ? h : '/en' + h;
    }

    if (EN.nav) {
      NAV = EN.nav.map(function (item) {
        var copy = { id: item.id, label: item.label, href: enHref(item.href) };
        if (item.children) {
          copy.children = item.children.map(function (c) {
            return { label: c.label, href: enHref(c.href) };
          });
        }
        return copy;
      });
    }

    if (EN.features) {
      FEATURES = FEATURES.map(function (f) {
        var t = EN.features[f.id];
        if (!t) return f;
        return {
          id: f.id, icon: f.icon, href: enHref(f.href),
          label: t.label || f.label,
          tagline: t.tagline || f.tagline,
          points: t.points || f.points
        };
      });
    }

    if (EN.hotkeys && EN.hotkeys.length === HOTKEYS.length) {
      HOTKEYS = HOTKEYS.map(function (h, i) {
        return { keys: h.keys, desc: EN.hotkeys[i] || h.desc };
      });
    } else if (EN.hotkeys) {
      /* 按组合键匹配（数组顺序变了也不会错位） */
      HOTKEYS = HOTKEYS.map(function (h) {
        var combo = h.keys.join('+');
        return { keys: h.keys, desc: EN.hotkeys[combo] || h.desc };
      });
    }

    if (EN.footer) {
      FOOTER = {
        columns: FOOTER.columns.map(function (col) {
          return {
            title: EN.footer[col.key] || col.title,
            links: col.links.map(function (l) {
              var feature = EN.features && EN.features[l.key];
              return {
                label: (feature && feature.label) || EN.footer[l.key] || l.label,
                href: enHref(l.href),
                external: l.external
              };
            })
          };
        }),
        legal: EN.footer.legal || FOOTER.legal,
        copyright: FOOTER.copyright
      };
    }

    if (EN.channels) {
      CHANNELS = CHANNELS.map(function (ch) {
        var t = EN.channels[ch.id];
        if (!t) return ch;
        var copy = {};
        Object.keys(ch).forEach(function (k) { copy[k] = ch[k]; });
        copy.label = t.label || ch.label;
        copy.desc = t.desc || ch.desc;
        if (ch.id === 'android') copy.url = '/en/download.html#android';
        return copy;
      });
    }

    if (EN.faq) FAQ = EN.faq;

    SITE.description =
      'ShortCut is a Windows desktop efficiency tool: quick launch, task wall and the SC Ball island,' +
      ' plus phone interconnect (task sync, file transfer, phone control).';
    SITE.tagline = 'Everything in one place, one keystroke away';
  }
  /* ── 导出 ─────────────────────────────────────────────────────────────── */
  global.SC_DATA = {
    SITE: SITE,
    NAV: NAV,
    FEATURES: FEATURES,
    CHANNELS: CHANNELS,
    FALLBACK_VERSION: FALLBACK_VERSION,
    CHANGELOG: CHANGELOG,
    HOTKEYS: HOTKEYS,
    FAQ: FAQ,
    FOOTER: FOOTER
  };
})(window);
