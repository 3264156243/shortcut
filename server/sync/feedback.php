<?php
/**
 * 官网「问题反馈」接收接口
 * ---------------------------------------------------------------------------
 * 部署位置：/sync/feedback.php（与 config.php 同目录，复用其 $DATA_DIR）
 * 存储：{DATA_DIR}/feedback/feedback-YYYY-MM.jsonl（逐行 JSON，追加写入）
 *
 * 防护（这是公开接口，不设防会被灌库）：
 *   - 只接受 POST + JSON
 *   - 蜜罐字段 hp：被填即静默成功（不告诉机器人它被拦了）
 *   - 按 IP 限流：每小时 5 条、每天 20 条
 *   - 单条内容 5~4000 字，联系方式 ≤120 字，其余字段全部截断
 *   - IP 不落库，只存加盐哈希（盐 = 中继密钥，随服务器唯一）
 *   - 文件写入带 LOCK_EX，避免并发写坏
 */

declare(strict_types=1);

require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/** 统一响应 */
function fb_reply(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fb_clean_text(string $value, int $limit): string
{
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', trim($value)) ?? trim($value);
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $limit, 'UTF-8');
    }
    return substr($value, 0, $limit);
}

function fb_read_public_items(string $dataDir): array
{
    $rows = [];
    foreach (glob(rtrim($dataDir, '/') . '/feedback/feedback-*.jsonl') ?: [] as $file) {
        foreach (@file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $row = json_decode($line, true);
            if (!is_array($row) || empty($row['id'])) continue;
            $id = (string)$row['id'];
            $title = trim((string)($row['title'] ?? ''));
            $area = trim((string)($row['area'] ?? ''));
            $details = trim((string)($row['details'] ?? ''));
            $content = trim((string)($row['content'] ?? ''));
            if ($title === '' && preg_match('/\[(?:标题|Summary)\]\s*(.+)/u', $content, $match)) {
                $title = trim($match[1]);
            }
            if ($title === '') {
                $title = preg_split('/\R/u', $content)[0] ?? '未命名反馈';
                $title = preg_replace('/^\[[^\]]+\]\s*/u', '', $title) ?? $title;
            }
            if ($details === '') $details = $content;
            $rows[$id] = [
                'id' => $id,
                'time' => (string)($row['time'] ?? ''),
                'type' => (string)($row['type'] ?? 'other'),
                'title' => fb_clean_text($title, 120),
                'area' => fb_clean_text($area, 60),
                'details' => fb_clean_text($details, 4000),
                'version' => (string)($row['version'] ?? ''),
            ];
        }
    }

    $byId = [];
    $replyFile = rtrim($dataDir, '/') . '/feedback/feedback-replies.jsonl';
    foreach (@file($replyFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $reply = json_decode($line, true);
        if (is_array($reply) && !empty($reply['feedback_id'])) {
            $byId[(string)$reply['feedback_id']][] = $reply;
        }
    }

    $items = [];
    foreach ($rows as $id => $row) {
        $status = 'pending';
        $publicReply = null;
        foreach ($byId[$id] ?? [] as $entry) {
            if (!empty($entry['status'])) $status = (string)$entry['status'];
            $body = trim((string)($entry['body'] ?? ''));
            if ($body !== '') {
                $publicReply = [
                    'time' => (string)($entry['time'] ?? ''),
                    'body' => fb_clean_text($body, 4000),
                    'status' => (string)($entry['status'] ?? ''),
                ];
            }
        }
        if ($status === 'hidden') continue;
        $row['status'] = $status === 'open' ? 'pending' : $status;
        $row['reply'] = $publicReply;
        $row['replyTime'] = $publicReply['time'] ?? '';
        $items[] = $row;
    }
    return $items;
}

/* ── 1. 只接受 POST ───────────────────────────────────────────────────── */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fb_reply(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

/* ── 2. 解析入参 ──────────────────────────────────────────────────────── */
$raw = file_get_contents('php://input');
if (strlen((string)$raw) > 65536) {
    fb_reply(['ok' => false, 'error' => 'payload_too_large'], 413);
}
$in = json_decode((string)$raw, true);
if (!is_array($in)) {
    $in = $_POST;
}

/* ── 2.2. 公开留言列表 ─────────────────────────────────────────────────── */
if (($in['action'] ?? '') === 'publicList') {
    $items = fb_read_public_items($DATA_DIR);
    $statusFilter = trim((string)($in['status'] ?? 'all'));
    $typeFilter = trim((string)($in['type'] ?? 'all'));
    $query = mb_strtolower(trim((string)($in['query'] ?? '')), 'UTF-8');
    $sort = (string)($in['sort'] ?? 'latest');

    $items = array_values(array_filter($items, static function ($item) use ($statusFilter, $typeFilter, $query) {
        if ($statusFilter !== 'all' && ($item['status'] ?? '') !== $statusFilter) return false;
        if ($typeFilter !== 'all' && ($item['type'] ?? '') !== $typeFilter) return false;
        if ($query === '') return true;
        $haystack = mb_strtolower(($item['title'] ?? '') . "\n" . ($item['area'] ?? '') . "\n" . ($item['details'] ?? ''), 'UTF-8');
        return strpos($haystack, $query) !== false;
    }));

    usort($items, static function ($a, $b) use ($sort) {
        if ($sort === 'replied') {
            $aTime = (string)($a['replyTime'] ?? '');
            $bTime = (string)($b['replyTime'] ?? '');
            if ($aTime !== '' && $bTime !== '') return strcmp($bTime, $aTime);
            if ($aTime !== '') return -1;
            if ($bTime !== '') return 1;
            return strcmp((string)($b['time'] ?? ''), (string)($a['time'] ?? ''));
        }
        return strcmp((string)($b['time'] ?? ''), (string)($a['time'] ?? ''));
    });

    fb_reply(['ok' => true, 'items' => array_slice($items, 0, 100)]);
}
if (!is_array($in)) {
    fb_reply(['ok' => false, 'error' => 'bad_request'], 400);
}

/* ── 2.5. 用户查询回复（POST action=lookup）────────────────────────────── */
if (($in['action'] ?? '') === 'lookup') {
    $lookupId = trim((string)($in['id'] ?? ''));
    $lookupToken = trim((string)($in['token'] ?? ''));
    if (!preg_match('/^[a-f0-9]{12}$/', $lookupId) || !preg_match('/^[a-f0-9]{32}$/', $lookupToken)) {
        fb_reply(['ok' => false, 'error' => 'bad_lookup'], 400);
    }

    $found = null;
    foreach (glob(rtrim($DATA_DIR, '/') . '/feedback/feedback-*.jsonl') ?: [] as $feedbackFile) {
        $lines = @file($feedbackFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $row = json_decode($line, true);
            if (!is_array($row) || ($row['id'] ?? '') !== $lookupId) continue;
            $hash = (string)($row['token_hash'] ?? '');
            if ($hash !== '' && hash_equals($hash, hash('sha256', $lookupToken))) {
                $found = $row;
                break 2;
            }
        }
    }
    if (!$found) {
        fb_reply(['ok' => false, 'error' => 'not_found', 'message' => '反馈编号或查询凭据不正确'], 404);
    }

    $replies = [];
    $replyFile = rtrim($DATA_DIR, '/') . '/feedback/feedback-replies.jsonl';
    foreach ((@file($replyFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) as $line) {
        $row = json_decode($line, true);
        if (is_array($row) && ($row['feedback_id'] ?? '') === $lookupId) $replies[] = $row;
    }

    /* 状态以最后一条回复为准（反馈本身是追加式日志，不回写） */
    $status = 'open';
    foreach ($replies as $replyRow) {
        if (!empty($replyRow['status'])) $status = (string)$replyRow['status'];
    }

    fb_reply([
        'ok' => true,
        'feedback' => [
            'id' => $found['id'],
            'time' => $found['time'] ?? '',
            'type' => $found['type'] ?? 'other',
            'content' => $found['content'] ?? '',
            'status' => $status,
        ],
        'replies' => $replies,
    ]);
}

/* ── 3. 蜜罐：大概率是机器人 ──────────────────────────────────────────── */
if (!empty($in['hp'])) {
    fb_reply(['ok' => true, 'skipped' => true]);
}

/* ── 4. 字段校验与清洗 ────────────────────────────────────────────────── */
$allowedTypes = ['bug', 'feature', 'ui', 'update', 'other'];
$type = strtolower(trim((string)($in['type'] ?? 'other')));
if (!in_array($type, $allowedTypes, true)) {
    $type = 'other';
}

$content = trim((string)($in['content'] ?? ''));
$title = trim((string)($in['title'] ?? ''));
$area = trim((string)($in['area'] ?? ''));
$details = trim((string)($in['details'] ?? ''));
$contact = trim((string)($in['contact'] ?? ''));
$version = trim((string)($in['version'] ?? ''));
$pageUrl = trim((string)($in['page'] ?? ''));

if ($details === '') $details = $content;
if ($content === '') {
    $content = trim('[' . ($area !== '' ? $area : '反馈') . '] ' . $title . "\n\n" . $details);
}
if ($title === '') {
    $firstLine = preg_split('/\R/u', $details)[0] ?? '未命名反馈';
    $title = preg_replace('/^\[[^\]]+\]\s*/u', '', $firstLine) ?? $firstLine;
}

if (function_exists('mb_strlen')) {
    $len = mb_strlen($details, 'UTF-8');
} else {
    $len = strlen($details);
}

if ($len < 5) {
    fb_reply(['ok' => false, 'error' => 'content_too_short', 'message' => '内容太短了，请再多写几句'], 400);
}
if ($len > 4000) {
    fb_reply(['ok' => false, 'error' => 'content_too_long', 'message' => '内容过长，请控制在 4000 字以内'], 400);
}

if (function_exists('mb_substr')) {
    $title = fb_clean_text($title, 120);
    $area = fb_clean_text($area, 60);
    $details = fb_clean_text($details, 4000);
    $contact = mb_substr($contact, 0, 120, 'UTF-8');
    $version = mb_substr($version, 0, 40, 'UTF-8');
    $pageUrl = mb_substr($pageUrl, 0, 300, 'UTF-8');
} else {
    $title = fb_clean_text($title, 120);
    $area = fb_clean_text($area, 60);
    $details = fb_clean_text($details, 4000);
    $contact = substr($contact, 0, 120);
    $version = substr($version, 0, 40);
    $pageUrl = substr($pageUrl, 0, 300);
}

// 去掉控制字符，保留换行
$content = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $content) ?? $content;

/* ── 5. 限流（按 IP 哈希）─────────────────────────────────────────────── */
$ip = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$salt = isset($CONTROL_RELAY_SECRET) && $CONTROL_RELAY_SECRET !== '' ? $CONTROL_RELAY_SECRET : 'shortcut-feedback';
$ipHash = hash('sha256', $ip . '|' . $salt);

$rateFile = rtrim($DATA_DIR, '/') . '/feedback-rate.json';
$now = time();
$hourAgo = $now - 3600;
$dayAgo = $now - 86400;

$rates = [];
if (is_readable($rateFile)) {
    $tmp = json_decode((string)file_get_contents($rateFile), true);
    if (is_array($tmp)) {
        $rates = $tmp;
    }
}
$mine = array_values(array_filter(
    isset($rates[$ipHash]) && is_array($rates[$ipHash]) ? $rates[$ipHash] : [],
    static function ($t) use ($dayAgo) { return is_int($t) && $t > $dayAgo; }
));
$inHour = count(array_filter($mine, static function ($t) use ($hourAgo) { return $t > $hourAgo; }));

if ($inHour >= 5) {
    fb_reply(['ok' => false, 'error' => 'rate_limited', 'message' => '提交太频繁了，请过一会儿再试'], 429);
}
if (count($mine) >= 20) {
    fb_reply(['ok' => false, 'error' => 'rate_limited', 'message' => '今日提交次数已达上限，请明天再来'], 429);
}

/* ── 6. 写入 JSONL ────────────────────────────────────────────────────── */
$fbDir = rtrim($DATA_DIR, '/') . '/feedback';
if (!is_dir($fbDir) && !@mkdir($fbDir, 0775, true) && !is_dir($fbDir)) {
    fb_reply(['ok' => false, 'error' => 'storage_unavailable', 'message' => '服务端存储目录不可用'], 500);
}

$token = bin2hex(random_bytes(16));
$tokenHash = hash('sha256', $token);

$entry = [
    'id' => bin2hex(random_bytes(6)),
    'token_hash' => $tokenHash,
    'time' => gmdate('c'),
    'type' => $type,
    'title' => $title,
    'area' => $area,
    'details' => $details,
    'content' => $content,
    'contact' => $contact,
    'version' => $version,
    'page' => $pageUrl,
    'ua' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300),
    'ip' => substr($ipHash, 0, 16),
];

$line = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
$file = $fbDir . '/feedback-' . gmdate('Y-m') . '.jsonl';
$ok = @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);

if ($ok === false) {
    fb_reply(['ok' => false, 'error' => 'write_failed', 'message' => '保存失败，请稍后再试'], 500);
}
@chmod($file, 0640);

/* ── 7. 记录限流（失败也不影响已成功的提交）───────────────────────────── */
$mine[] = $now;
$rates[$ipHash] = $mine;
// 顺手清理 7 天前的记录，避免文件无限增长
foreach ($rates as $k => $list) {
    if (!is_array($list)) {
        unset($rates[$k]);
        continue;
    }
    $keep = array_values(array_filter($list, static function ($t) use ($dayAgo) { return is_int($t) && $t > $dayAgo; }));
    if (!$keep) {
        unset($rates[$k]);
    } else {
        $rates[$k] = $keep;
    }
}
@file_put_contents($rateFile, json_encode($rates, JSON_UNESCAPED_UNICODE), LOCK_EX);

fb_reply(['ok' => true, 'id' => $entry['id'], 'token' => $token]);
