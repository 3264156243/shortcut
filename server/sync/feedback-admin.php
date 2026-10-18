<?php
/**
 * ShortCut 反馈管理后台
 * 访问：/sync/feedback-admin.php
 * 登录：复用 activation/index.php 的 $_SESSION['admin'] 会话。
 */
declare(strict_types=1);
session_start();
require __DIR__ . '/config.php';

function fa_json(array $data, int $status = 200): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fa_require_admin(): void {
    if (empty($_SESSION['admin'])) fa_json(['ok' => false, 'error' => 'not_logged_in'], 401);
}
function fa_read_feedback(string $dataDir): array {
    $rows = [];
    foreach (glob(rtrim($dataDir, '/') . '/feedback/feedback-*.jsonl') ?: [] as $file) {
        foreach (@file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $row = json_decode($line, true);
            if (is_array($row) && !empty($row['id'])) $rows[] = $row;
        }
    }
    usort($rows, static fn($a, $b) => strcmp((string)($b['time'] ?? ''), (string)($a['time'] ?? '')));
    return $rows;
}
function fa_read_replies(string $dataDir): array {
    $out = [];
    $file = rtrim($dataDir, '/') . '/feedback/feedback-replies.jsonl';
    foreach (@file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $row = json_decode($line, true);
        if (is_array($row) && !empty($row['feedback_id'])) $out[] = $row;
    }
    return $out;
}

$api = $_GET['api'] ?? '';
if ($api !== '') {
    fa_require_admin();
    if ($api === 'list') {
        $rows = fa_read_feedback($DATA_DIR);
        $replies = fa_read_replies($DATA_DIR);
        $byId = [];
        foreach ($replies as $reply) $byId[$reply['feedback_id']][] = $reply;
        foreach ($rows as &$row) {
            unset($row['token_hash'], $row['ip'], $row['ua']);
            $row['replies'] = $byId[$row['id']] ?? [];
            $row['status'] = !empty($row['replies']) ? ($row['replies'][count($row['replies']) - 1]['status'] ?? 'replied') : 'open';
        }
        unset($row);
        fa_json(['ok' => true, 'items' => $rows]);
    }
    if ($api === 'reply' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $input = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($input)) fa_json(['ok' => false, 'error' => 'bad_request'], 400);
        $id = trim((string)($input['feedback_id'] ?? ''));
        $body = trim((string)($input['body'] ?? ''));
        $status = trim((string)($input['status'] ?? 'replied'));
        if (!preg_match('/^[a-f0-9]{12}$/', $id) || $body === '' || strlen($body) > 4000) {
            fa_json(['ok' => false, 'error' => 'invalid_reply'], 400);
        }
        if (!in_array($status, ['replied', 'closed'], true)) $status = 'replied';
        $feedback = fa_read_feedback($DATA_DIR);
        $exists = false;
        foreach ($feedback as $row) if (($row['id'] ?? '') === $id) { $exists = true; break; }
        if (!$exists) fa_json(['ok' => false, 'error' => 'feedback_not_found'], 404);
        $dir = rtrim($DATA_DIR, '/') . '/feedback';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $entry = [
            'feedback_id' => $id,
            'time' => gmdate('c'),
            'body' => $body,
            'status' => $status,
            'admin' => 'admin',
        ];
        $file = $dir . '/feedback-replies.jsonl';
        if (@file_put_contents($file, json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX) === false) {
            fa_json(['ok' => false, 'error' => 'write_failed'], 500);
        }
        @chmod($file, 0640);
        fa_json(['ok' => true, 'reply' => $entry]);
    }
    fa_json(['ok' => false, 'error' => 'unknown_api'], 404);
}

