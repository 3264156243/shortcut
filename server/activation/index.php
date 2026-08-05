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
    .wrap { max-width: 920px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 20px; }
    .card { background: #181e2a; border: 1px solid #2a3348; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 6px; }
    input, button { padding: 8px 10px; border-radius: 8px; border: 1px solid #2a3348; background: #121722; color: #e6e9ef; font-size: 14px; }
    input:focus { outline: none; border-color: #5b86e5; }
    button { cursor: pointer; background: #5b86e5; border-color: #5b86e5; }
    button.secondary { background: #232b3a; border-color: #2a3348; }
    button.danger { background: #c0392b; border-color: #c0392b; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
    .grow { flex: 1; min-width: 180px; }
    .login { max-width: 360px; margin: 80px auto; }
    .login h1 { text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #222b3d; word-break: break-all; }
    th { color: #9aa5b5; font-weight: 500; }
    .ok { color: #63d391; }
    .bad { color: #ff6b6b; }
    .muted { color: #7c8799; }
    #message { margin-bottom: 12px; font-size: 13px; }
    .actions { display: flex; gap: 6px; }
    .actions button { padding: 5px 8px; font-size: 12px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
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
      <form method="post">
        <label>管理员密码</label>
        <input type="password" name="adminPassword" style="width:100%" autocomplete="current-password" required />
        <button type="submit" style="width:100%; margin-top:12px">登录</button>
      </form>
    </div>
  </div>
<?php else: ?>
  <div class="wrap">
    <div class="topbar">
      <h1>ShortCut 激活码管理</h1>
      <a href="index.php?logout=1" style="color:#9aa5b5; font-size:13px;">退出登录</a>
    </div>
    <div id="message" class="muted"></div>
    <div class="card">
      <div class="row">
        <div>
          <label>有效期（天）</label>
          <input id="days" type="number" value="365" min="1" max="3650" style="width:140px" />
        </div>
        <button onclick="generate()">一键生成激活码</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>激活码</th>
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
  <script>
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
        tr.innerHTML =
          '<td>' + item.code + '</td>' +
          '<td class="' + statusClass + '">' + item.status + '</td>' +
          '<td class="muted">' + machine + '</td>' +
          '<td>' + new Date(item.created_at).toLocaleString('zh-CN') + '</td>' +
          '<td>' + new Date(item.expires_at).toLocaleString('zh-CN') + '</td>' +
          '<td>' + lastCheck + '</td>' +
          '<td><div class="actions">' + actionButton +
          '<button class="danger" onclick="removeCode(\'' + item.code + '\')">删除</button></div></td>';
        rows.appendChild(tr);
      }
    }
    async function generate() {
      const result = await api({
        action: 'generate',
        days: parseInt(document.getElementById('days').value, 10) || 365,
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
      showMessage(result.message || (action === 'disable' ? '禁用失败' : '启用失败'), result.success);
      if (result.success) await refresh();
    }
    async function removeCode(code) {
      if (!confirm('确定删除激活码 ' + code + ' 吗？')) return;
      const result = await api({ action: 'delete', code });
      showMessage(result.message || '删除失败', result.success);
      if (result.success) await refresh();
    }
    refresh();
  </script>
<?php endif; ?>
</body>
</html>
