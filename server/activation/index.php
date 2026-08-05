<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ShortCut 激活码管理</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Microsoft YaHei UI", system-ui, sans-serif; background: #10141c; color: #e6e9ef; }
    .wrap { max-width: 900px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 20px; }
    .card { background: #181e2a; border: 1px solid #2a3348; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 6px; }
    input, select, button { padding: 8px 10px; border-radius: 8px; border: 1px solid #2a3348; background: #121722; color: #e6e9ef; font-size: 14px; }
    input:focus, select:focus { outline: none; border-color: #5b86e5; }
    button { cursor: pointer; background: #5b86e5; border-color: #5b86e5; }
    button.secondary { background: #232b3a; border-color: #2a3348; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
    .grow { flex: 1; min-width: 160px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #222b3d; word-break: break-all; }
    th { color: #9aa5b5; font-weight: 500; }
    .ok { color: #63d391; }
    .bad { color: #ff6b6b; }
    .muted { color: #7c8799; }
    #message { margin-bottom: 12px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>ShortCut 激活码管理</h1>
    <div id="message" class="muted"></div>
    <div class="card">
      <div class="row">
        <div class="grow">
          <label>管理员密码</label>
          <input id="adminPassword" type="password" style="width:100%" autocomplete="off" />
        </div>
        <button onclick="refresh()">登录 / 刷新</button>
      </div>
    </div>
    <div class="card">
      <div class="row">
        <div>
          <label>授权类型</label>
          <select id="plan">
            <option>基础版</option>
            <option>专业版</option>
            <option>终身版</option>
          </select>
        </div>
        <div>
          <label>有效期（天）</label>
          <input id="days" type="number" value="365" min="1" max="3650" style="width:110px" />
        </div>
        <button onclick="generate()">一键生成激活码</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>激活码</th>
            <th>类型</th>
            <th>状态</th>
            <th>机器码</th>
            <th>生成时间</th>
            <th>到期时间</th>
            <th>最后核对</th>
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
    function password() {
      return document.getElementById('adminPassword').value;
    }
    function showMessage(text, ok) {
      const el = document.getElementById('message');
      el.textContent = text;
      el.className = ok ? 'ok' : 'bad';
    }
    async function refresh() {
      const result = await api({ action: 'list', adminPassword: password() });
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
        tr.innerHTML =
          '<td>' + item.code + '</td>' +
          '<td>' + (item.plan || '-') + '</td>' +
          '<td class="' + statusClass + '">' + item.status + '</td>' +
          '<td class="muted">' + machine + '</td>' +
          '<td>' + new Date(item.created_at).toLocaleString('zh-CN') + '</td>' +
          '<td>' + new Date(item.expires_at).toLocaleString('zh-CN') + '</td>' +
          '<td>' + lastCheck + '</td>';
        rows.appendChild(tr);
      }
    }
    async function generate() {
      const result = await api({
        action: 'generate',
        adminPassword: password(),
        plan: document.getElementById('plan').value,
        days: parseInt(document.getElementById('days').value, 10) || 365,
      });
      if (result.success) {
        showMessage('已生成：' + result.code, true);
        await refresh();
      } else {
        showMessage(result.message || '生成失败', false);
      }
    }
  </script>
</body>
</html>
