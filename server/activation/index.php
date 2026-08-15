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
  <title>ShortCut 激活码管理</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Microsoft YaHei UI", system-ui, sans-serif; background: #10141c; color: #e6e9ef; }
    .wrap { max-width: 960px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 20px; }
    .card { background: #181e2a; border: 1px solid #2a3348; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 6px; }
    input, button { padding: 8px 10px; border-radius: 8px; border: 1px solid #2a3348; background: #121722; color: #e6e9ef; font-size: 14px; pointer-events: auto !important; }
    input:focus { outline: none; border-color: #5b86e5; }
    button { cursor: pointer; background: #5b86e5; border-color: #5b86e5; }
    button.secondary { background: #232b3a; border-color: #2a3348; }
    button.danger { background: #c0392b; border-color: #c0392b; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
    .grow { flex: 1; min-width: 180px; }
    .login { max-width: 360px; margin: 80px auto; position: relative; z-index: 1; }
    .login h1 { text-align: center; }
    .login form { position: relative; z-index: 2; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #222b3d; word-break: break-all; }
    th { color: #9aa5b5; font-weight: 500; }
    .ok { color: #63d391; }
    .bad { color: #ff6b6b; }
    .muted { color: #7c8799; }
    #message { margin-bottom: 12px; font-size: 13px; }
    .actions { display: flex; gap: 6px; }
    .actions button { padding: 5px 8px; font-size: 12px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 10px; }
    .modal-mask { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 1000; align-items: center; justify-content: center; }
    .modal-mask.show { display: flex; }
    .modal { width: 360px; max-width: 90vw; background: #181e2a; border: 1px solid #2a3348; border-radius: 12px; padding: 18px; }
    .modal p { font-size: 14px; margin: 0 0 16px; word-break: break-all; }
    .modal .actions { justify-content: flex-end; }
    .modal button { min-width: 76px; }
  </style>
</head>
<body>
<?php if (!$loggedIn): ?>
  <div class="wrap login">
    <h1>ShortCut 激活码管理</h1>
    <div class="card">
      <?php if (!empty($loginError)): ?>
        <div id="message" class="bad"><?php echo htmlspecialchars($loginError); ?></div>
      <?php endif; ?>
      <form id="loginForm" method="post">
        <label>管理员密码</label>
        <input type="password" id="adminPassword" name="adminPassword" style="width:100%" autocomplete="current-password" required />
        <button type="submit" style="width:100%; margin-top:12px">登录</button>
      </form>
    </div>
  </div>
<?php else: ?>
  <div class="wrap">
    <div class="topbar">
      <h1>ShortCut 激活码管理</h1>
      <div style="display:flex; align-items:center; gap:10px;">
        <button onclick="refresh()">刷新列表</button>
        <button class="secondary" onclick="refreshPolicy()">读取授权策略</button>
        <a href="index.php?logout=1" style="color:#9aa5b5; font-size:13px;">退出登录</a>
      </div>
    </div>
    <div id="message" class="muted"></div>
    <div class="card">
      <h3 style="margin:0 0 12px; font-size:15px;">授权策略</h3>
      <label>激活要求</label>
      <select id="activationPolicy" style="width:100%; margin-bottom:12px">
        <option value="none">免费可用，激活可解锁付费板块</option>
        <option value="premium_only">未激活仅可使用免费板块</option>
        <option value="all">必须激活才能使用</option>
      </select>
      <label>板块权限</label>
      <div id="moduleLevels" style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;"></div>
      <button onclick="savePolicy()">保存授权策略</button>
    </div>
    <div class="card">
      <div class="row">
        <div>
          <label>有效期（天）</label>
          <input id="days" type="number" value="365" min="1" max="3650" style="width:140px" />
        </div>
        <div>
          <label>授权等级</label>
          <select id="genTier">
            <option value="free">免费</option>
            <option value="member" selected>会员</option>
            <option value="super">超级会员</option>
          </select>
        </div>
        <button onclick="generate()">一键生成激活码</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>激活码</th>
            <th>等级</th>
            <th>状态</th>
            <th>机器码</th>
            <th>生成时间</th>
            <th>到期时间</th>
            <th>最后核对</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>
  <div class="modal-mask" id="confirmMask">
    <div class="modal">
      <p id="confirmText"></p>
      <div class="actions">
        <button class="secondary" onclick="closeConfirm()">取消</button>
        <button class="danger" id="confirmOk">确认</button>
      </div>
    </div>
  </div>
  <script>
    let confirmHandler = null;

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
      el.textContent = text;
      el.className = ok ? 'ok' : 'bad';
    }

    function askConfirm(text, onOk) {
      document.getElementById('confirmText').textContent = text;
      confirmHandler = onOk;
      document.getElementById('confirmMask').classList.add('show');
    }

    function closeConfirm() {
      document.getElementById('confirmMask').classList.remove('show');
      confirmHandler = null;
    }

    document.getElementById('confirmOk').addEventListener('click', () => {
      const handler = confirmHandler;
      closeConfirm();
      if (handler) handler();
    });
    document.getElementById('confirmMask').addEventListener('click', (event) => {
      if (event.target.id === 'confirmMask') closeConfirm();
    });

    async function refresh() {
      const result = await api({ action: 'list' });
      if (!result.success) {
        showMessage(result.message || '加载失败', false);
        return;
      }
      showMessage('已加载 ' + result.codes.length + ' 条记录', true);
      const rows = document.getElementById('rows');
      rows.innerHTML = '';
      for (const item of result.codes) {
        const tr = document.createElement('tr');
        const statusClass = item.status === 'active' ? 'ok' : 'bad';
        const machine = item.machine || '未绑定';
        const lastCheck = item.last_check_at ? new Date(item.last_check_at).toLocaleString('zh-CN') : '-';
        const actionButton = item.status === 'active'
          ? '<button class="secondary" onclick="setStatus(\'' + item.code + '\', \'disable\')">禁用</button>'
          : '<button class="secondary" onclick="setStatus(\'' + item.code + '\', \'enable\')">启用</button>';
        const unbindButton = item.machine
          ? '<button class="secondary" onclick="unbind(\'' + item.code + '\')">解除绑定</button>'
          : '';
        tr.innerHTML =
          '<td>' + item.code + '</td>' +
          '<td>' + (item.tier === 'super' ? '超级会员' : (item.tier === 'member' ? '会员' : '免费')) + '</td>' +
          '<td class="' + statusClass + '">' + item.status + '</td>' +
          '<td class="muted">' + machine + '</td>' +
          '<td>' + new Date(item.created_at).toLocaleString('zh-CN') + '</td>' +
          '<td>' + new Date(item.expires_at).toLocaleString('zh-CN') + '</td>' +
          '<td>' + lastCheck + '</td>' +
          '<td><div class="actions">' + actionButton + unbindButton +
          '<button class="danger" onclick="removeCode(\'' + item.code + '\')">删除</button></div></td>';
        rows.appendChild(tr);
      }
    }

    async function generate() {
      const result = await api({
        action: 'generate',
        days: parseInt(document.getElementById('days').value, 10) || 365,
        tier: document.getElementById('genTier').value,
      });
      if (result.success) {
        showMessage('已生成：' + result.code, true);
        await refresh();
      } else {
        showMessage(result.message || '生成失败', false);
      }
    }

    async function setStatus(code, action) {
      const result = await api({ action, code });
      showMessage(result.message || '操作失败', result.success);
      if (result.success) await refresh();
    }

    function unbind(code) {
      askConfirm('确定解除激活码 ' + code + ' 的绑定吗？', () => void setStatus(code, 'unbind'));
    }

    function removeCode(code) {
      askConfirm('确定删除激活码 ' + code + ' 吗？', () => void setStatus(code, 'delete'));
    }

    const MODULE_LABELS = {
      shortcuts: '快捷方式',
      tasks: '任务墙',
      cockpit: '驾驶舱',
      translate: '翻译',
      usage: '应用使用统计',
      island: 'SC球',
      codexProvider: 'Codex 供应商',
    };

    async function refreshPolicy() {
      const result = await api({ action: 'getPolicy' });
      if (!result.success) {
        showMessage(result.message || '读取策略失败', false);
        return;
      }
      document.getElementById('activationPolicy').value = result.activationPolicy || 'none';
      const box = document.getElementById('moduleLevels');
      box.innerHTML = '';
      for (const id of Object.keys(result.moduleList || {})) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:10px;';
        const name = document.createElement('span');
        name.style.cssText = 'flex:1; font-size:13px;';
        name.textContent = MODULE_LABELS[id] || id;
        const select = document.createElement('select');
        const value = result.moduleList[id];
        select.style.flex = '0 0 130px';
        for (const option of ['免费', '会员', '超级会员']) {
          const el = document.createElement('option');
          el.value = option;
          el.textContent = option;
          if (option === value) el.selected = true;
          select.appendChild(el);
        }
        select.dataset.id = id;
        row.appendChild(name);
        row.appendChild(select);
        box.appendChild(row);
      }
      showMessage('已读取授权策略', true);
    }

    async function savePolicy() {
      const moduleList = {};
      for (const select of document.querySelectorAll('#moduleLevels select')) {
        moduleList[select.dataset.id] = select.value;
      }
      const result = await api({
        action: 'savePolicy',
        activationPolicy: document.getElementById('activationPolicy').value,
        moduleList,
      });
      showMessage(result.message || '保存失败', result.success);
      if (result.success) await refreshPolicy();
    }

    refresh();
    refreshPolicy();
  </script>
<?php endif; ?>
</body>
</html>
