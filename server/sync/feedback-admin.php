<?php
/**
 * ShortCut public feedback moderation.
 * Admin session is shared with activation/index.php.
 */
declare(strict_types=1);
session_start();
require __DIR__ . '/config.php';

const FA_STATUSES = ['pending', 'confirmed', 'processing', 'needs_info', 'resolved', 'closed', 'hidden'];

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

function fa_status(string $status): string {
    if ($status === 'open') return 'pending';
    if ($status === 'replied') return 'resolved';
    return in_array($status, FA_STATUSES, true) ? $status : 'pending';
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

function fa_rewrite_feedback(string $dataDir, string $id, ?array $patch = null): bool {
    $changed = false;
    foreach (glob(rtrim($dataDir, '/') . '/feedback/feedback-*.jsonl') ?: [] as $file) {
        $handle = @fopen($file, 'c+');
        if (!$handle) continue;
        if (!flock($handle, LOCK_EX)) { fclose($handle); continue; }
        rewind($handle);
        $lines = preg_split('/\R/', (string)stream_get_contents($handle)) ?: [];
        $output = [];
        foreach ($lines as $line) {
            if (trim($line) === '') continue;
            $row = json_decode($line, true);
            if (!is_array($row) || (string)($row['id'] ?? '') !== $id) {
                $output[] = $line;
                continue;
            }
            $changed = true;
            if ($patch === null) continue;
            foreach (['title', 'area', 'details'] as $field) {
                if (array_key_exists($field, $patch)) $row[$field] = (string)$patch[$field];
            }
            $row['content'] = '[' . (($row['area'] ?? '') !== '' ? $row['area'] : '反馈') . '] ' . ($row['title'] ?? '') . "\n\n" . ($row['details'] ?? '');
            $row['edited_at'] = gmdate('c');
            $output[] = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        if ($changed) {
            rewind($handle); ftruncate($handle, 0);
            fwrite($handle, implode("\n", $output) . (count($output) ? "\n" : ''));
            fflush($handle);
        }
        flock($handle, LOCK_UN); fclose($handle);
        if ($changed) break;
    }
    return $changed;
}

function fa_remove_replies(string $dataDir, string $id): void {
    $file = rtrim($dataDir, '/') . '/feedback/feedback-replies.jsonl';
    if (!is_file($file)) return;
    $handle = @fopen($file, 'c+');
    if (!$handle) return;
    if (!flock($handle, LOCK_EX)) { fclose($handle); return; }
    rewind($handle);
    $output = [];
    foreach (preg_split('/\R/', (string)stream_get_contents($handle)) ?: [] as $line) {
        if (trim($line) === '') continue;
        $row = json_decode($line, true);
        if (is_array($row) && (string)($row['feedback_id'] ?? '') === $id) continue;
        $output[] = $line;
    }
    rewind($handle); ftruncate($handle, 0);
    fwrite($handle, implode("\n", $output) . (count($output) ? "\n" : ''));
    fflush($handle); flock($handle, LOCK_UN); fclose($handle);
}

function fa_input(): array {
    $input = json_decode((string)file_get_contents('php://input'), true);
    return is_array($input) ? $input : $_POST;
}

$api = $_GET['api'] ?? '';
if ($api !== '') {
    fa_require_admin();
    if ($api === 'list') {
        $rows = fa_read_feedback($DATA_DIR);
        $byId = [];
        foreach (fa_read_replies($DATA_DIR) as $reply) $byId[$reply['feedback_id']][] = $reply;
        foreach ($rows as &$row) {
            unset($row['token_hash'], $row['ip'], $row['ua']);
            $replies = $byId[$row['id']] ?? [];
            $status = 'pending';
            $latestReply = null;
            foreach ($replies as $reply) {
                if (!empty($reply['status'])) $status = fa_status((string)$reply['status']);
                if (trim((string)($reply['body'] ?? '')) !== '') $latestReply = $reply;
            }
            $row['status'] = $status;
            $row['reply'] = $latestReply;
            $row['replies'] = $replies;
        }
        unset($row);
        fa_json(['ok' => true, 'items' => $rows]);
    }

    if (($api === 'reply' || $api === 'status' || $api === 'edit' || $api === 'delete') && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $input = fa_input();
        $id = trim((string)($input['id'] ?? ''));
        if (!preg_match('/^[a-f0-9]{12}$/', $id)) fa_json(['ok' => false, 'error' => 'bad_id'], 400);
        $exists = false;
        foreach (fa_read_feedback($DATA_DIR) as $row) if ((string)($row['id'] ?? '') === $id) { $exists = true; break; }
        if (!$exists) fa_json(['ok' => false, 'error' => 'feedback_not_found'], 404);

        if ($api === 'edit') {
            $title = trim((string)($input['title'] ?? ''));
            $area = trim((string)($input['area'] ?? ''));
            $details = trim((string)($input['details'] ?? ''));
            if ($title === '' || mb_strlen($details, 'UTF-8') < 5) fa_json(['ok' => false, 'error' => 'invalid_content'], 400);
            $ok = fa_rewrite_feedback($DATA_DIR, $id, ['title' => mb_substr($title, 0, 120), 'area' => mb_substr($area, 0, 60), 'details' => mb_substr($details, 0, 4000)]);
            fa_json(['ok' => $ok], $ok ? 200 : 500);
        }

        if ($api === 'delete') {
            $ok = fa_rewrite_feedback($DATA_DIR, $id, null);
            if ($ok) fa_remove_replies($DATA_DIR, $id);
            fa_json(['ok' => $ok], $ok ? 200 : 500);
        }

        if ($api === 'reply' || $api === 'status') {
            $status = fa_status((string)($input['status'] ?? 'processing'));
            $body = trim((string)($input['body'] ?? ''));
            if ($api === 'reply' && $body === '') fa_json(['ok' => false, 'error' => 'reply_required'], 400);
            if (mb_strlen($body, 'UTF-8') > 4000) fa_json(['ok' => false, 'error' => 'reply_too_long'], 400);
            $dir = rtrim($DATA_DIR, '/') . '/feedback';
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $entry = ['feedback_id' => $id, 'time' => gmdate('c'), 'body' => $body, 'status' => $status, 'admin' => 'admin'];
            $file = $dir . '/feedback-replies.jsonl';
            $ok = @file_put_contents($file, json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX) !== false;
            @chmod($file, 0640);
            fa_json(['ok' => $ok, 'reply' => $entry], $ok ? 200 : 500);
        }
    }
    fa_json(['ok' => false, 'error' => 'unknown_api'], 404);
}

if (empty($_SESSION['admin'])) {
    header('Location: /activation/index.php?from=feedback-admin', true, 302);
    exit;
}
?>
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>留言管理 — ShortCut</title>
<style>
:root{color-scheme:dark;--bg:#10120f;--panel:#1a1d18;--panel2:#22261f;--line:#373d32;--text:#f2eee4;--muted:#9ca594;--accent:#e56a32;--good:#69b78f;--warn:#d7a04a;--blue:#7ba8c7;--bad:#e47768}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.65 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 80px}a{color:inherit}
.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:20px}.eyebrow{margin:0 0 5px;color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.top h1{margin:0;font-size:30px;line-height:1.2}.top p{margin:7px 0 0;color:var(--muted)}.top-actions{display:flex;gap:8px}
.btn{min-height:38px;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:7px;padding:7px 13px;cursor:pointer;font:inherit;font-weight:600}.btn:hover{border-color:#59614f;background:var(--panel2)}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn.danger{color:var(--bad);border-color:rgba(228,119,104,.35)}.btn.sm{min-height:32px;padding:5px 10px;font-size:12.5px}
.filters{display:grid;grid-template-columns:minmax(220px,1fr) 180px 180px auto;gap:10px;margin-bottom:16px}.control{width:100%;height:40px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--text);padding:0 12px;font:inherit}.control:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(229,106,50,.13)}select.control{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 17px) 17px,calc(100% - 12px) 17px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:30px}
.status-line{min-height:24px;color:var(--muted);font-size:13px;margin-bottom:10px}.list{display:grid;gap:12px}.thread{border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}.thread.is-hidden{opacity:.72;border-style:dashed}.thread-head{display:flex;gap:12px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid var(--line)}.thread-title{min-width:0;flex:1}.thread-title h2{font-size:17px;line-height:1.35;margin:0 0 5px}.meta{display:flex;flex-wrap:wrap;gap:8px 14px;color:var(--muted);font-size:12px}.mono{font-family:Consolas,monospace}.badge{display:inline-flex;align-items:center;min-height:24px;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap}.badge.pending{color:var(--warn);border-color:rgba(215,160,74,.4)}.badge.processing{color:var(--blue);border-color:rgba(123,168,199,.4)}.badge.resolved{color:var(--good);border-color:rgba(105,183,143,.4)}.badge.closed,.badge.hidden{color:var(--muted)}.badge.confirmed{color:var(--accent);border-color:rgba(229,106,50,.4)}.badge.needs_info{color:#d68ac2;border-color:rgba(214,138,194,.4)}
.thread-body{padding:16px 18px}.details{white-space:pre-wrap;margin:0 0 14px;color:#ded9ce}.contact{font-size:12px;color:var(--muted);border-top:1px dashed var(--line);padding-top:10px;margin-bottom:12px}.reply-box{border-left:3px solid var(--good);background:rgba(105,183,143,.06);padding:10px 12px;border-radius:0 6px 6px 0;margin-bottom:14px;white-space:pre-wrap}.reply-box small{display:block;color:var(--muted);margin-bottom:4px}.editor{display:grid;gap:10px}.editor textarea{width:100%;min-height:90px;resize:vertical;border:1px solid var(--line);border-radius:7px;background:#11140f;color:var(--text);padding:10px 12px;font:inherit}.row-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.row-actions select{min-width:150px}.empty{padding:58px 20px;border:1px dashed var(--line);border-radius:8px;text-align:center;color:var(--muted)}
dialog{width:min(680px,calc(100% - 32px));border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);padding:0}dialog::backdrop{background:rgba(0,0,0,.62)}.modal-head{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--line)}.modal-head h2{margin:0;font-size:18px}.modal-body{display:grid;gap:12px;padding:20px}.modal-body label{display:grid;gap:6px;font-size:12px;color:var(--muted)}.modal-body input,.modal-body textarea{width:100%;border:1px solid var(--line);border-radius:7px;background:#11140f;color:var(--text);padding:10px 12px;font:inherit}.modal-body textarea{min-height:190px;resize:vertical}.modal-actions{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--line)}
@media(max-width:760px){main{padding:24px 16px 60px}.top{align-items:flex-start;flex-direction:column}.top-actions{width:100%;flex-wrap:wrap}.filters{grid-template-columns:1fr 1fr}.filters .control:first-child{grid-column:1/-1}.filters .btn{grid-column:1/-1}.thread-head{flex-direction:column}.thread-body{padding:14px}.row-actions .btn{flex:1}.row-actions select{width:100%}}
</style>
</head>
<body><main>
<header class="top"><div><p class="eyebrow">Community moderation</p><h1>公开留言管理</h1><p>公开展示问题与唯一管理员回复；联系方式只在后台可见。</p></div><div class="top-actions"><a class="btn" href="/">返回官网</a><a class="btn" href="/activation/index.php">激活码后台</a><button class="btn primary" type="button" onclick="loadItems()">刷新</button></div></header>
<section class="filters" aria-label="筛选留言"><input class="control" id="searchInput" type="search" placeholder="搜索标题、板块或内容" /><select class="control" id="statusFilter"><option value="all">全部状态</option><option value="pending">待处理</option><option value="confirmed">已确认</option><option value="processing">处理中</option><option value="needs_info">需要补充</option><option value="resolved">已解决</option><option value="closed">已关闭</option><option value="hidden">已隐藏</option></select><select class="control" id="typeFilter"><option value="all">全部类型</option><option value="bug">问题故障</option><option value="feature">功能建议</option><option value="ui">界面体验</option><option value="update">安装更新</option><option value="other">其他</option></select><button class="btn" type="button" onclick="clearFilters()">清除筛选</button></section>
<div class="status-line" id="statusLine"></div><div class="list" id="list"><div class="empty">正在加载…</div></div>
<dialog id="editDialog"><form method="dialog" id="editForm"><div class="modal-head"><h2>编辑留言</h2><button class="btn sm" value="cancel" type="submit">关闭</button></div><div class="modal-body"><input type="hidden" id="editId" /><label>标题<input id="editTitle" maxlength="120" required /></label><label>板块<input id="editArea" maxlength="60" /></label><label>正文<textarea id="editDetails" maxlength="4000" required></textarea></label></div><div class="modal-actions"><button class="btn" value="cancel" type="submit">取消</button><button class="btn primary" type="button" onclick="saveEdit()">保存修改</button></div></form></dialog>
<script>
const STATUS_LABELS={pending:'待处理',confirmed:'已确认',processing:'处理中',needs_info:'需要补充',resolved:'已解决',closed:'已关闭',hidden:'已隐藏'};
const TYPE_LABELS={bug:'问题故障',feature:'功能建议',ui:'界面体验',update:'安装更新',other:'其他'};
let allItems=[];
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtTime(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString('zh-CN',{hour12:false})}
function statusOptions(current){return Object.entries(STATUS_LABELS).map(([value,label])=>`<option value="${value}"${value===current?' selected':''}>${label}</option>`).join('')}
function visibleItems(){const query=document.getElementById('searchInput').value.trim().toLowerCase();const status=document.getElementById('statusFilter').value;const type=document.getElementById('typeFilter').value;return allItems.filter(item=>{if(status!=='all'&&item.status!==status)return false;if(type!=='all'&&item.type!==type)return false;if(!query)return true;return [item.title,item.area,item.details,item.content].join('\n').toLowerCase().includes(query)})}
function render(){const box=document.getElementById('list');const items=visibleItems();document.getElementById('statusLine').textContent=`显示 ${items.length} / ${allItems.length} 条留言`;if(!items.length){box.innerHTML='<div class="empty">没有匹配的留言</div>';return}box.innerHTML=items.map(item=>{const reply=item.reply?`<div class="reply-box"><small>管理员回复 · ${esc(fmtTime(item.reply.time))}</small>${esc(item.reply.body)}</div>`:'';const hidden=item.status==='hidden'?' is-hidden':'';return `<article class="thread${hidden}"><header class="thread-head"><div class="thread-title"><h2>${esc(item.title||'未命名反馈')}</h2><div class="meta"><span>${esc(TYPE_LABELS[item.type]||item.type)}</span><span>${esc(item.area||'未指定板块')}</span><span class="mono">#${esc(item.id)}</span><span>${esc(fmtTime(item.time))}</span><span>版本 ${esc(item.version||'—')}</span></div></div><span class="badge ${esc(item.status)}">${esc(STATUS_LABELS[item.status]||item.status)}</span></header><div class="thread-body"><p class="details">${esc(item.details||item.content||'')}</p><div class="contact">联系方式：${esc(item.contact||'未填写')}　来源：${esc(item.page||'—')}</div>${reply}<div class="editor"><textarea id="reply-${esc(item.id)}" maxlength="4000" placeholder="填写唯一的管理员回复">${esc(item.reply?.body||'')}</textarea><div class="row-actions"><select class="control" id="status-${esc(item.id)}">${statusOptions(item.status)}</select><button class="btn primary sm" type="button" data-action="reply" data-id="${esc(item.id)}">保存回复</button><button class="btn sm" type="button" data-action="status" data-id="${esc(item.id)}">更新状态</button><button class="btn sm" type="button" data-action="edit" data-id="${esc(item.id)}">编辑留言</button><button class="btn danger sm" type="button" data-action="delete" data-id="${esc(item.id)}">删除</button></div></div></div></article>`}).join('')}
async function api(action,payload){const response=await fetch(`?api=${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json().catch(()=>({ok:false,error:'bad_response'}));if(!result.ok)throw new Error(result.error||'操作失败');return result}
function showMessage(text,bad=false){const node=document.getElementById('statusLine');node.textContent=text;node.style.color=bad?'var(--bad)':'var(--muted)'}
async function loadItems(){const box=document.getElementById('list');showMessage('正在加载…');try{const response=await fetch('?api=list',{cache:'no-store'});const result=await response.json();if(!result.ok)throw new Error(result.error||'加载失败');allItems=result.items||[];render()}catch(error){box.innerHTML='<div class="empty">加载失败</div>';showMessage('加载失败：'+error.message,true)}}
function clearFilters(){document.getElementById('searchInput').value='';document.getElementById('statusFilter').value='all';document.getElementById('typeFilter').value='all';render()}
function openEdit(id){const item=allItems.find(row=>row.id===id);if(!item)return;document.getElementById('editId').value=id;document.getElementById('editTitle').value=item.title||'';document.getElementById('editArea').value=item.area||'';document.getElementById('editDetails').value=item.details||item.content||'';document.getElementById('editDialog').showModal()}
async function saveEdit(){const id=document.getElementById('editId').value;const title=document.getElementById('editTitle').value.trim();const area=document.getElementById('editArea').value.trim();const details=document.getElementById('editDetails').value.trim();if(!title||details.length<5){alert('标题和正文不能为空');return}try{await api('edit',{id,title,area,details});document.getElementById('editDialog').close();await loadItems();showMessage('留言已修改')}catch(error){alert('保存失败：'+error.message)}}
async function saveReply(id){const body=document.getElementById(`reply-${id}`).value.trim();const status=document.getElementById(`status-${id}`).value;if(!body){alert('请填写管理员回复');return}try{await api('reply',{id,body,status});await loadItems();showMessage('回复已保存')}catch(error){alert('保存失败：'+error.message)}}
async function saveStatus(id){const status=document.getElementById(`status-${id}`).value;try{await api('status',{id,status});await loadItems();showMessage('状态已更新')}catch(error){alert('更新失败：'+error.message)}}
async function deleteItem(id){if(!confirm('删除后会同时移除该留言的管理员回复，且无法恢复。确定删除吗？'))return;try{await api('delete',{id});await loadItems();showMessage('留言已删除')}catch(error){alert('删除失败：'+error.message)}}
document.getElementById('list').addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const id=button.dataset.id;if(button.dataset.action==='reply')saveReply(id);if(button.dataset.action==='status')saveStatus(id);if(button.dataset.action==='edit')openEdit(id);if(button.dataset.action==='delete')deleteItem(id)});
['searchInput','statusFilter','typeFilter'].forEach(id=>{const node=document.getElementById(id);node.addEventListener(id==='searchInput'?'input':'change',render)});
loadItems();
</script></main></body></html>
