<?php
error_reporting(0);
ini_set('display_errors', '0');
require __DIR__ . '/config.php';
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function file_reply($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function file_fail($message, $status = 400) { file_reply(['success' => false, 'message' => $message], $status); }
function file_input($key, $default = '') {
    if (isset($_POST[$key])) return $_POST[$key];
    if (isset($_GET[$key])) return $_GET[$key];
    return $default;
}
function file_authorize($bindId, $side, $token) {
    if ($bindId === '' || !get_bind($bindId)) file_fail('绑定身份无效', 403);
    if ($side === 'mobile' && !validate_mobile_token($bindId, $token)) file_fail('移动端绑定已失效，请重新绑定', 403);
    return $side === 'mobile' ? 'mobile' : 'desktop';
}

// ===== 下载（支持两种方式）=====
// 1) token 方式：他人通过共享领取的一次性下载令牌，无需绑定身份
if ($action === 'download' && trim((string)file_input('token')) !== '') {
    $token = trim((string)file_input('token'));
    $shared = consume_share_download_token($token);
    if (!$shared || $shared['fileId'] === '') file_fail('下载令牌无效或已过期', 403);
    $bindId = $shared['bindId'];
    $fileId = $shared['fileId'];
    $meta = load_file_meta($bindId, $fileId);
    if (!$meta || empty($meta['complete'])) file_fail('文件尚未准备好', 404);
    $dir = file_dir($bindId, $fileId);
    $name = $shared['name'] ?: $meta['name'];
    $encoded = rawurlencode($name);
    header('Content-Type: ' . ($shared['mime'] ?: $meta['mime'] ?: 'application/octet-stream'));
    header('Content-Disposition: attachment; filename="download"; filename*=UTF-8\'\'' . $encoded);
    header('Content-Length: ' . (int)($shared['size'] ?: $meta['size']));
    header('X-Content-Type-Options: nosniff');
    header('X-Checksum-Sha256: ' . compute_file_sha256($bindId, $meta));
    for ($i = 0; $i < (int)$meta['chunkCount']; $i++) {
        $part = $dir . '/chunk-' . $i . '.part';
        if (!is_file($part)) { http_response_code(500); exit; }
        readfile($part);
    }
    exit;
}

$action = trim((string)file_input('action'));
$bindId = trim((string)file_input('bindId'));
$side = file_authorize($bindId, trim((string)file_input('side', 'desktop')), trim((string)file_input('mobileToken')));
$fileId = safe_file_id(file_input('fileId'));
if ($action === 'uploadChunk') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') file_fail('仅支持 POST', 405);
    if (!$fileId) file_fail('文件标识无效');
    $meta = load_file_meta($bindId, $fileId);
    if (!$meta || !empty($meta['complete'])) file_fail('上传会话无效');
    $index = (int)file_input('chunkIndex', -1);
    if ($index < 0 || $index >= (int)$meta['chunkCount']) file_fail('分片序号无效');
    if (!isset($_FILES['chunk']) || $_FILES['chunk']['error'] !== UPLOAD_ERR_OK) file_fail('分片接收失败');
    $tmp = $_FILES['chunk']['tmp_name'];
    // 分片哈希校验（客户端上报时校验，未上报则跳过以向后兼容）
    $chunkHash = trim((string)file_input('chunkHash'));
    if ($chunkHash !== '' && !verify_chunk_hash($tmp, $chunkHash)) {
        @unlink($tmp);
        file_fail('分片哈希校验失败', 400);
    }
    $target = file_dir($bindId, $fileId) . '/chunk-' . $index . '.part';
    if (!move_uploaded_file($tmp, $target)) file_fail('分片保存失败', 500);
    $meta = load_file_meta($bindId, $fileId);
    $uploaded = array_map('intval', (array)($meta['uploaded'] ?? []));
    if (!in_array($index, $uploaded, true)) $uploaded[] = $index;
    sort($uploaded);
    $meta['uploaded'] = $uploaded;
    if (!save_file_meta($bindId, $meta)) file_fail('上传状态保存失败', 500);
    file_reply(['success' => true, 'fileId' => $fileId, 'chunkIndex' => $index, 'uploaded' => $uploaded]);
}

if ($action === 'download') {
    if (!$fileId) file_fail('文件标识无效');
    $meta = load_file_meta($bindId, $fileId);
    if (!$meta || empty($meta['complete'])) file_fail('文件尚未准备好', 404);
    $dir = file_dir($bindId, $fileId);
    $name = $meta['name'];
    $encoded = rawurlencode($name);
    header('Content-Type: ' . ($meta['mime'] ?: 'application/octet-stream'));
    header('Content-Disposition: attachment; filename="download"; filename*=UTF-8\'\'' . $encoded);
    header('Content-Length: ' . (int)$meta['size']);
    header('X-Content-Type-Options: nosniff');
    header('X-Checksum-Sha256: ' . compute_file_sha256($bindId, $meta));
    for ($i = 0; $i < (int)$meta['chunkCount']; $i++) {
        $part = $dir . '/chunk-' . $i . '.part';
        if (!is_file($part)) { http_response_code(500); exit; }
        readfile($part);
    }
    exit;
}
file_fail('未知文件操作');
