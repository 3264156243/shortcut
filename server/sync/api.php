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

function require_transfer_identity($bindId, $input) {
    if ($bindId === '' || !get_bind($bindId)) error_msg('绑定身份无效');
    $side = isset($input['side']) ? trim((string)$input['side']) : 'desktop';
    if ($side === 'mobile') {
        $token = isset($input['mobileToken']) ? trim((string)$input['mobileToken']) : '';
        if (!validate_mobile_token($bindId, $token)) error_msg('移动端绑定已失效，请重新绑定');
    }
    return $side === 'mobile' ? 'mobile' : 'desktop';
}

switch ($action) {

    // ===== 绑定管理（通用，不分 board）=====
    case 'bind.create':
        if (!rate_limit_allow('bind.create:' . client_ip(), 5, 3600)) {
            error_msg('创建绑定过于频繁，请稍后再试');
        }
        // 客户端申请一个新绑定身份
        $bind = create_bind();
        if (!is_array($bind)) {
            error_msg('暂时无法创建绑定，请稍后再试');
        }
        respond([
            'success' => true,
            'bindId' => $bind['bind_id'],
            'code' => $bind['code'],
            'bindUrl' => 'https://shortcut.326415.xyz/mobile/?bind=' . urlencode($bind['bind_id']),
        ]);
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
        respond([
            'success' => true,
            'valid' => true,
            'bindId' => $bindId,
            'code' => isset($bind['code']) ? $bind['code'] : '',
            'bindUrl' => 'https://shortcut.326415.xyz/mobile/?bind=' . urlencode($bindId),
        ]);
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
                'code' => isset($bind['code']) ? $bind['code'] : strtoupper($code),
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
        if ($bindId === '' || !get_bind($bindId)) {
            error_msg('绑定身份无效');
        }
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
        if (isset($input['side']) && $input['side'] === 'mobile') {
            $token = isset($input['mobileToken']) ? trim((string)$input['mobileToken']) : '';
            if (!validate_mobile_token($bindId, $token)) error_msg('移动端绑定已失效，请重新绑定');
        }
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
        if ($bindId === '') {
            error_msg('缺少 bindId');
        }
        $bind = get_bind($bindId);
        if (!$bind) {
            error_msg('绑定身份无效');
        }
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
        if ($bindId === '' || !get_bind($bindId)) {
            error_msg('绑定身份无效');
        }
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
        if ($bindId === '') {
            error_msg('缺少 bindId');
        }
        $bind = get_bind($bindId);
        if (!$bind) {
            error_msg('绑定身份无效');
        }
        $boards = isset($bind['boards']) && is_array($bind['boards']) ? $bind['boards'] : [];
        respond(['success' => true, 'boards' => $boards]);
        break;

    default:
        error_msg('未知操作');
}
