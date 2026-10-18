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
    tagline: '集中启动，一键直达；SC球常驻，效率升级',
    description: 'Windows 桌面效率工具：快捷启动、任务墙、SC球灵动岛、文件转换、截图翻译，' +
      '并可与手机联动（任务同步、文件快传、手机控电脑）。',
    // 与桌面产品主色一致（src/index.css: --color-accent）
    themeColor: '#0b0e14',
    accent: '#e85d04',
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
      tagline: '手机与电脑互传文件文本，不登录不上传第三方',
      href: '/features/transfer.html',
      points: ['分片上传大文件', '有效期自动清理', '生成分享链接', '哈希校验']
    },
    {
      id: 'android', label: '安卓端', icon: 'android',
      tagline: '原生 Kotlin 客户端，与桌面端同一套账号与契约',
      href: '/features/android.html',
      points: ['原生界面', '应用内更新', '局域网直连', '设备绑定']
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
      id: 'gitee', label: 'Gitee', icon: 'gitee',
      desc: '源码仓库 · Release 归档',
      url: 'https://gitee.com/wanan6/short-cut'
    },
    {
      id: 'github', label: 'GitHub', icon: 'github',
      desc: '源码仓库',
      url: 'https://github.com/3264156243/shortcut',
      // 仓库当前为私有；后期转公开后把 note 置空即可
      note: '私有仓库，暂不开放'
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
        '修复「检查更新」永远失败（旧实现读取 Electron 期清单且缺少成功标记）',
        '修复更新进度条不动（事件字段名与前端不一致）',
        '检查更新改用 Tauri 官方更新器，按 available / not-available 返回'
      ]
    },
    {
      version: '2.5.0', date: '2026-10-17',
      items: [
        'Tauri 2 重构后首个正式版，Electron 版正式退役',
        '支持从旧版应用内自动迁移到 Tauri 版',
        '修复发版级问题：实例守卫误判自身、侧车资源依赖构建机路径',
        '穿透快捷键改为 Alt+B'
      ]
    },
    {
      version: '2.4.6', date: '2026-09-30',
      items: ['Tauri 2 重构版首个对外版本，体积 -94%、内存 -30%', '岛设置全面生效，功能全量对齐']
    },
    {
      version: '2.4.5', date: '2026-09-29',
      items: ['新增「控制」板块：手机远程控制电脑（云端 + 局域网）', '文件快传哈希校验与过期清理']
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
        { q: '支持哪些系统？', a: 'Windows 10 / 11（64 位）。需要 WebView2 运行时，Windows 11 已自带。' },
        { q: '安装时提示「未知发布者」怎么办？', a: '当前安装包未做代码签名，Windows SmartScreen 会提示未知发布者。点击「更多信息 → 仍要运行」即可。更新包本身有签名校验，不会被替换。' },
        { q: '安装新版本会丢失任务和快捷方式吗？', a: '不会。配置存放在 %APPDATA%\\ShortCut\\shortcut\\config.json，与安装目录分离，覆盖安装不会影响数据；每次写入还会保留最近 3 份备份。' },
        { q: '如何检查更新？', a: '打开主面板进入「更新」页，点击检查更新。发现新版本后会展示版本号与更新说明，由你确认后才下载。' },
        { q: '为什么旧版本（2.4.x 及更早）的检查更新会失败？', a: '旧实现读取的是 Electron 时期留下的清单文件，且缺少成功标记，导致无论有没有新版本都显示失败。该问题已在 2.5.1 修复；旧版本需要手动下载一次 2.5.1 安装包，之后即可正常自动更新。' }
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
        { q: '手机钉的任务桌面端离线了会丢吗？', a: '不会。任务先存放在你自己的服务器队列里，桌面端上线后自动接收。桌面端离线时手机端会提示「已排队」。' },
        { q: '文件快传的文件存在哪？', a: '存在你自己部署的服务端，按有效期自动清理；不经过任何第三方网盘。' }
      ]
    },
    {
      group: '隐私与数据',
      items: [
        { q: '数据会上传到网络吗？', a: '快捷方式、任务墙、使用记录等桌面数据全部保存在本机。只有你主动使用移动互联功能（任务同步、文件快传、手机控电脑）时，数据才会经你自己的服务器传输。' },
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
              return { label: EN.footer[l.key] || l.label, href: enHref(l.href), external: l.external };
            })
          };
        }),
        legal: EN.footer.legal || FOOTER.legal,
        copyright: FOOTER.copyright
      };
    }

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
