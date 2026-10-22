// Public product copy. Each field is [Simplified Chinese, English].
// Keep claims tied to features implemented in the desktop and mobile clients.
export const features = [
  {
    id: 'shortcut', icon: 'grid', name: ['快捷启动', 'Quick Launch'], number: '01',
    title: ['想打开的，<br>一按就到。', 'Your next move.<br>One key away.'],
    intro: ['软件、文件、网页，放进一个顺手的面板。少找一会儿图标，多留一点专注。', 'Apps, files and websites in one familiar panel. Less hunting for icons. More time for what you came to do.'],
    story: ['从想起，到打开。', 'From thought to open.'],
    storyText: ['按下 Alt + Space 唤出面板，输入名称找到入口，再用回车启动。常用工作可以收进快捷方式组，一起打开。', 'Bring up the panel with Alt + Space, find an entry by name and press Enter. Group the tools for a regular workflow and open them together.'],
    steps: [['唤出面板', 'Bring it up'], ['搜索或选择', 'Find your entry'], ['回车启动', 'Press Enter']],
    details: [
      [['入口，都收进来', 'One home for your shortcuts'], ['应用、文件夹、文件、网页，还包括快捷方式组与 BAT 脚本。', 'Apps, folders, files, websites, shortcut groups and BAT scripts.']],
      [['按自己的习惯排列', 'Arrange it your way'], ['分组、页签、拖拽排序。工作和生活可以各占一页。', 'Groups, tabs and drag-to-reorder. Give work and personal shortcuts their own space.']],
      [['不必从零整理', 'A quicker start'], ['批量导入已安装的软件，自动提取图标，也能手动替换。', 'Import installed apps in bulk, extract their icons automatically or choose your own.']],
      [['键盘一直在手边', 'Keep your hands on the keys'], ['按名称、路径或备注查找，方向键移动焦点，回车打开。', 'Search names, paths or notes. Move with arrow keys and launch with Enter.']]
    ]
  },
  {
    id: 'taskwall', icon: 'sticky', name: ['任务墙', 'Task Wall'], number: '02',
    title: ['把事情写下来，<br>把脑袋空出来。', 'Put it on the wall.<br>Get it off your mind.'],
    intro: ['一句待办、一段想法、一个提醒。像贴纸条一样，把它们放在眼前。', 'A quick task, a longer thought, a timely reminder. Pin them where you can see them.'],
    story: ['每张纸条，都有自己的节奏。', 'A little room for every thought.'],
    storyText: ['简短任务直接写，细节展开补充，需要记住的事再设提醒。工作、生活和临时想法，放进不同的墙。', 'Keep quick tasks short, expand a note for the details and add a reminder when time matters. Separate walls keep work, life and passing ideas organised.'],
    steps: [['写下一件事', 'Write it down'], ['补正文或提醒', 'Add detail or a reminder'], ['完成，放下', 'Finish and move on']],
    details: [
      [['不止一面墙', 'More than one wall'], ['为项目、生活或临时灵感单独命名，切换时思路也跟着切换。', 'Name a wall for a project, personal tasks or passing ideas. Switch walls as you switch context.']],
      [['短事短写，长事展开', 'A little or a lot'], ['长文本和待办提醒按需开启，双击纸条就能再次编辑。', 'Enable long-form notes and reminders when needed. Double-click a note to edit it again.']],
      [['到时间，递到眼前', 'A timely nudge'], ['SC球展示任务提醒，可直接查看任务或标记完成。', 'SC Ball brings up your reminder so you can view the task or mark it complete.']],
      [['手机上先记一笔', 'Catch it on your phone'], ['绑定后从手机钉入任务；电脑离线时先排队，重新连接后接收。', 'Pair your phone and pin a task remotely. Tasks queue while the PC is offline and arrive when it reconnects.']]
    ]
  },
  {
    id: 'scball', icon: 'island', name: ['SC球', 'SC Ball'], number: '03',
    title: ['小小一颗，<br>刚好在你需要时。', 'A little presence.<br>Right when you need it.'],
    intro: ['音乐、待办、电脑状态，收在桌面上的小球里。想看时展开，专注时收起。', 'Music, tasks and system stats in a little desktop companion. Expand for a glance. Collapse to focus.'],
    story: ['存在感，由你决定。', 'As present as you want it to be.'],
    storyText: ['收起、迷你、展开，适应不同的工作状态。开启鼠标穿透后，桌面操作照常进行；也可以随时隐藏。', 'Collapsed, mini or expanded: choose what fits the moment. Click-through lets you work with the desktop underneath, and you can hide it at any time.'],
    steps: [['收起，留出空间', 'Collapse for space'], ['展开，看一眼', 'Expand for a glance'], ['隐藏，继续专注', 'Hide and focus']],
    details: [
      [['正在听的，就在这里', 'Your music, close by'], ['展示网易云音乐的封面、歌词与进度，支持播放控制。', 'See NetEase Cloud Music artwork, lyrics and progress, with playback controls close by.']],
      [['任务不用藏进后台', 'Tasks stay in view'], ['查看到时提醒，或把重要的事放进常驻任务清单球。', 'See due reminders or keep important tasks in the persistent task-list ball.']],
      [['电脑状态，抬眼就看', 'A glance at your PC'], ['查看 CPU、GPU、内存占用与温度；可用数据取决于硬件支持。', 'See CPU, GPU and memory usage and temperatures. Available readings depend on your hardware.']],
      [['只留下想看的', 'Only what you need'], ['音乐、任务、驾驶舱、余额模块分别开关，按自己的桌面习惯组合。', 'Toggle music, tasks, system stats and balance modules separately to suit your desktop.']]
    ]
  },
  {
    id: 'control', icon: 'phone', name: ['手机控电脑', 'Phone Control'], number: '04',
    title: ['手边的手机，<br>也是电脑的遥控器。', 'Your phone.<br>Your PC remote.'],
    intro: ['打字、移动光标、传递剪贴板。离开键盘，也能接着操作电脑。', 'Type, move the pointer and share the clipboard. Keep your PC within reach, even away from the keyboard.'],
    story: ['连接好，就能接着做。', 'Pair once. Pick up where you are.'],
    storyText: ['在电脑开启控制功能，用手机完成绑定，再选择适合当前网络的连接方式。电脑需要保持运行并在线。', 'Enable control on your PC, pair your phone and choose the connection that fits your network. The PC needs to stay running and online.'],
    steps: [['电脑开启控制', 'Enable PC control'], ['手机绑定设备', 'Pair your phone'], ['连接后操作', 'Connect and control']],
    details: [
      [['触控板就在屏幕上', 'A trackpad on your screen'], ['通过手机移动光标、点击和滚动，临时操作不用回到桌前。', 'Move, click and scroll from your phone for quick actions away from your desk.']],
      [['长句子，也能输入', 'Type without the keyboard'], ['手机键盘输入文字，也可以发送常用组合键。', 'Enter text with your phone keyboard or send common key combinations.']],
      [['剪贴板接得上', 'Bring your clipboard along'], ['在手机和电脑之间传递文字，不必绕到聊天软件。', 'Move text between your phone and PC without sending it through a chat app.']],
      [['两种连接方式', 'Two ways to connect'], ['同一 Wi-Fi 可直连；不同网络可用云端连接，状态在手机上可见。', 'Connect directly on the same Wi-Fi or use the cloud connection across networks. Your phone shows the connection status.']]
    ]
  },
  {
    id: 'transfer', icon: 'send', name: ['文件快传', 'File Transfer'], number: '05',
    title: ['从这一块屏幕，<br>到另一块屏幕。', 'From this screen.<br>To that screen.'],
    intro: ['文件和文字，在手机与电脑之间顺手传递。少一次找线，少一次转发。', 'Move files and text between your phone and PC. One less cable to find. One less message to forward.'],
    story: ['选好，发出，在另一端领取。', 'Choose. Send. Pick it up.'],
    storyText: ['在快传板块选择文件或输入文字，按需设置分享时间，然后在另一台设备打开领取入口。', 'Choose files or enter text in File Transfer, set the sharing period and open the receive link on your other device.'],
    steps: [['选文件或文字', 'Choose files or text'], ['设置分享时间', 'Set the sharing period'], ['另一端领取', 'Receive on another device']],
    details: [
      [['文件和文字都能发', 'Files and text'], ['照片、文档或一段临时文字，都有直接的传递入口。', 'Send a photo, a document or a quick piece of text through the same simple flow.']],
      [['双向传递', 'Both directions'], ['从电脑发到手机，也可以把手机上的内容送回电脑。', 'Send from your PC to your phone, or bring something from your phone back to the PC.']],
      [['分享时间自己定', 'Choose how long to share'], ['按照需要选择有效时间，过期内容由服务清理。', 'Choose an expiry period to suit the task. Expired content is cleared by the service.']],
      [['不必注册网盘账号', 'No storage account needed'], ['使用 ShortCut 的传递入口；联网后即可发送与领取。', 'Use the ShortCut transfer flow to send and receive while online, without a separate storage account.']]
    ]
  },
  {
    id: 'android', icon: 'android', name: ['安卓端', 'Android'], number: '06',
    title: ['离开桌面，<br>事情依然接得上。', 'Away from your desk.<br>Still connected.'],
    intro: ['记下一件事，传一个文件，连回自己的电脑。把 ShortCut 放进口袋。', 'Capture a task, move a file or connect back to your PC. Take a little of your desktop with you.'],
    story: ['手机与电脑，各做擅长的事。', 'Two screens. One continuous workflow.'],
    storyText: ['手机负责随手记，电脑负责继续处理。绑定设备后，在安卓端打开任务墙、快传和电脑控制；临时使用也有移动网页入口。', 'Catch things on your phone and continue on your PC. Pair a device to access Task Wall, File Transfer and PC Control. Mobile web pages are also available for occasional use.'],
    steps: [['安装安卓端', 'Install on Android'], ['绑定你的电脑', 'Pair your PC'], ['打开需要的功能', 'Choose what you need']],
    details: [
      [['想法出现时，就记下来', 'Catch an idea as it happens'], ['在手机钉入任务，回到电脑后继续整理。', 'Pin a task on your phone, then organise it when you get back to the PC.']],
      [['照片和文件，直接送过去', 'Send it straight across'], ['从手机发送内容，也能领取电脑分享的文件。', 'Send content from your phone and receive files shared from your computer.']],
      [['电脑操作，随手接管', 'Keep your PC within reach'], ['通过手机键盘和触控板完成临时操作。', 'Handle quick actions with the phone keyboard and trackpad.']],
      [['偶尔用，浏览器也可以', 'A browser works too'], ['移动网页提供任务墙、快传与控制入口，不必每次都安装应用。', 'Mobile web pages offer Task Wall, transfer and control without requiring an app installation every time.']]
    ]
  }
];

export const pageCopy = {
  download: {name: ['下载', 'Download'], title: ['让顺手，成为日常。', 'Make room for a better flow.'], intro: ['从 Windows 桌面开始，再把手机接进来。', 'Start on your Windows desktop. Bring your phone along.']},
  changelog: {name: ['更新日志', 'Changelog'], title: ['每一次，都更顺手。', 'A little better. Every release.'], intro: ['新增了什么，改进了哪里，修好了哪些问题。每一次变化，都留在这里。', 'What is new, what works better and what has been fixed. A clear record of every step forward.']},
  faq: {name: ['常见问题', 'Help & FAQ'], title: ['少一点疑问，<br>多一点顺手。', 'Find your answer.<br>Get back to it.'], intro: ['从安装到日常使用，常遇到的问题整理在这里。', 'From getting set up to everyday use, find the answers you are looking for.']},
  feedback: {name: ['问题反馈', 'Feedback'], title: ['你的体验，<br>是下一次改进的起点。', 'Your experience.<br>Our next improvement.'], intro: ['告诉我们哪里不顺手。公开留言、处理状态和管理员回复，都能在这里查看。', 'Tell us what could work better. Follow public messages, their status and replies here.']}
};