if (empty($_SESSION['admin'])) {
    header('Location: /activation/index.php?from=feedback-admin', true, 302);
    exit;
}
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>问题反馈管理 — ShortCut</title>
<style>
:root{color-scheme:dark;--bg:#0b0e14;--panel:#151a26;--panel2:#1b2130;--line:#293247;--text:#eef1f7;--muted:#9aa3b8;--accent:#ff6b1a;--good:#3dd68c;--bad:#ff7a6b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.7 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1280px;margin:0 auto;padding:32px 20px 70px}h1{margin:0 0 6px;font-size:28px}h2{font-size:17px;margin:0 0 8px}.muted{color:var(--muted)}.top{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:26px}.btn{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:9px;padding:8px 14px;cursor:pointer}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn:hover{filter:brightness(1.12)}.list{display:grid;gap:14px}.item{border:1px solid var(--line);background:linear-gradient(180deg,var(--panel2),var(--panel));border-radius:14px;padding:18px}.head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.id{font:12px Consolas,monospace;color:#ffb98d}.tag{font-size:12px;border:1px solid var(--line);border-radius:99px;padding:2px 8px;color:var(--muted)}.tag.open{color:#ffb98d;border-color:#8d4d2d}.tag.replied{color:var(--good);border-color:#297c59}.tag.closed{color:var(--muted)}.time{margin-left:auto;color:var(--muted);font-size:12px}.content{white-space:pre-wrap;background:rgba(0,0,0,.2);border-radius:9px;padding:12px;margin:13px 0;color:#f4f5f8}.meta{color:var(--muted);font-size:12px}.reply{border-left:3px solid var(--good);padding:9px 12px;margin:10px 0;background:rgba(61,214,140,.06);white-space:pre-wrap}.reply small{display:block;color:var(--muted);margin-bottom:4px}.form{display:flex;gap:8px;margin-top:14px}.form textarea{flex:1;min-height:70px;resize:vertical;background:#0c1017;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit}.empty{border:1px dashed var(--line);padding:40px;text-align:center;color:var(--muted)}#status{color:var(--good);min-height:25px;margin-bottom:10px}@media(max-width:700px){.top{align-items:flex-start;flex-direction:column}.time{margin-left:0}.form{flex-direction:column}}
</style></head>
<body><main>
<div class="top"><div><h1>问题反馈管理</h1><div class="muted">查看用户反馈、直接回复；回复会出现在用户的查询结果里。</div></div><div><button class="btn" onclick="load()">刷新</button> <a class="btn" href="/activation/index.php">激活码后台</a></div></div>
<div id="status"></div><div id="list" class="list"><div class="empty">正在加载…</div></div>
<script>
async function load(){const s=document.getElementById('status');const box=document.getElementById('list');s.textContent='';try{const r=await fetch('?api=list',{cache:'no-store'});const j=await r.json();if(!j.ok)throw new Error(j.error||'加载失败');if(!j.items.length){box.innerHTML='<div class="empty">暂无反馈</div>';return}box.innerHTML=j.items.map(render).join('')}catch(e){s.textContent='加载失败：'+e.message}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function render(x){const replies=(x.replies||[]).map(r=>`<div class="reply"><small>${esc(r.time)} · ${esc(r.status)}</small>${esc(r.body)}</div>`).join('');return `<article class="item"><div class="head"><strong>${esc(x.type)}</strong><span class="id">${esc(x.id)}</span><span class="tag ${esc(x.status)}">${esc(x.status)}</span><span class="time">${esc(x.time)}</span></div><div class="content">${esc(x.content)}</div><div class="meta">版本：${esc(x.version||'—')}　联系人：${esc(x.contact||'未填写')}　来源：${esc(x.page||'—')}</div>${replies}<div class="form"><textarea id="reply-${esc(x.id)}" placeholder="写给用户的回复"></textarea><button class="btn primary" onclick="reply('${esc(x.id)}')">回复</button><button class="btn" onclick="closeItem('${esc(x.id)}')">标记关闭</button></div></article>`}
async function reply(id){await sendReply(id,'replied')}
async function closeItem(id){await sendReply(id,'closed')}
async function sendReply(id,status){const body=document.getElementById('reply-'+id).value.trim();if(status==='replied'&&!body){alert('请先填写回复内容');return}const r=await fetch('?api=reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({feedback_id:id,body:body||'已处理。',status})});const j=await r.json();if(!j.ok){alert(j.error||'操作失败');return}load()}
load();
</script></main></body></html>
