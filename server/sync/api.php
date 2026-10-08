<?php

error_reporting(0);
ini_set('display_errors', '0');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => '仅支持 POST 请求'], JSON_UNESCAPED_UNICODE);
    exit;
}
require __DIR__ . '/config.php';

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = [];
}
$action = isset($input['action']) ? trim($input['action']) : '';
$board = isset($input['board']) ? trim($input['board']) : 'system';
$bindId = isset($input['bindId']) ? trim($input['bindId']) : '';

// ===== 能力泛化（模块契约层）=====
// modules.json 里声明的四类能力对应统一端点族；这里把统一名映射到既有实现，
// 旧 action 名继续可用（线上老客户端不受影响）。于是"新增板块"只需在 modules.json 加一条
// + 复用某一类能力，不必再发明一套 action 名。
$ACTION_ALIASES = [
    'module.push' => 'push',               // queue：入队
    'module.pull' => 'pull',               // queue：拉取
    'module.ack' => 'ack',                 // queue：确认消费
    'module.boards' => 'board.list',       // queue：板列表
    'module.boards.update' => 'bind.boards.update',
    'blob.init' => 'transfer.fileInit',     // blob：建立上传会话（元数据）
    'blob.complete' => 'transfer.fileComplete', // blob：校验分片齐全 → 完整哈希 → 生成文件消息
    'realtime.ticket' => 'control.ticket', // realtime：短时票据
];
if (isset($ACTION_ALIASES[$action])) {
    $action = $ACTION_ALIASES[$action];
}

// 阶段 A：过期清理（节流：约每 15 分钟触发一次，随任意请求顺带执行）
run_cleanup_if_due($bindId);

function respond($data) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function error_msg($msg) {
    respond(['success' => false, 'message' => $msg]);
}

function client_ip() {
    return isset($_SERVER['REMOTE_ADDR']) ? (string)$_SERVER['REMOTE_ADDR'] : 'unknown';
}

function limited_text($value, $maxLength) {
    $text = trim((string)$value);
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $maxLength, 'UTF-8');
    }
    return substr($text, 0, $maxLength);
}

/**
 * 统一身份校验入口（所有模块共用）：拒绝时直接返回错误响应，通过时返回 'mobile' / 'desktop'。
 * 具体判定逻辑在 config.php 的 resolve_identity()（api.php 与 file.php 共用同一套）。
 */
function require_identity($bindId, $input) {
    $r = resolve_identity($bindId, $input);
    if (empty($r['ok'])) error_msg($r['message'] !== '' ? $r['message'] : '身份校验失败');
    return $r['side'];
}

/** 老名字保留（transfer.* 的调用点不必全改），语义等同 require_identity */
function require_transfer_identity($bindId, $input) {
    return require_identity($bindId, $input);
}

/** 从请求里取桌面凭证（兼容 deskToken / desk_token / token 三种字段名） */
function input_desk_token($input) {
    foreach (['deskToken', 'desk_token', 'token'] as $key) {
        if (isset($input[$key]) && trim((string)$input[$key]) !== '') return trim((string)$input[$key]);
    }
    return '';
}

/** 控制板块：签发云端 WS 中继连接票据（HMAC，短时效） */
function issue_control_ticket($bindId, $role) {
    global $CONTROL_RELAY_SECRET;
    if (trim((string)$CONTROL_RELAY_SECRET) === '') {
        // fail-closed：拿不到中继密钥就拒发，绝不回退到公开常量
        error_msg('控制中继密钥不可用，请检查服务器 data 目录权限');
    }
    $payload = base64_encode(json_encode([
        'bindId' => $bindId,
        'role' => $role,
        'exp' => time() + 600,
    ]));
    $sig = hash_hmac('sha256', $payload, $CONTROL_RELAY_SECRET);
    return $payload . '.' . $sig;
}

