<?php

session_start();
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['adminPassword'])) {
    if ($_POST['adminPassword'] === $ADMIN_PASSWORD) {
        $_SESSION['admin'] = true;
        header('Location: index.php');
        exit;
    }
    $loginError = '管理员密码错误';
}

if (isset($_GET['logout'])) {
    $_SESSION['admin'] = false;
    session_destroy();
    header('Location: index.php');
    exit;
}

$loggedIn = !empty($_SESSION['admin']);
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ShortCut 激活管理</title>
  <style>
    :root {
      --bg: #0e121a;
      --panel: #171d29;
      --panel-2: #1d2534;
      --panel-3: #232c3d;
      --border: #2b3649;
      --text: #e9edf5;
      --text-2: #b6c0d0;
      --muted: #7f8a9d;
      --accent: #4f8cff;
      --accent-soft: rgba(79, 140, 255, 0.16);
      --green: #36cf8a;
      --red: #ff5c5c;
      --amber: #f5b84b;
      --radius: 10px;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      font-family: "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
    }
    button, input { font-family: inherit; }
    input:focus, button:focus { outline: none; }

    .login-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background:
        radial-gradient(600px 300px at 20% 10%, rgba(79,140,255,.12), transparent 60%),
        radial-gradient(500px 320px at 85% 85%, rgba(54,207,138,.08), transparent 60%),
        var(--bg);
    }
    .login-card {
      width: 100%;
      max-width: 380px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px 26px;
      box-shadow: 0 24px 60px rgba(0,0,0,.4);
    }
    .login-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 22px;
    }
    .login-logo {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent), #7b5cff);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 800;
      font-size: 18px;
      letter-spacing: 0;
    }
    .login-brand h1 { margin: 0; font-size: 18px; font-weight: 700; }
    .login-brand span { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; }

    .label {
      display: block;
      font-size: 12px;
      color: var(--muted);
      margin: 0 0 7px;
    }
    .text-input {
      width: 100%;
      height: 38px;
      padding: 0 12px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      font-size: 14px;
    }
    .text-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    textarea.text-input { height: auto; padding: 10px 12px; resize: vertical; }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 36px;
      padding: 0 14px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--panel-3);
      color: var(--text);
      font-size: 13px;
      cursor: pointer;
      transition: border-color .15s, background .15s, transform .05s;
      pointer-events: auto !important;
      white-space: nowrap;
    }
    .btn:hover { border-color: #3d4b63; background: #2a3550; }
    .btn:active { transform: translateY(1px); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn.primary:hover { background: #3f7cf5; }
    .btn.danger { background: rgba(255,92,92,.12); border-color: rgba(255,92,92,.4); color: #ff8585; }
    .btn.danger:hover { background: rgba(255,92,92,.22); border-color: var(--red); }
    .btn.ghost { background: transparent; }
    .btn.small { height: 30px; padding: 0 10px; font-size: 12px; border-radius: 8px; }

    .app { display: flex; min-height: 100vh; }
    .sidebar {
      width: 204px;
      flex: 0 0 204px;
      background: #121724;
      border-right: 1px solid var(--border);
      padding: 22px 14px;
      position: sticky;
      top: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 8px 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .brand-logo {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--accent), #7b5cff);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 800;
    }
    .brand strong { display: block; font-size: 15px; }
    .brand small { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }
    .nav { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 40px;
      padding: 0 12px;
      border: 1px solid transparent;
      border-radius: var(--radius);
      background: transparent;
      color: var(--text-2);
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: all .15s;
    }
    .nav-item:hover { background: var(--panel-2); color: var(--text); }
    .nav-item.active { background: var(--accent-soft); border-color: rgba(79,140,255,.35); color: #9dbaff; }
    .nav-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--muted);
      flex: 0 0 7px;
    }
    .nav-item.active .nav-dot { background: var(--accent); }

    .main { flex: 1; min-width: 0; padding: 24px 28px 40px; }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .topbar h1 { margin: 0; font-size: 20px; font-weight: 700; }
    .topbar p { margin: 5px 0 0; color: var(--muted); font-size: 12px; }
    .top-actions { display: flex; align-items: center; gap: 10px; }

    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 18px;
    }
    .card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .card-head h2 { margin: 0; font-size: 15px; font-weight: 700; }
    .card-head p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }

    .row-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 0;
      border-top: 1px solid #202a3a;
    }
    .row-line:first-child { border-top: 0; }
    .row-text strong { display: block; font-size: 14px; font-weight: 600; }
    .row-text small { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; max-width: 620px; line-height: 1.6; }

    .switch {
      width: 46px;
      height: 25px;
      border-radius: 999px;
      border: 1px solid #3a4a60;
      background: #2a3447;
      position: relative;
      cursor: pointer;
      transition: background .18s, border-color .18s;
      flex: 0 0 46px;
      pointer-events: auto !important;
    }
    .switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 3px;
      width: 19px;
      height: 19px;
      border-radius: 50%;
      background: #8b96a8;
      transition: left .18s, background .18s;
    }
    .switch.on { background: var(--accent); border-color: var(--accent); }
    .switch.on::after { left: 22px; background: #fff; }
    .switch.off { background: #2a3447; }

    .toolbar { display: flex; align-items: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .save-status {
      display: inline-flex;
      align-items: center;
      height: 30px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .save-status.pending, .save-status.saving { color: var(--amber); border-color: rgba(245,184,75,.35); }
    .save-status.saved { color: var(--green); border-color: rgba(54,207,138,.32); }
    .save-status.bad { color: var(--red); border-color: rgba(255,92,92,.4); }
    #message {
      min-height: 22px;
      margin-bottom: 14px;
      font-size: 13px;
      padding: 0 2px;
    }
    #message.ok { color: var(--green); }
    #message.bad { color: var(--red); }
    #message.muted { color: var(--muted); }

    .select-wrap { position: relative; display: inline-block; min-width: 168px; width: 100%; }
    .select-view {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      height: 38px;
      padding: 0 12px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      font-size: 13px;
      cursor: pointer;
      pointer-events: auto !important;
    }
    .select-view:hover { border-color: #3d4b63; }
    .select-arrow {
      width: 8px;
      height: 8px;
      border-right: 2px solid var(--muted);
      border-bottom: 2px solid var(--muted);
      transform: rotate(45deg) translateY(-2px);
      transition: transform .15s;
      flex: 0 0 8px;
    }
    .select-wrap.open .select-arrow { transform: rotate(-135deg) translateY(-2px); }
    .select-menu {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      z-index: 80;
      background: #1b2433;
      border: 1px solid #344158;
      border-radius: 12px;
      box-shadow: 0 18px 42px rgba(0,0,0,.45);
      padding: 5px;
      max-height: 230px;
      overflow-y: auto;
    }
    .select-wrap.open .select-menu { display: block; }
    .select-option {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      border: 0;
      border-radius: 8px;
      color: var(--text-2);
      font-size: 13px;
      padding: 9px 10px;
      cursor: pointer;
    }
    .select-option:hover { background: var(--panel-3); color: var(--text); }
    .select-option.selected { background: var(--accent-soft); color: #9dbaff; }

    .group-card {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .group-head {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .group-name-input { width: 190px; flex: 0 0 190px; height: 36px; }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 11px;
      background: var(--panel-3);
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .badge.system { background: rgba(245,184,75,.1); border-color: rgba(245,184,75,.32); color: var(--amber); }
    .perm-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(205px, 1fr));
      gap: 8px;
      margin-top: 14px;
    }
    .perm-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: var(--panel);
      border: 1px solid #222c3e;
      border-radius: 9px;
      padding: 8px 10px;
      font-size: 12px;
      color: var(--text-2);
    }
    .perm-row .switch { width: 38px; height: 21px; flex-basis: 38px; }
    .perm-row .switch::after { width: 15px; height: 15px; top: 2px; left: 2px; }
    .perm-row .switch.on::after { left: 19px; }
    .perm-row-feature {
      margin-left: 22px;
      padding: 6px 10px;
      font-size: 11px;
      opacity: .92;
      border-color: #263349;
      border-style: dashed;
      background: rgba(28, 38, 58, .35);
    }

    .generate-grid {
      display: grid;
      grid-template-columns: 180px minmax(190px, 240px) auto;
      gap: 14px;
      align-items: end;
      max-width: 620px;
    }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 940px; }
    th, td {
      text-align: left;
      padding: 11px 9px;
      border-bottom: 1px solid #202a3a;
      vertical-align: middle;
    }
    th { color: var(--muted); font-weight: 500; font-size: 12px; white-space: nowrap; }
    td { color: var(--text-2); }
    .code-text { font-family: Consolas, monospace; color: #a9c0ff; font-size: 12px; white-space: nowrap; }
    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 11px;
      background: var(--accent-soft);
      border: 1px solid rgba(79,140,255,.3);
      color: #9dbaff;
      white-space: nowrap;
    }
    .status-text { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
    .status-text .switch { width: 38px; height: 21px; flex-basis: 38px; }
    .status-text .switch::after { width: 15px; height: 15px; top: 2px; left: 2px; }
    .status-text .switch.on::after { left: 19px; }
    .ok { color: var(--green); }
    .bad { color: var(--red); }
    .muted { color: var(--muted); }
    .actions { display: flex; gap: 6px; }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
    }
    .stat-card {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }
    .stat-card strong {
      display: block;
      font-size: 24px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 6px;
    }
    .stat-card span {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }
    .modal.modal-wide { width: 780px; }
    .truncate-cell {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-block {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .detail-block h4 {
      margin: 0 0 10px;
      font-size: 13px;
      color: var(--text);
    }

    .modal-mask {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(5,8,14,.66);
      backdrop-filter: blur(4px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 20px;
      pointer-events: auto;
    }
    .modal-mask.show { display: flex; }
    .modal {
      width: 430px;
      max-width: 100%;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 22px;
      box-shadow: 0 26px 70px rgba(0,0,0,.5);
      max-height: calc(100vh - 60px);
      overflow-y: auto;
    }
    .modal h3 { margin: 0 0 16px; font-size: 16px; }
    .modal .field { margin-bottom: 15px; }
    .modal .row-line { padding: 10px 0; }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 18px;
    }
    .code-stamp {
      font-family: Consolas, monospace;
      background: var(--panel-2);
      border: 1px dashed #3d5578;
      border-radius: 9px;
      color: #a9c0ff;
      font-size: 13px;
      padding: 10px 12px;
      margin-bottom: 16px;
      word-break: break-all;
      user-select: all;
    }

    .tab-page { display: none; }
    .tab-page.active { display: block; }

    @media (max-width: 860px) {
      .sidebar { width: 64px; flex-basis: 64px; padding: 18px 10px; }
      .brand { justify-content: center; padding: 0 0 14px; }
      .brand-text, .nav-item { font-size: 0; }
      .nav-item { justify-content: center; padding: 0; }
      .main { padding: 18px 14px 32px; }
      .generate-grid { grid-template-columns: 1fr; }
      .group-name-input { flex-basis: 100%; width: 100%; }
    }
  </style>
</head>
<body>
<?php if (!$loggedIn): ?>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-logo">SC</div>
        <div>
          <h1>ShortCut 激活管理</h1>
          <span>登录后管理授权策略与激活码</span>
        </div>
      </div>
      <?php if (!empty($loginError)): ?>
        <div id="loginError" style="color:var(--red); font-size:13px; margin-bottom:12px;"><?php echo htmlspecialchars($loginError); ?></div>
      <?php endif; ?>
      <form method="post" autocomplete="off">
        <label class="label" for="adminPassword">管理员密码</label>
        <input class="text-input" type="password" id="adminPassword" name="adminPassword" autocomplete="current-password" required autofocus />
        <button class="btn primary" type="submit" style="width:100%; margin-top:16px; height:40px;">登录</button>
      </form>
    </div>
  </div>
<?php else: ?>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">SC</div>
        <div class="brand-text">
          <strong>ShortCut</strong>
          <small>激活管理后台</small>
        </div>
      </div>
      <nav class="nav">
        <button class="nav-item active" data-tab="dashboard">
          <span class="nav-dot"></span><span class="nav-label">用户看板</span>
        </button>
        <button class="nav-item" data-tab="policy">
          <span class="nav-dot"></span><span class="nav-label">授权开关</span>
        </button>
        <button class="nav-item" data-tab="groups">
          <span class="nav-dot"></span><span class="nav-label">用户分组</span>
        </button>
        <button class="nav-item" data-tab="codes">
          <span class="nav-dot"></span><span class="nav-label">激活码</span>
        </button>
      </nav>
      <div style="padding:14px 0 6px; border-top:1px solid var(--border);">
        <a class="btn ghost small" style="width:100%; justify-content:center; text-decoration:none; color:var(--muted);" href="index.php?logout=1">退出登录</a>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <h1 id="pageTitle">用户看板</h1>
          <p id="pageSubtitle">查看所有打开过软件的设备，包括未激活用户</p>
        </div>
        <div class="top-actions">
          <span class="save-status" id="saveStatus">已自动保存</span>
          <button class="btn" onclick="refresh()">刷新</button>
        </div>
      </header>
      <div id="message" class="muted"></div>

      <section class="tab-page" id="tab-policy">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>激活策略</h2>
              <p>控制整个软件的授权入口，以及未激活用户能访问哪些板块。</p>
            </div>
          </div>
          <div class="row-line">
            <div class="row-text">
              <strong>激活才可使用</strong>
              <small>开启后，用户必须先填入有效激活码才能进入软件主体。</small>
            </div>
            <button class="switch off" id="requireToggle" type="button" aria-checked="false"></button>
          </div>
          <div class="row-line" id="guestRow" style="display:none;">
            <div class="row-text">
              <strong>未激活用户可用板块</strong>
              <small>开启后，未激活用户可先使用“未激活用户”分组中开放的板块，剩余板块仍需激活。</small>
            </div>
            <button class="switch off" id="guestToggle" type="button" aria-checked="false"></button>
          </div>
          <div class="row-line">
            <div class="row-text" style="flex:1;">
              <strong>获取激活码提示</strong>
              <small>显示在客户端“激活”板块底部，联系管理员获取激活码。</small>
              <input class="text-input" id="contactLineInput" maxlength="60" style="margin-top:8px;" />
            </div>
          </div>
        </div>
      </section>

      <section class="tab-page" id="tab-groups">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>用户分组</h2>
              <p>分组名称可自定义，例如免费用户、会员、企业版。生成激活码时选择分组，激活后按该分组的板块权限生效。</p>
            </div>
            <button class="btn" id="addGroupBtn">新增分组</button>
          </div>
          <div id="groupList"></div>
        </div>
      </section>

      <section class="tab-page" id="tab-codes">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>生成激活码</h2>
              <p>选择授权分组和有效天数，一键生成新激活码。</p>
            </div>
          </div>
          <div class="generate-grid">
            <div>
              <label class="label" for="genDays">有效天数</label>
              <input class="text-input" id="genDays" type="number" value="365" min="1" max="3650" />
            </div>
            <div>
              <label class="label">授权分组</label>
              <div id="genGroupSelect"></div>
            </div>
            <button class="btn primary" id="generateBtn" style="height:38px;">生成激活码</button>
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h2>激活码列表</h2>
              <p>可以直接修改分组成员、启用状态，或延长有效期，无需重新发码。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>激活码</th>
                  <th>授权分组</th>
                  <th>状态</th>
                  <th>机器码</th>
                  <th>生成时间</th>
                  <th>到期时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="codesBody"></tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="tab-page active" id="tab-dashboard">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>设备统计</h2>
              <p>基于硬件指纹、网络与启动检查记录汇总用户设备。</p>
            </div>
            <div class="actions">
              <button class="btn" onclick="askConfirm('确认清空全部使用记录吗？激活码数据仍会保留。', () => void clearLogs())">清空记录</button>
              <button class="btn danger" onclick="askConfirm('确认清空全部激活码与使用记录吗？此操作不可恢复。', () => void clearAllData())">清空全部数据</button>
            </div>
          </div>
          <div class="stat-grid" id="statGrid"></div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h2>设备列表</h2>
              <p>每一行是一台打开过软件的设备，未激活用户也会记录；点击查看可展开该设备的全部使用记录。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table id="deviceTable">
              <thead>
                <tr>
                  <th>设备指纹</th>
                  <th>激活码</th>
                  <th>用户分组</th>
                  <th>设备名</th>
                  <th>版本</th>
                  <th>最近IP</th>
                  <th>首次在线</th>
                  <th>最后在线</th>
                  <th>检查次数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="devicesBody"></tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h2>最近检查记录</h2>
              <p>客户端每次启动自动上报，未激活用户也会记录。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table id="logsTable">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>设备指纹</th>
                  <th>激活码</th>
                  <th>用户分组</th>
                  <th>设备名</th>
                  <th>版本</th>
                  <th>公网IP</th>
                  <th>局域网IP</th>
                </tr>
              </thead>
              <tbody id="logsBody"></tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  </div>

  <div class="modal-mask" id="confirmMask">
    <div class="modal">
      <h3>确认操作</h3>
      <p id="confirmText" style="color:var(--text-2); line-height:1.7; margin:0; word-break:break-all;"></p>
      <div class="modal-actions">
        <button class="btn" id="confirmCancel">取消</button>
        <button class="btn danger" id="confirmOk">确认</button>
      </div>
    </div>
  </div>

  <div class="modal-mask" id="editModal">
    <div class="modal">
      <h3>编辑激活码</h3>
      <div class="code-stamp" id="editCodeText"></div>
      <div class="field">
        <label class="label">授权分组</label>
        <div id="editGroupSelect"></div>
      </div>
      <div class="row-line">
        <div class="row-text">
          <strong>启用状态</strong>
          <small>关闭后该激活码立即失效。</small>
        </div>
        <button class="switch off" id="editStatusToggle" type="button" aria-checked="false"></button>
      </div>
      <div class="field" style="margin-top:16px;">
        <label class="label" for="editExtendDays">延长天数（续费，0 表示不变）</label>
        <input class="text-input" id="editExtendDays" type="number" value="0" min="0" max="3650" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="editCancel">取消</button>
        <button class="btn primary" id="editSave">保存修改</button>
      </div>
    </div>
  </div>

  <div class="modal-mask" id="groupModal">
    <div class="modal">
      <h3>新增用户分组</h3>
      <div class="field">
        <label class="label" for="newGroupName">分组名称</label>
        <input class="text-input" id="newGroupName" type="text" maxlength="30" placeholder="例如：企业版" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="groupModalCancel">取消</button>
        <button class="btn primary" id="groupModalOk">创建</button>
      </div>
    </div>
  </div>

  <div class="modal-mask" id="deviceModal">
    <div class="modal modal-wide">
      <h3>设备使用详情</h3>
      <div class="code-stamp" id="deviceMachineText"></div>
      <div id="deviceBindings"></div>
      <div class="table-wrap" id="deviceLogsWrap"></div>
      <div class="modal-actions">
        <button class="btn" id="deviceModalClose">关闭</button>
      </div>
    </div>
  </div>

  <script>
    const state = {
      policy: null,
      codes: [],
      dashboard: { devices: [], logs: [], stats: {} },
      deviceMachine: '',
      editRecord: null,
      editStatus: true,
      editGroupId: '',
      currentTab: 'dashboard',
      saveTimer: null,
      savingPolicy: false,
      saveQueued: false,
      policyDirty: false,
      policyVersion: 0,
    };

    const MODULE_META = {
      shortcuts: '快捷方式',
      tasks: '任务墙',
      cockpit: '驾驶舱',
      translate: '翻译',
      usage: '应用使用记录',
      island: 'SC球',
      codexProvider: 'Codex供应商',
    };

    async function api(payload) {
      const response = await fetch('api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return response.json();
    }

    function showMessage(text, ok) {
      const el = document.getElementById('message');
      el.textContent = text || '';
      el.className = ok === true ? 'ok' : (ok === false ? 'bad' : 'muted');
    }

    function makeSwitch(checked, onChange) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'switch ' + (checked ? 'on' : 'off');
      btn.setAttribute('aria-checked', checked ? 'true' : 'false');
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const next = !checked;
        checked = next;
        btn.className = 'switch ' + (next ? 'on' : 'off');
        btn.setAttribute('aria-checked', next ? 'true' : 'false');
        onChange?.(next);
      });
      return btn;
    }

    function setSwitch(btn, checked) {
      if (!btn) return;
      btn.className = 'switch ' + (checked ? 'on' : 'off');
      btn.setAttribute('aria-checked', checked ? 'true' : 'false');
    }

    function createSelect(options, value, onChange) {
      const wrap = document.createElement('div');
      wrap.className = 'select-wrap';
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'select-view';
      const label = document.createElement('span');
      const arrow = document.createElement('span');
      arrow.className = 'select-arrow';
      const menu = document.createElement('div');
      menu.className = 'select-menu';
      let current = options.find((item) => String(item.value) === String(value)) || options[0] || null;

      function setLabel() {
        label.textContent = current ? current.label : '请选择';
      }
      function close() {
        wrap.classList.remove('open');
        document.removeEventListener('pointerdown', onDocDown);
      }
      function onDocDown(event) {
        if (!wrap.contains(event.target)) close();
      }
      function renderMenu() {
        menu.innerHTML = '';
        for (const option of options) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'select-option' + (current && String(option.value) === String(current.value) ? ' selected' : '');
          btn.textContent = option.label;
          btn.addEventListener('click', (event) => {
            event.stopPropagation();
            current = option;
            setLabel();
            renderMenu();
            close();
            onChange?.(option.value);
          });
          menu.appendChild(btn);
        }
      }
      view.addEventListener('click', (event) => {
        event.stopPropagation();
        if (wrap.classList.contains('open')) {
          close();
        } else {
          renderMenu();
          wrap.classList.add('open');
          document.addEventListener('pointerdown', onDocDown);
        }
      });
      wrap.appendChild(view);
      view.appendChild(label);
      view.appendChild(arrow);
      wrap.appendChild(menu);
      wrap.setValue = (nextValue) => {
        const next = options.find((item) => String(item.value) === String(nextValue));
        if (next) {
          current = next;
          setLabel();
        }
      };
      wrap.getValue = () => (current ? current.value : '');
      setLabel();
      renderMenu();
      return wrap;
    }

    function askConfirm(text, onOk) {
      document.getElementById('confirmText').textContent = text;
      state.confirmHandler = onOk;
      document.getElementById('confirmMask').classList.add('show');
    }

    function closeConfirm() {
      document.getElementById('confirmMask').classList.remove('show');
      state.confirmHandler = null;
    }

    document.getElementById('confirmOk').addEventListener('click', () => {
      const handler = state.confirmHandler;
      closeConfirm();
      if (handler) handler();
    });
    document.getElementById('confirmCancel').addEventListener('click', closeConfirm);
    document.getElementById('confirmMask').addEventListener('click', (event) => {
      if (event.target.id === 'confirmMask') closeConfirm();
    });

    function switchTab(tab) {
      state.currentTab = tab;
      for (const btn of document.querySelectorAll('.nav-item')) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      }
      for (const page of document.querySelectorAll('.tab-page')) {
        page.classList.toggle('active', page.id === 'tab-' + tab);
      }
      const meta = {
        policy: ['授权开关', '设置是否必须激活，以及未激活用户可用范围'],
        groups: ['用户分组', '自定义身份分组，并设置每个分组的板块权限'],
        codes: ['激活码', '生成、管理激活码，支持修改分组与续期'],
        dashboard: ['用户看板', '查看所有打开过软件的设备，包括未激活用户'],
      }[tab];
      document.getElementById('pageTitle').textContent = meta[0];
      document.getElementById('pageSubtitle').textContent = meta[1];
      if (tab === 'groups') renderGroups();
      if (tab === 'codes') renderCodes();
      if (tab === 'dashboard') renderDashboard();
    }

    for (const btn of document.querySelectorAll('.nav-item')) {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    }

    function updatePolicyVisual() {
      const requireOn = document.getElementById('requireToggle').classList.contains('on');
      document.getElementById('guestRow').style.display = requireOn ? '' : 'none';
    }

    function setSaveStatus(text, kind) {
      const el = document.getElementById('saveStatus');
      if (!el) return;
      el.textContent = text;
      el.className = 'save-status' + (kind ? ' ' + kind : '');
    }

    function queuePolicySave(delay) {
      state.policyVersion += 1;
      state.policyDirty = true;
      setSaveStatus('待保存', 'pending');
      if (state.savingPolicy) {
        state.saveQueued = true;
        return;
      }
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(() => void savePolicy(), delay == null ? 600 : delay);
    }

    document.getElementById('requireToggle').addEventListener('click', () => {
      const btn = document.getElementById('requireToggle');
      setSwitch(btn, !btn.classList.contains('on'));
      updatePolicyVisual();
      queuePolicySave(300);
    });
    document.getElementById('guestToggle').addEventListener('click', () => {
      const btn = document.getElementById('guestToggle');
      setSwitch(btn, !btn.classList.contains('on'));
      queuePolicySave(300);
    });
    document.getElementById('addGroupBtn').addEventListener('click', () => {
      document.getElementById('newGroupName').value = '';
      document.getElementById('groupModal').classList.add('show');
      setTimeout(() => document.getElementById('newGroupName').focus(), 40);
    });
    document.getElementById('groupModalCancel').addEventListener('click', () => {
      document.getElementById('groupModal').classList.remove('show');
    });
    document.getElementById('groupModalOk').addEventListener('click', () => {
      const name = document.getElementById('newGroupName').value.trim();
      if (!name) {
        showMessage('请填写分组名称', false);
        return;
      }
      const permissions = {};
      for (const id of Object.keys(MODULE_META)) permissions[id] = false;
      state.policy.groups.push({
        id: 'g' + Date.now(),
        name,
        system: false,
        enabled: true,
        permissions,
      });
      document.getElementById('groupModal').classList.remove('show');
      renderGroups();
      queuePolicySave(100);
      showMessage('新分组已添加，正在自动保存', true);
    });

    function renderPolicy() {
      const policy = state.policy;
      if (!policy) return;
      setSwitch(document.getElementById('requireToggle'), !!policy.requireActivation);
      setSwitch(document.getElementById('guestToggle'), !!policy.guestEnabled);
      document.getElementById('contactLineInput').value = policy.contactLine || '';
      document.getElementById('contactLineInput').onchange = () => {
        state.policy.contactLine = document.getElementById('contactLineInput').value;
        queuePolicySave(700);
      };
      updatePolicyVisual();
    }

    function renderGroups() {
      const list = document.getElementById('groupList');
      list.innerHTML = '';
      if (!state.policy) return;
      state.policy.groups.forEach((group, index) => {
        const card = document.createElement('div');
        card.className = 'group-card';

        const head = document.createElement('div');
        head.className = 'group-head';
        const nameInput = document.createElement('input');
        nameInput.className = 'text-input group-name-input';
        nameInput.value = group.name || '';
        nameInput.maxLength = 30;
        nameInput.addEventListener('input', () => {
          state.policy.groups[index].name = nameInput.value;
          queuePolicySave(700);
        });
        const badge = document.createElement('span');
        badge.className = 'badge' + (group.system ? ' system' : '');
        badge.textContent = group.system ? '未激活用户组' : '授权分组';
        const enabledSwitch = makeSwitch(!!group.enabled, (next) => {
          state.policy.groups[index].enabled = next;
          queuePolicySave(400);
        });
        const deleteBtn = document.createElement('button');
        if (!group.system) {
          deleteBtn.type = 'button';
          deleteBtn.className = 'btn danger small';
          deleteBtn.textContent = '删除';
          deleteBtn.addEventListener('click', () => {
            askConfirm('确定删除分组“' + group.name + '”吗？已生成到该分组的激活码将失效。', () => {
              state.policy.groups.splice(index, 1);
              renderGroups();
              queuePolicySave(100);
              showMessage('分组已移除，正在自动保存', true);
            });
          });
        }
        head.appendChild(nameInput);
        head.appendChild(badge);
        head.appendChild(enabledSwitch);
        if (!group.system) head.appendChild(deleteBtn);

        const grid = document.createElement('div');
        grid.className = 'perm-grid';
        const moduleMeta = (state.policy.moduleMeta && Object.keys(state.policy.moduleMeta).length ? state.policy.moduleMeta : MODULE_META);
        const featureMeta = state.policy.featureMeta || {};
        for (const [mid, label] of Object.entries(moduleMeta)) {
          const row = document.createElement('div');
          row.className = 'perm-row';
          const text = document.createElement('span');
          text.textContent = label;
          const sw = makeSwitch(!!group.permissions[mid], (next) => {
            state.policy.groups[index].permissions[mid] = next;
            queuePolicySave(400);
          });
          row.appendChild(text);
          row.appendChild(sw);
          grid.appendChild(row);
          for (const [fid, fmeta] of Object.entries(featureMeta)) {
            if (!fmeta || fmeta.module !== mid) continue;
            const frow = document.createElement('div');
            frow.className = 'perm-row perm-row-feature';
            const ftext = document.createElement('span');
            ftext.textContent = '└ ' + (fmeta.label || fid);
            const fsw = makeSwitch(!!group.permissions[fid], (next) => {
              state.policy.groups[index].permissions[fid] = next;
              queuePolicySave(400);
            });
            frow.appendChild(ftext);
            frow.appendChild(fsw);
            grid.appendChild(frow);
          }
        }

        card.appendChild(head);
        card.appendChild(grid);
        list.appendChild(card);
      });
    }

    async function savePolicy(successText) {
      if (!state.policy || state.savingPolicy) {
        state.saveQueued = true;
        return;
      }
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }
      const versionAtStart = state.policyVersion;
      const groups = state.policy.groups.map((group, index) => ({
        id: group.id,
        name: (group.name || '').trim() || ('用户组' + (index + 1)),
        system: !!group.system,
        enabled: !!group.enabled,
        permissions: group.permissions,
      }));
      const payload = {
        action: 'savePolicy',
        requireActivation: document.getElementById('requireToggle').classList.contains('on'),
        guestEnabled: document.getElementById('guestToggle').classList.contains('on'),
        contactLine: document.getElementById('contactLineInput').value || '',
        groups,
      };
      state.savingPolicy = true;
      state.policyDirty = false;
      setSaveStatus('保存中', 'saving');
      const result = await api(payload);
      state.savingPolicy = false;
      if (result.success) {
        if (state.policyVersion === versionAtStart) {
          state.policy = result;
          state.policyDirty = false;
        } else {
          state.policyDirty = true;
          state.saveQueued = true;
        }
        setSaveStatus('已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }), 'saved');
        if (successText) showMessage(successText, true);
      } else {
        setSaveStatus('保存失败', 'bad');
        showMessage(result.message || '保存失败', false);
        return;
      }
      if (state.saveQueued) {
        state.saveQueued = false;
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(() => void savePolicy(successText), 300);
      }
    }

    async function flushPolicySave() {
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }
      if (!state.savingPolicy && !state.saveQueued && !state.policyDirty) return;
      while (state.savingPolicy) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      if (state.policyDirty || state.saveQueued) {
        state.saveQueued = false;
        if (state.saveTimer) {
          clearTimeout(state.saveTimer);
          state.saveTimer = null;
        }
        await savePolicy();
      }
    }

    function groupOptions(includeEmpty) {
      const groups = state.policy ? state.policy.groups.filter((group) => !group.system && group.enabled) : [];
      const options = includeEmpty ? [{ value: '', label: '保持不变' }] : [];
      for (const group of groups) {
        options.push({ value: group.id, label: group.name });
      }
      return options;
    }

    function renderCodes() {
      const genSelectHost = document.getElementById('genGroupSelect');
      genSelectHost.innerHTML = '';
      const genSelect = createSelect(groupOptions(false), groupOptions(false)[0]?.value || '', null);
      genSelectHost.appendChild(genSelect);
      state.genSelect = genSelect;

      const body = document.getElementById('codesBody');
      body.innerHTML = '';
      for (const item of state.codes) {
        const tr = document.createElement('tr');
        const active = item.status === 'active';
        const machine = item.machine || '未绑定';
        const lastCheck = item.last_check_at ? new Date(item.last_check_at).toLocaleString('zh-CN') : '-';
        const unbindBtn = item.machine
          ? '<button class="btn small" onclick="unbindCode(\'' + escapeJs(item.code) + '\')">解绑</button>'
          : '';
        tr.innerHTML =
          '<td class="code-text">' + escapeHtml(item.code) + '</td>' +
          '<td><span class="pill">' + escapeHtml(item.group_name || item.tier || '未指定') + '</span></td>' +
          '<td class="status-text"><button class="switch ' + (active ? 'on' : 'off') + '" data-code="' + escapeHtml(item.code) + '" data-status="' + (active ? 'active' : 'disabled') + '"></button><span class="' + (active ? 'ok' : 'bad') + '">' + (active ? '启用' : '禁用') + '</span></td>' +
          '<td class="muted" title="' + escapeHtml(machine) + '" style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtml(machine) + '</td>' +
          '<td>' + new Date(item.created_at).toLocaleString('zh-CN') + '</td>' +
          '<td>' + new Date(item.expires_at).toLocaleString('zh-CN') + '</td>' +
          '<td><div class="actions">' +
          '<button class="btn small" onclick="openEditCode(\'' + escapeJs(item.code) + '\')">修改</button>' +
          unbindBtn +
          '<button class="btn danger small" onclick="deleteCode(\'' + escapeJs(item.code) + '\')">删除</button>' +
          '</div></td>';
        body.appendChild(tr);
      }
      for (const toggle of body.querySelectorAll('td.status-text .switch')) {
        toggle.addEventListener('click', () => {
          const next = toggle.classList.contains('on') ? 'disabled' : 'active';
          void updateCode({ action: 'updateCode', code: toggle.dataset.code, status: next }, true);
        });
      }
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[ch]));
    }

    function escapeJs(value) {
      return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    const DASHBOARD_STAT_LABELS = {
      devices: '设备总数',
      bindings: '绑定数',
      codes: '激活码总数',
      activeCodes: '启用激活码',
      checksToday: '今日检查',
      checksWeek: '近7天检查',
      checksTotal: '累计检查',
    };

    function shortMachine(machine) {
      const value = String(machine || '');
      return value.length > 12 ? value.slice(0, 8) + '…' + value.slice(-4) : value;
    }

    function machineIpText(item) {
      const lanIps = Array.isArray(item.lan_ips) ? item.lan_ips.join(', ') : (item.lan_ips || '');
      const publicIp = item.last_ip || '';
      if (publicIp && lanIps) return publicIp + ' / ' + lanIps;
      return publicIp || lanIps || '-';
    }

    function renderDashboard() {
      const stats = state.dashboard.stats || {};
      const statGrid = document.getElementById('statGrid');
      statGrid.innerHTML = '';
      for (const key of ['devices', 'bindings', 'codes', 'activeCodes', 'checksToday', 'checksWeek', 'checksTotal']) {
        const card = document.createElement('div');
        card.className = 'stat-card';
        const value = document.createElement('strong');
        value.textContent = String(stats[key] ?? 0);
        const label = document.createElement('span');
        label.textContent = DASHBOARD_STAT_LABELS[key] || key;
        card.appendChild(value);
        card.appendChild(label);
        statGrid.appendChild(card);
      }

      const devicesBody = document.getElementById('devicesBody');
      devicesBody.innerHTML = '';
      for (const item of state.dashboard.devices) {
        const tr = document.createElement('tr');
        const machine = item.machine || '';
        const firstSeen = item.first_seen_at ? new Date(item.first_seen_at).toLocaleString('zh-CN') : '-';
        const lastSeen = item.last_check_at ? new Date(item.last_check_at).toLocaleString('zh-CN') : '-';
        const unbindAction = item.code
          ? '<button class="btn small" onclick="unbindCode(\'' + escapeJs(item.code) + '\')">解绑</button>'
          : '';
        tr.innerHTML =
          '<td class="truncate-cell" title="' + escapeHtml(machine) + '">' + escapeHtml(shortMachine(machine)) + '</td>' +
          '<td class="code-text">' + escapeHtml(item.code) + '</td>' +
          '<td><span class="pill">' + escapeHtml(item.group_name || item.tier || '未指定') + '</span></td>' +
          '<td>' + escapeHtml(item.device_name || '-') + '</td>' +
          '<td>' + escapeHtml(item.client_version || '-') + '</td>' +
          '<td class="truncate-cell" title="' + escapeHtml(machineIpText(item)) + '">' + escapeHtml(machineIpText(item)) + '</td>' +
          '<td>' + escapeHtml(firstSeen) + '</td>' +
          '<td>' + escapeHtml(lastSeen) + '</td>' +
          '<td>' + escapeHtml(String(item.check_count || 0)) + '</td>' +
          '<td><div class="actions">' +
          '<button class="btn small" onclick="viewDevice(\'' + escapeJs(machine) + '\')">查看</button>' +
          unbindAction +
          '</div></td>';
        devicesBody.appendChild(tr);
      }
      if (state.dashboard.devices.length === 0) {
        devicesBody.innerHTML = '<tr><td colspan="10" class="muted">暂无绑定设备</td></tr>';
      }

      const logsBody = document.getElementById('logsBody');
      logsBody.innerHTML = '';
      for (const log of state.dashboard.logs) {
        const tr = document.createElement('tr');
        const lanIps = Array.isArray(log.lan_ips) ? log.lan_ips.join(', ') : (log.lan_ips || '-');
        tr.innerHTML =
          '<td>' + escapeHtml(new Date(log.time).toLocaleString('zh-CN')) + '</td>' +
          '<td class="truncate-cell" title="' + escapeHtml(log.machine) + '">' + escapeHtml(shortMachine(log.machine)) + '</td>' +
          '<td class="code-text">' + escapeHtml(log.code) + '</td>' +
          '<td><span class="pill">' + escapeHtml(log.group_name || '未指定') + '</span></td>' +
          '<td>' + escapeHtml(log.device_name || '-') + '</td>' +
          '<td>' + escapeHtml(log.client_version || '-') + '</td>' +
          '<td>' + escapeHtml(log.ip || '-') + '</td>' +
          '<td class="truncate-cell" title="' + escapeHtml(lanIps) + '">' + escapeHtml(lanIps) + '</td>';
        logsBody.appendChild(tr);
      }
      if (state.dashboard.logs.length === 0) {
        logsBody.innerHTML = '<tr><td colspan="8" class="muted">暂无检查记录</td></tr>';
      }
    }

    window.viewDevice = async (machine) => {
      const result = await api({ action: 'deviceLogs', machine });
      if (!result.success) {
        showMessage(result.message || '读取设备详情失败', false);
        return;
      }
      document.getElementById('deviceMachineText').textContent = result.machine;
      const bindingsEl = document.getElementById('deviceBindings');
      bindingsEl.innerHTML = '';
      for (const binding of result.bindings || []) {
        const block = document.createElement('div');
        block.className = 'detail-block';
        block.innerHTML =
          '<h4>绑定激活码</h4>' +
          '<div class="code-stamp" style="margin-bottom:8px;">' + escapeHtml(binding.code) + '</div>' +
          '<div class="row-text"><strong>' + escapeHtml(binding.group_name || binding.tier || '未指定') + '</strong>' +
          '<small>到期：' + (binding.expires_at ? new Date(binding.expires_at).toLocaleString('zh-CN') : '-') + '，状态：' + (binding.status === 'active' ? '启用' : '禁用') + '</small></div>';
        bindingsEl.appendChild(block);
      }
      const wrap = document.getElementById('deviceLogsWrap');
      wrap.innerHTML = '';
      const logs = result.logs || [];
      if (logs.length === 0) {
        wrap.innerHTML = '<p class="muted">暂无使用记录</p>';
      } else {
        const rows = logs.map((log) =>
          '<tr>' +
          '<td>' + escapeHtml(new Date(log.time).toLocaleString('zh-CN')) + '</td>' +
          '<td class="code-text">' + escapeHtml(log.code) + '</td>' +
          '<td>' + escapeHtml(log.ip || '-') + '</td>' +
          '<td>' + escapeHtml(Array.isArray(log.lan_ips) ? log.lan_ips.join(', ') : (log.lan_ips || '-')) + '</td>' +
          '<td>' + escapeHtml(log.client_version || '-') + '</td>' +
          '</tr>'
        ).join('');
        wrap.innerHTML =
          '<table><thead><tr><th>时间</th><th>激活码</th><th>公网IP</th><th>局域网IP</th><th>版本</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>';
      }
      document.getElementById('deviceModal').classList.add('show');
    };

    document.getElementById('deviceModalClose').addEventListener('click', () => {
      document.getElementById('deviceModal').classList.remove('show');
    });
    document.getElementById('deviceModal').addEventListener('click', (event) => {
      if (event.target.id === 'deviceModal') document.getElementById('deviceModal').classList.remove('show');
    });

    async function clearLogs() {
      const result = await api({ action: 'clearLogs' });
      showMessage(result.message || '操作失败', result.success);
      if (result.success) await refresh();
    }

    async function clearAllData() {
      const result = await api({ action: 'clearAllData' });
      showMessage(result.message || '操作失败', result.success);
      if (result.success) await refresh();
    }

    async function generate() {
      const days = parseInt(document.getElementById('genDays').value, 10) || 365;
      const groupId = state.genSelect ? state.genSelect.getValue() : '';
      if (!groupId) {
        showMessage('请先创建并启用一个授权分组', false);
        return;
      }
      const result = await api({ action: 'generate', days, groupId });
      if (result.success) {
        showMessage('已生成：' + result.code, true);
        await refresh();
      } else {
        showMessage(result.message || '生成失败', false);
      }
    }

    document.getElementById('generateBtn').addEventListener('click', () => void generate());

    function openEditCode(code) {
      const item = state.codes.find((entry) => entry.code === code);
      if (!item) return;
      state.editRecord = item;
      state.editGroupId = item.group_id || '';
      state.editStatus = item.status === 'active';
      document.getElementById('editCodeText').textContent = item.code;
      const host = document.getElementById('editGroupSelect');
      host.innerHTML = '';
      const select = createSelect(groupOptions(true), state.editGroupId, (value) => {
        state.editGroupId = value;
      });
      host.appendChild(select);
      state.editSelect = select;
      setSwitch(document.getElementById('editStatusToggle'), state.editStatus);
      document.getElementById('editExtendDays').value = '0';
      document.getElementById('editModal').classList.add('show');
    }

    document.getElementById('editStatusToggle').addEventListener('click', () => {
      state.editStatus = document.getElementById('editStatusToggle').classList.contains('on');
      state.editStatus = !state.editStatus;
      setSwitch(document.getElementById('editStatusToggle'), state.editStatus);
    });
    document.getElementById('editCancel').addEventListener('click', () => {
      document.getElementById('editModal').classList.remove('show');
    });
    document.getElementById('editSave').addEventListener('click', () => {
      const extendDays = parseInt(document.getElementById('editExtendDays').value, 10) || 0;
      const payload = {
        action: 'updateCode',
        code: state.editRecord.code,
        status: state.editStatus ? 'active' : 'disabled',
      };
      if (state.editGroupId) payload.groupId = state.editGroupId;
      if (extendDays > 0) payload.extendDays = extendDays;
      document.getElementById('editModal').classList.remove('show');
      void updateCode(payload, true);
    });

    async function updateCode(payload, showOk) {
      const result = await api(payload);
      showMessage(result.message || '操作失败', result.success);
      if (result.success) await refresh();
    }

    window.unbindCode = (code) => {
      if (!code) return;
      askConfirm('确定解除激活码 ' + code + ' 的绑定吗？', () => void updateCode({ action: 'unbind', code }, true));
    };
    window.deleteCode = (code) => {
      askConfirm('确定删除激活码 ' + code + ' 吗？删除后不可恢复。', () => void updateCode({ action: 'delete', code }, true));
    };
    window.openEditCode = openEditCode;

    async function refresh() {
      await flushPolicySave();
      const [policyResult, listResult, dashboardResult] = await Promise.all([
        api({ action: 'getPolicy' }),
        api({ action: 'list' }),
        api({ action: 'dashboard' }),
      ]);
      if (!policyResult.success) {
        showMessage(policyResult.message || '读取策略失败', false);
        return;
      }
      if (!listResult.success) {
        showMessage(listResult.message || '读取列表失败', false);
        return;
      }
      if (!dashboardResult.success) {
        showMessage(dashboardResult.message || '读取看板失败', false);
        return;
      }
      state.policy = policyResult;
      state.codes = listResult.codes || [];
      state.dashboard = {
        devices: dashboardResult.devices || [],
        logs: dashboardResult.logs || [],
        stats: dashboardResult.stats || {},
      };
      renderPolicy();
      renderGroups();
      renderCodes();
      renderDashboard();
      showMessage('已加载 ' + state.codes.length + ' 条激活码，' + (state.dashboard.stats.devices || 0) + ' 台设备', true);
    }

    refresh();
  </script>
<?php endif; ?>
</body>
</html>
