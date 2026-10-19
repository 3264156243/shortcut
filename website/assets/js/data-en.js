/**
 * 英文界面数据（自动生成，请勿手改）
 * ---------------------------------------------------------------------------
 * 生成：node scripts/gen-en.mjs
 * 使用：仅英文页面引入；data.js 在 <html lang="en"> 时套用它
 */
window.SC_EN = {
  "nav": [
    {
      "id": "home",
      "label": "Home",
      "href": "/"
    },
    {
      "id": "features",
      "label": "Features",
      "href": "/features/shortcut.html",
      "children": [
        {
          "label": "Quick Launch",
          "href": "/features/shortcut.html"
        },
        {
          "label": "Task Wall",
          "href": "/features/taskwall.html"
        },
        {
          "label": "SC Ball",
          "href": "/features/scball.html"
        },
        {
          "label": "Phone Control",
          "href": "/features/control.html"
        },
        {
          "label": "File Transfer",
          "href": "/features/transfer.html"
        },
        {
          "label": "Android App",
          "href": "/features/android.html"
        }
      ]
    },
    {
      "id": "download",
      "label": "Download",
      "href": "/download.html"
    },
    {
      "id": "changelog",
      "label": "Changelog",
      "href": "/changelog.html"
    },
    {
      "id": "faq",
      "label": "FAQ",
      "href": "/faq.html"
    },
    {
      "id": "feedback",
      "label": "Feedback",
      "href": "/feedback.html"
    }
  ],
  "features": {
    "shortcut": {
      "label": "Quick Launch",
      "tagline": "Apps, files, folders and links in one place, launched by keyboard",
      "points": [
        "Global hotkey",
        "Automatic icons",
        "Import installed apps",
        "Tabs and groups"
      ]
    },
    "taskwall": {
      "label": "Task Wall",
      "tagline": "Sticky-note tasks — pinned means remembered",
      "points": [
        "Multiple walls",
        "Long text and reminders",
        "Pin from phone",
        "Two-way completion"
      ]
    },
    "scball": {
      "label": "SC Ball",
      "tagline": "A small island: music, tasks and system stats in one pill",
      "points": [
        "Three states",
        "Music cover and lyrics",
        "Hardware stats",
        "DeepSeek balance"
      ]
    },
    "control": {
      "label": "Phone Control",
      "tagline": "Your phone as keyboard and trackpad, from any network",
      "points": [
        "Cloud relay",
        "Direct LAN",
        "Clipboard",
        "Key combos"
      ]
    },
    "transfer": {
      "label": "File Transfer",
      "tagline": "Move files between phone and PC without third-party clouds",
      "points": [
        "Chunked upload",
        "Auto expiry",
        "Share links",
        "Hash checks"
      ]
    },
    "android": {
      "label": "Android App",
      "tagline": "The ShortCut experience, made for your phone",
      "points": [
        "Made for Android",
        "In-app updates",
        "Direct LAN",
        "Device pairing"
      ]
    }
  },
  "hotkeys": {
    "Alt+Space": "Show / hide the main panel",
    "Alt+B": "Toggle SC Ball click-through",
    "Alt+I": "Show / hide SC Ball",
    "Alt+U": "Show / hide SC task-list ball",
    "Alt+E": "Translate selected text",
    "Alt+S": "Capture the full screen to clipboard",
    "Alt+D": "Capture a screen region",
    "Alt+Z": "Previous track",
    "Alt+X": "Play / pause",
    "Alt+C": "Next track",
    "长按 Space 0.5 秒": "Hold Space for 0.5 s to cycle modules",
    "Z / X": "Previous / next module"
  },
  "channels": {
    "server": {
      "label": "Official download",
      "desc": "Latest version · speed depends on your connection"
    },
    "lanzou": {
      "label": "Lanzou Cloud",
      "desc": "Usually fast in mainland China · access code required"
    },
    "android": {
      "label": "Android APK",
      "desc": "Mobile installer · pair with your desktop by QR code"
    }
  },
  "faq": [
    {
      "group": "Installation and updates",
      "items": [
        {
          "q": "Which versions of Windows are supported?",
          "a": "Windows 10 and Windows 11, 64-bit. Windows 11 works out of the box; on some Windows 10 PCs the installer will prompt for a required component."
        },
        {
          "q": "What should I do about the “unknown publisher” warning?",
          "a": "The installer does not have a Windows digital signature yet, so SmartScreen may show an unknown publisher. Choose “More info → Run anyway”. Updates are still checked before installation."
        },
        {
          "q": "Will installing a new version remove my tasks or shortcuts?",
          "a": "No. Shortcuts, tasks and settings are preserved during an upgrade, and ShortCut keeps the three most recent local backups."
        },
        {
          "q": "How do I check for updates?",
          "a": "Open the main panel, go to Updates and choose Check for updates. If a new version is available, ShortCut shows its version and release notes and waits for your confirmation before downloading."
        },
        {
          "q": "What if a very old version cannot check for updates?",
          "a": "Versions 2.4.x and earlier may not be able to update in-app. Download 2.5.1 or a newer build once and install it over the old version; your data will be preserved."
        }
      ]
    },
    {
      "group": "Using ShortCut",
      "items": [
        {
          "q": "Can I add web links?",
          "a": "Yes. Shortcuts support apps, folders, files, URLs, shortcut groups and BAT scripts."
        },
        {
          "q": "Why do some apps show a generic icon?",
          "a": "Icons are read from each program’s own resources. If an icon is packed into a special library or format, ShortCut falls back to a generic icon; you can also choose an icon file manually."
        },
        {
          "q": "What if a global hotkey conflicts with another app?",
          "a": "You can change global hotkeys in Settings. ShortCut also tells you when Windows cannot register a shortcut."
        }
      ]
    },
    {
      "group": "Phone interconnect",
      "items": [
        {
          "q": "What do I need for phone control?",
          "a": "In cloud mode the desktop only needs to stay running, and the phone can connect from any network. On the same Wi-Fi, direct LAN mode gives lower latency."
        },
        {
          "q": "Will a task disappear if my desktop is offline?",
          "a": "No. The task waits in a secure relay queue and is delivered when the desktop comes back online. The phone shows when it is queued."
        },
        {
          "q": "Where are files kept during file transfer?",
          "a": "Files are kept only until the share expires, then cleaned up automatically. They never pass through a third-party cloud drive."
        }
      ]
    },
    {
      "group": "Privacy and data",
      "items": [
        {
          "q": "Does my data go to the internet?",
          "a": "Shortcuts, task walls and usage history stay on your computer. Only when you actively use phone interconnect (task sync, file transfer or phone control) does data move through ShortCut’s secure link."
        },
        {
          "q": "Do I need an account?",
          "a": "The desktop app is activated with an activation code; phone interconnect is paired with a binding code. No account registration is required."
        }
      ]
    },
    {
      "group": "Android app",
      "items": [
        {
          "q": "What is the difference between the Android app and the mobile site?",
          "a": "The Android app supports in-app updates, direct LAN connection and system notifications. The mobile site opens in any browser without installation."
        },
        {
          "q": "How do I update the Android app?",
          "a": "Use Check for updates inside the app, or download the latest APK from this site."
        }
      ]
    }
  ],
  "footer": {
    "product": "Product",
    "features": "Features",
    "repos": "Repositories",
    "download": "Download",
    "changelog": "Changelog",
    "faq": "FAQ",
    "feedback": "Feedback",
    "overview": "Feature overview",
    "legal": "Proprietary software · All rights reserved",
    "note": "This site is bilingual. Release notes are recorded in Chinese."
  }
};