switch ($action) {

    // ===== 模块契约：下发模块清单（移动端/桌面端据此渲染入口，不再各自硬编码）=====
    // 无需绑定即可取（清单是公开目录）；带上有效身份时会附带该绑定的生效策略。
    case 'module.list':
        if (!rate_limit_allow('module.list:' . client_ip(), 120, 60)) {
            error_msg('请求过于频繁，请稍后再试');
        }
        $catalog = sync_modules_for_client($bindId);
        $identity = $bindId !== '' ? resolve_identity($bindId, $input) : ['ok' => false, 'side' => '', 'message' => ''];
        respond([
            'success' => true,
            'version' => $catalog['version'],
            'protocolVersion' => $SYNC_PROTOCOL_VERSION,               // 服务端协议版本
            'clientProtocol' => (int)(isset($input['protocolVersion']) ? $input['protocolVersion'] : 0),
            'capabilities' => $catalog['capabilities'],
            'modules' => $catalog['modules'],
            'bound' => !empty($identity['ok']),
            'side' => $identity['ok'] ? $identity['side'] : '',
            'policySource' => 'platform',
        ]);
        break;

    // ===== 绑定管理（通用，不分 board）=====
    case 'bind.create':
        if (!rate_limit_allow('bind.create:' . client_ip(), 5, 3600)) {
            error_msg('创建绑定过于频繁，请稍后再试');
        }
        // 客户端申请一个新绑定身份（同时签发桌面端凭证；桌面凭证只在此处明文返回一次）
        $bind = create_bind();
        if (!is_array($bind)) {
            error_msg('暂时无法创建绑定，请稍后再试');
        }
        $deskToken = issue_desk_token($bind['bind_id']);
        if (!$deskToken) {
            error_msg('暂时无法创建绑定，请稍后再试');
        }
        respond([
            'success' => true,
            'bindId' => $bind['bind_id'],
            'code' => $bind['code'],
            'deskToken' => $deskToken,
            'bindUrl' => 'https://shortcut.326415.xyz/mobile/?bind=' . urlencode($bind['bind_id']),
        ]);
        break;

    // 桌面凭证的签发/轮换：用**绑定码**（只有桌面端知道，不是公开直链里的 bindId）换取。
    // 允许重复调用（= 轮换）：客户端可能因为重装/配置被覆盖而丢失本地凭证，
    // 若只允许签发一次，这类客户端将永久无法再通过校验（实测踩到：前端整份写配置把字段冲掉）。
    // 强度与既有的 mobile.bind 一致：都只需要绑定码 + IP 限流。
    case 'bind.claimToken':
        if (!rate_limit_allow('bind.claimToken:' . client_ip(), 5, 3600)) {
            error_msg('操作过于频繁，请稍后再试');
        }
        $code = strtoupper(limited_text(isset($input['code']) ? $input['code'] : '', 8));
        if ($code === '') error_msg('绑定码为空');
        $target = resolve_code($code);
        if (!$target) error_msg('绑定码无效');
        $bindRow = get_bind($target);
        if (!$bindRow || strcasecmp((string)($bindRow['code'] ?? ''), $code) !== 0) {
            error_msg('绑定码无效');
        }
        $deskToken = issue_desk_token($target);
        if (!$deskToken) error_msg('签发失败，请稍后再试');
        respond(['success' => true, 'bindId' => $target, 'deskToken' => $deskToken]);
        break;

    case 'bind.info':
        if (!rate_limit_allow('bind.info:' . client_ip(), 120, 60)) {
            error_msg('查询过于频繁，请稍后再试');
        }
        if ($bindId === '') {
            error_msg('缺少 bindId');
        }
        $bind = get_bind($bindId);
        if (!$bind) {
            respond(['success' => true, 'valid' => false]);
        }
        // 绑定码只在**带有效桌面凭证**时返回（原来任何人都能查到别人的 6 位码，
        // 而该码又是控制板块的桌面凭证 → 等于把"远程控制"的钥匙挂在大门上）
        $deskToken = input_desk_token($input);
        $deskOk = validate_desk_token($bindId, $deskToken);
        $payload = ['success' => true, 'valid' => true, 'bindId' => $bindId, 'deskTokenValid' => $deskOk];
        if ($deskOk) {
            $payload['code'] = isset($bind['code']) ? $bind['code'] : '';
            $payload['bindUrl'] = 'https://shortcut.326415.xyz/mobile/?bind=' . urlencode($bindId);
        }
        respond($payload);
        break;

    case 'bind.query':
        if (!rate_limit_allow('bind.query:' . client_ip(), 60, 60)) {
            error_msg('查询过于频繁，请稍后再试');
        }
        // 查询绑定码是否有效
        $code = isset($input['code']) ? trim($input['code']) : '';
        if ($code === '') {
            error_msg('绑定码为空');
        }
        $resolved = resolve_code($code);
        if ($resolved) {
            $bind = get_bind($resolved);
            respond(['success' => true, 'valid' => true, 'bindId' => $resolved]);
        } else {
            respond(['success' => true, 'valid' => false, 'message' => '绑定码无效']);
        }
        break;

    case 'bind.resolve':
        if (!rate_limit_allow('bind.resolve:' . client_ip(), 30, 60)) {
            error_msg('验证过于频繁，请稍后再试');
        }
        // 绑定码 → bindId（手机提交前获取真实 ID）
        $code = isset($input['code']) ? trim($input['code']) : '';
        if ($code === '') {
            error_msg('绑定码为空');
        }
        $resolved = resolve_code($code);
        if ($resolved) {
            $bind = get_bind($resolved);
            respond([
                'success' => true,
                'bindId' => $resolved,
                // 只回显调用方自己输入的码（不再回传服务端存的码，避免多余泄漏面）
                'code' => strtoupper($code),
                'boards' => isset($bind['boards']) && is_array($bind['boards']) ? $bind['boards'] : [],
            ]);
        } else {
            respond(['success' => false, 'message' => '绑定码无效']);
        }
        break;

    case 'mobile.bind':
        if (!rate_limit_allow('mobile.bind:' . client_ip(), 15, 3600)) error_msg('绑定过于频繁，请稍后再试');
        $code = isset($input['code']) ? trim((string)$input['code']) : '';
        $resolved = $bindId !== '' && get_bind($bindId) ? $bindId : resolve_code($code);
        if (!$resolved) error_msg('绑定码无效');
        $deviceName = isset($input['deviceName']) ? limited_text($input['deviceName'], 30) : '我的手机';
        $mobile = issue_mobile_token($resolved, $deviceName);
        if (!$mobile) error_msg('移动端绑定失败');
        $bind = get_bind($resolved);
        respond(['success' => true, 'bindId' => $resolved, 'code' => $bind['code'] ?? '', 'mobileToken' => $mobile['token'], 'deviceId' => $mobile['deviceId'], 'deviceName' => $mobile['deviceName']]);
        break;

    case 'control.ticket':
        // 控制板块：换 10 分钟 WS 中继票据。
        // 移动端用 mobileToken；桌面端用 deskToken（旧绑定在兼容期仍可用绑定码，
        // 但一旦该绑定签发过 deskToken，绑定码通道立即失效）。
        if (!rate_limit_allow('control.ticket:' . client_ip(), 60, 60)) error_msg('请求过于频繁，请稍后再试');
        $role = isset($input['role']) && $input['role'] === 'desktop' ? 'desktop' : 'mobile';
        $targetBind = isset($input['bindId']) ? trim((string)$input['bindId']) : '';
        if ($targetBind === '' || !get_bind($targetBind)) error_msg('绑定身份无效');
        if ($role === 'mobile') {
            $token = isset($input['mobileToken']) ? trim((string)$input['mobileToken']) : '';
            if (!validate_mobile_token($targetBind, $token)) error_msg('移动端绑定已失效，请重新绑定');
        } else {
            $deskToken = input_desk_token($input);
            if (!validate_desk_token($targetBind, $deskToken)) {
                $bindRow = get_bind($targetBind);
                $code = strtoupper(limited_text(isset($input['bindCode']) ? $input['bindCode'] : '', 8));
                $legacyAllowed = !has_desk_token($targetBind) && !require_desk_token_enabled();
                $codeOk = $code !== '' && $bindRow && strcasecmp((string)($bindRow['code'] ?? ''), $code) === 0;
                if (!($legacyAllowed && $codeOk)) error_msg('桌面端凭证无效，请升级 ShortCut 到最新版');
            }
        }
        respond(['success' => true, 'ticket' => issue_control_ticket($targetBind, $role)]);
        break;

    // ===== 能力泛化：blob（文件分片）状态查询 =====
    // 断点续传的地基：客户端上传前先查已确认分片，只补缺片（文档 §5.7 / 验收 §12.4）。
    // 与 file.php 是同一份元数据，但走 JSON API、走统一身份校验。
    case 'blob.status':
        if (!rate_limit_allow('blob.status:' . client_ip(), 120, 60)) error_msg('请求过于频繁，请稍后再试');
        require_identity($bindId, $input);
        $fileId = safe_file_id(isset($input['fileId']) ? $input['fileId'] : '');
        if ($fileId === '') error_msg('文件标识无效');
        $meta = load_file_meta($bindId, $fileId);
        if (!$meta) error_msg('上传会话不存在');
        respond([
            'success' => true,
            'fileId' => $fileId,
            'name' => isset($meta['name']) ? (string)$meta['name'] : '',
            'size' => isset($meta['size']) ? (int)$meta['size'] : 0,
            'chunkSize' => isset($meta['chunkSize']) ? (int)$meta['chunkSize'] : 0,
            'chunkCount' => isset($meta['chunkCount']) ? (int)$meta['chunkCount'] : 0,
            'uploaded' => array_map('intval', (array)(isset($meta['uploaded']) ? $meta['uploaded'] : [])),
            'complete' => !empty($meta['complete']),
            'sha256' => isset($meta['sha256']) ? (string)$meta['sha256'] : '',
        ]);
        break;

    case 'transfer.messages':
        $side = require_transfer_identity($bindId, $input);
        $messages = list_messages($bindId);
        if (!is_array($messages)) error_msg('消息读取失败');
        respond(['success' => true, 'messages' => $messages, 'side' => $side]);
        break;

    case 'transfer.sendText':
        if (!rate_limit_allow('transfer.text:' . client_ip(), 120, 60)) error_msg('发送过于频繁');
        $side = require_transfer_identity($bindId, $input);
        $text = isset($input['text']) ? limited_text($input['text'], 10000) : '';
        if ($text === '') error_msg('文本内容为空');
        $message = ['id' => 'msg_' . bin2hex(random_bytes(12)), 'type' => 'text', 'text' => $text, 'sender' => $side, 'favorite' => false, 'createdAt' => date('c')];
        if (!append_message($bindId, $message)) error_msg('消息保存失败');
        respond(['success' => true, 'message' => $message]);
        break;

    case 'transfer.delete':
        require_transfer_identity($bindId, $input);
        $messageId = isset($input['messageId']) ? trim((string)$input['messageId']) : '';
        if (!preg_match('/^msg_[a-f0-9]{24}$/', $messageId)) error_msg('消息标识无效');
        $messages = list_messages($bindId);
        $removedFile = null;
        foreach ((array)$messages as $item) {
            if ((string)($item['id'] ?? '') === $messageId && !empty($item['fileId'])) $removedFile = safe_file_id($item['fileId']);
        }
        $deleted = delete_message($bindId, $messageId);
        if ($removedFile !== null) remove_file_storage($bindId, $removedFile);
        respond(['success' => true, 'deleted' => $deleted]);
        break;

    case 'transfer.fileInit':
        $side = require_transfer_identity($bindId, $input);
        $name = isset($input['name']) ? $input['name'] : '';
        $size = isset($input['size']) ? $input['size'] : 0;
        if ((int)$size <= 0) error_msg('文件为空');
        if ((int)$size > 1024 * 1024 * 1024) error_msg('单个文件不能超过 1 GB');
        $meta = create_file_meta($bindId, $name, $size, isset($input['mime']) ? $input['mime'] : '', isset($input['chunkSize']) ? $input['chunkSize'] : 2 * 1024 * 1024, $side);
        if (!$meta) error_msg('文件信息无效');
        respond(['success' => true, 'file' => $meta]);
        break;

    case 'transfer.fileComplete':
        $side = require_transfer_identity($bindId, $input);
        $fileId = safe_file_id(isset($input['fileId']) ? $input['fileId'] : '');
        $meta = $fileId ? load_file_meta($bindId, $fileId) : null;
        if (!$meta) error_msg('文件上传会话不存在');
        $uploaded = array_map('intval', (array)($meta['uploaded'] ?? []));
        sort($uploaded);
        $expected = range(0, max(0, (int)$meta['chunkCount'] - 1));
        if ($uploaded !== $expected) error_msg('文件仍有分片未上传');
        // 计算完整文件 SHA-256（分片已全部就位）
        $sha256 = compute_file_sha256($bindId, $meta);
        if ($sha256) $meta['sha256'] = $sha256;
        $message = file_message($meta, $side);
        if (!append_message($bindId, $message)) error_msg('文件消息保存失败');
        $meta['complete'] = true;
        $meta['messageId'] = $message['id'];
        save_file_meta($bindId, $meta);
        respond(['success' => true, 'message' => $message, 'sha256' => $sha256 ? $sha256 : '']);
        break;

    case 'transfer.share':
        require_transfer_identity($bindId, $input);
        // 支持共享文本或文件消息（通过 messageId 引用消息列表中的一条）
        $text = isset($input['text']) ? limited_text($input['text'], 10000) : '';
        $message = null;
        $messageId = isset($input['messageId']) ? preg_replace('/[^a-f0-9]/', '', (string)$input['messageId']) : '';
        if ($text !== '') {
            $message = ['type' => 'text', 'text' => $text];
        } elseif ($messageId !== '' && preg_match('/^msg_[a-f0-9]{24}$/', 'msg_' . $messageId)) {
            $fullId = 'msg_' . $messageId;
            foreach ((array)list_messages($bindId) as $item) {
                if ((string)($item['id'] ?? '') === $fullId) {
                    $message = [
                        'type' => $item['type'] ?? 'text',
                        'text' => $item['text'] ?? '',
                        'fileId' => $item['fileId'] ?? '',
                        'name' => $item['name'] ?? '',
                        'size' => $item['size'] ?? 0,
                        'mime' => $item['mime'] ?? '',
                    ];
                    break;
                }
            }
        }
        if (!$message) error_msg('请提供要共享的文本或选择一个文件消息');
        $share = create_share($bindId, $message, isset($input['code']) ? $input['code'] : '', isset($input['hours']) ? $input['hours'] : 1);
        if (!$share) error_msg('接收密码已被占用或格式无效');
        respond(['success' => true, 'code' => $share['code'], 'expiresAt' => $share['expires_at']]);
        break;

    case 'transfer.shares':
        require_transfer_identity($bindId, $input);
        $shares = list_shares($bindId);
        respond(['success' => true, 'shares' => $shares]);
        break;

    case 'transfer.shareDelete':
        require_transfer_identity($bindId, $input);
        $id = isset($input['id']) ? trim((string)$input['id']) : '';
        if (!preg_match('/^shr_[a-f0-9]{24}$/', $id)) error_msg('共享标识无效');
        $deleted = delete_share($bindId, $id);
        if (!$deleted) error_msg('共享不存在或已删除');
        respond(['success' => true, 'deleted' => true]);
        break;

    case 'transfer.claim':
        $code = isset($input['code']) ? trim((string)$input['code']) : '';
        if (!preg_match('/^[A-Z0-9]{6}$/i', $code)) error_msg('请输入 6 位接收密码');
        $share = claim_share($code);
        if (!$share) error_msg('接收密码无效或已过期');
        $message = $share['message'];
        $downloadToken = '';
        // 文件共享：签发一次性下载令牌（他人无需绑定即可下载）
        if ((string)($message['type'] ?? '') === 'file' && !empty($message['fileId'])) {
            $downloadToken = issue_share_download_token((string)($share['id'] ?? ''));
            if ($downloadToken === null) error_msg('共享文件已领取，请让共享者重新共享');
        }
        respond([
            'success' => true,
            'message' => $message,
            'expiresAt' => $share['expires_at'],
            'downloadToken' => $downloadToken,
        ]);
        break;

    case 'bind.boards.update':
        if (!rate_limit_allow('bind.boards.update:' . client_ip(), 120, 60)) {
            error_msg('任务墙同步过于频繁，请稍后再试');
        }
        require_identity($bindId, $input);
        $rawBoards = isset($input['boards']) && is_array($input['boards']) ? array_slice($input['boards'], 0, 50) : [];
        $boards = [];
        foreach ($rawBoards as $name) {
            $clean = limited_text($name, 40);
            if ($clean !== '' && !in_array($clean, $boards, true)) {
                $boards[] = $clean;
            }
        }
        if (!update_bind_boards($bindId, $boards)) {
            error_msg('任务墙列表同步失败');
        }
        respond(['success' => true, 'boards' => $boards]);
        break;

    // ===== 任务墙队列 =====
    case 'push':
        if (!rate_limit_allow('push:' . client_ip(), 30, 60)) {
            error_msg('提交过于频繁，请稍后再试');
        }
        if ($board !== 'taskwall') {
            error_msg('暂不支持的板块');
        }
        if ($bindId === '') {
            error_msg('缺少 bindId');
        }
        $bind = get_bind($bindId);
        if (!$bind) {
            error_msg('绑定身份无效');
        }
        // 统一身份校验：手机用 mobileToken；桌面端新版用 deskToken（旧版在兼容期走 side 自报）
        require_identity($bindId, $input);
        $text = isset($input['text']) ? limited_text($input['text'], 120) : '';
        if ($text === '') {
            error_msg('任务标题不能为空');
        }
        // 可选字段
        $longText = isset($input['longText']) && $input['longText'] === true;
        $reminderEnabled = isset($input['reminderEnabled']) && $input['reminderEnabled'] === true;
        $details = $longText && isset($input['details']) ? limited_text($input['details'], 2000) : '';
        $reminderAt = $reminderEnabled && isset($input['reminderAt']) ? limited_text($input['reminderAt'], 64) : '';
        $boardName = isset($input['boardName']) ? limited_text($input['boardName'], 40) : '';
        if ($reminderAt !== '' && strtotime($reminderAt) === false) {
            error_msg('提醒时间格式无效');
        }

        $task = [
            'id' => 'rmt_' . bin2hex(random_bytes(12)),
            'text' => $text,
            'longText' => $longText,
            'details' => $details,
            'reminderEnabled' => $reminderEnabled,
            'reminderAt' => $reminderAt,
            'boardName' => $boardName,
            'createdAt' => date('c'),
        ];
        if (!enqueue_task($board, $bindId, $task)) {
            error_msg('待同步任务已达到上限，请先打开桌面端接收');
        }
        respond(['success' => true, 'taskId' => $task['id']]);
        break;

    case 'pull':
        if (!rate_limit_allow('pull:' . client_ip(), 120, 60)) {
            error_msg('拉取过于频繁，请稍后再试');
        }
        if ($board !== 'taskwall') {
            error_msg('暂不支持的板块');
        }
        require_identity($bindId, $input);
        $tasks = peek_all($board, $bindId);
        if (!is_array($tasks)) {
            error_msg('暂时无法拉取任务，请稍后再试');
        }
        respond([
            'success' => true,
            'tasks' => $tasks,
            'count' => count($tasks),
        ]);
        break;

    case 'ack':
        if (!rate_limit_allow('ack:' . client_ip(), 120, 60)) {
            error_msg('确认过于频繁，请稍后再试');
        }
        if ($board !== 'taskwall') {
            error_msg('暂不支持的板块');
        }
        require_identity($bindId, $input);
        $taskIds = isset($input['taskIds']) && is_array($input['taskIds'])
            ? array_values(array_filter(array_slice($input['taskIds'], 0, 500), function ($id) {
                return is_string($id) && preg_match('/^rmt_[a-f0-9]{24}$/', $id);
            }))
            : [];
        if (!$taskIds) {
            error_msg('缺少待确认任务');
        }
        $removed = acknowledge_tasks($board, $bindId, $taskIds);
        if ($removed === false) {
            error_msg('暂时无法确认任务，请稍后再试');
        }
        respond(['success' => true, 'removed' => $removed]);
        break;

    case 'board.list':
        if ($board !== 'taskwall') {
            error_msg('暂不支持的板块');
        }
        require_identity($bindId, $input);
        $bind = get_bind($bindId);
        $boards = isset($bind['boards']) && is_array($bind['boards']) ? $bind['boards'] : [];
        respond(['success' => true, 'boards' => $boards]);
        break;

    default:
        error_msg('未知操作');
}
