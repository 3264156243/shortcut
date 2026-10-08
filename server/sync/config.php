<?php

// 数据目录：测试环境保持原布局（__DIR__ . '/data'）。
// 生产迁移时建议移出 web 根（站点根是 /www/wwwroot/ShortCut，同级目录不在任何 URL 之下），
// 届时把下面这一行改成绝对路径即可。
$DATA_DIR = __DIR__ . '/data';
$BINDS_FILE = $DATA_DIR . '/binds.json';
$QUEUE_DIR = $DATA_DIR . '/queues';
$RATE_LIMIT_FILE = $DATA_DIR . '/rate-limits.json';
$MESSAGE_DIR = $DATA_DIR . '/messages';
$SHARES_FILE = $DATA_DIR . '/shares.json';
$FILE_DIR = $DATA_DIR . '/files';
// 模块清单（服务端权威，与代码同目录，便于部署时一起更新）
$MODULES_FILE = __DIR__ . '/modules.json';
$MAX_QUEUE_ITEMS = 500;

// ===== 控制板块（手机控制电脑）：云端 WS 中继共享密钥（与 relay.js 共用）=====
// 若密钥文件存在则优先读取（便于服务器上轮换密钥而不改代码）。
// 注意：**不再回退到硬编码常量** —— 那等于把"给任意 bindId 伪造控制票据"的钥匙公开。
// 拿不到密钥时置空，签发处会拒发（fail-closed），并在日志/错误信息里提示修 data 目录权限。
$CONTROL_SECRET_FILE = $DATA_DIR . '/control-relay-secret.txt';
$CONTROL_RELAY_SECRET = '';
if (is_readable($CONTROL_SECRET_FILE)) {
    $CONTROL_RELAY_SECRET = trim((string)file_get_contents($CONTROL_SECRET_FILE));
} else {
    // 首次运行自动生成随机密钥落盘，保证每台服务器唯一
    if (is_dir($DATA_DIR) && is_writable($DATA_DIR) && !file_exists($CONTROL_SECRET_FILE)) {
        try { file_put_contents($CONTROL_SECRET_FILE, bin2hex(random_bytes(24)), LOCK_EX); } catch (\Throwable $t) {}
    }
    if (is_readable($CONTROL_SECRET_FILE)) {
        $CONTROL_RELAY_SECRET = trim((string)file_get_contents($CONTROL_SECRET_FILE));
    }
}

// ===== 通用：flock 封装 =====
function with_lock($file, $fn) {
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $fp = fopen($file . '.lock', 'c+');
    if (!$fp) {
        return false;
    }
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        return false;
    }
    try {
        $result = $fn();
        return $result;
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function json_read_unlocked($file) {
    if (!file_exists($file)) {
        return [];
    }
    $raw = file_get_contents($file);
    if ($raw === false) {
        return false;
    }
    if (trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : false;
}

function json_write_unlocked($file, $data) {
    $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($payload === false) {
        return false;
    }
    try {
        $suffix = bin2hex(random_bytes(6));
    } catch (Throwable $error) {
        $suffix = uniqid('', true);
    }
    $tmp = $file . '.' . getmypid() . '.' . $suffix . '.tmp';
    $written = file_put_contents($tmp, $payload, LOCK_EX);
    if ($written !== strlen($payload)) {
        @unlink($tmp);
        return false;
    }
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function json_lock_read($file) {
    return with_lock($file, function () use ($file) {
        return json_read_unlocked($file);
    });
}

function json_lock_write($file, $data) {
    return with_lock($file, function () use ($file, $data) {
        return json_write_unlocked($file, $data);
    });
}

function json_lock_update($file, $fn) {
    return with_lock($file, function () use ($file, $fn) {
        $data = json_read_unlocked($file);
        if (!is_array($data)) {
            return false;
        }
        $result = $fn($data);
        if (!is_array($result) || !array_key_exists('data', $result)) {
            return false;
        }
        if (!json_write_unlocked($file, $result['data'])) {
            return false;
        }
        return array_key_exists('result', $result) ? $result['result'] : true;
    });
}

// ===== 绑定管理 =====
function load_binds() {
    global $BINDS_FILE;
    if (!file_exists($BINDS_FILE)) {
        return [];
    }
    return json_lock_read($BINDS_FILE);
}

function save_binds($binds) {
    global $BINDS_FILE;
    return json_lock_write($BINDS_FILE, $binds);
}

// 生成高熵绑定 ID（24 位 base62）
function generate_bind_id() {
    $chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    $len = strlen($chars);
    $id = '';
    for ($i = 0; $i < 24; $i++) {
        $id .= $chars[random_int(0, $len - 1)];
    }
    return $id;
}

// 生成 6 位绑定短码（保证唯一）
function generate_bind_code($existingCodes) {
    $chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    $len = strlen($chars);
    $existingSet = array_flip($existingCodes);
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= $chars[random_int(0, $len - 1)];
        }
        if (!isset($existingSet[$code])) {
            return $code;
        }
    }
    return null;
}

// 创建绑定
function create_bind() {
    global $BINDS_FILE;
    return json_lock_update($BINDS_FILE, function ($binds) {
        $existingCodes = [];
        foreach ($binds as $b) {
            if (isset($b['code'])) {
                $existingCodes[] = $b['code'];
            }
        }
        do {
            $bindId = generate_bind_id();
        } while (isset($binds[$bindId]));
        $code = generate_bind_code($existingCodes);
        if ($code === null) {
            return ['data' => $binds, 'result' => false];
        }
        $bind = [
            'code' => $code,
            'bind_id' => $bindId,
            'created_at' => date('c'),
            'device_name' => '',
        ];
        $binds[$bindId] = $bind;
        return ['data' => $binds, 'result' => $bind];
    });
}

// 短码 → bindId
function resolve_code($code) {
    $code = strtoupper(trim($code));
    if ($code === '') {
        return null;
    }
    $binds = load_binds();
    if (!is_array($binds)) {
        return null;
    }
    foreach ($binds as $bindId => $info) {
        if (isset($info['code']) && strtoupper(trim($info['code'])) === $code) {
            return $bindId;
        }
    }
    return null;
}

// bindId → 绑定时
function get_bind($bindId) {
    $binds = load_binds();
    if (!is_array($binds)) {
        return null;
    }
    return isset($binds[$bindId]) ? $binds[$bindId] : null;
}

function update_bind_boards($bindId, $boards) {
    global $BINDS_FILE;
    return json_lock_update($BINDS_FILE, function ($binds) use ($bindId, $boards) {
        if (!isset($binds[$bindId])) {
            return ['data' => $binds, 'result' => false];
        }
        $binds[$bindId]['boards'] = array_values($boards);
        $binds[$bindId]['boards_updated_at'] = date('c');
        return ['data' => $binds, 'result' => true];
    });
}

function issue_mobile_token($bindId, $deviceName) {
    global $BINDS_FILE;
    $plainToken = bin2hex(random_bytes(24));
    $deviceId = bin2hex(random_bytes(12));
    $updated = json_lock_update($BINDS_FILE, function ($binds) use ($bindId, $deviceName, $plainToken, $deviceId) {
        if (!isset($binds[$bindId])) return ['data' => $binds, 'result' => false];
        $binds[$bindId]['mobile'] = [
            'device_id' => $deviceId,
            'device_name' => $deviceName !== '' ? $deviceName : '我的手机',
            'token_hash' => hash('sha256', $plainToken),
            'bound_at' => date('c'),
            'last_seen_at' => date('c'),
        ];
        return ['data' => $binds, 'result' => true];
    });
    return $updated ? ['token' => $plainToken, 'deviceId' => $deviceId, 'deviceName' => $deviceName !== '' ? $deviceName : '我的手机'] : false;
}

function validate_mobile_token($bindId, $token) {
    $bind = get_bind($bindId);
    $hash = isset($bind['mobile']['token_hash']) ? (string)$bind['mobile']['token_hash'] : '';
    return $hash !== '' && $token !== '' && hash_equals($hash, hash('sha256', $token));
}

// ===== 桌面端凭证（deskToken）=====
// 为什么需要：原来桌面侧请求只要自报 side=desktop 就算通过（没有任何凭证），
// 于是"知道 bindId"就等于"能读写删全部消息与文件"。deskToken 与 mobileToken 同构：
// 服务端只存 sha256、一个绑定一个有效凭证（重新签发即轮换）、请求时用 hash_equals 比对。
function issue_desk_token($bindId) {
    global $BINDS_FILE;
    $plainToken = bin2hex(random_bytes(24));
    $updated = json_lock_update($BINDS_FILE, function ($binds) use ($bindId, $plainToken) {
        if (!isset($binds[$bindId])) return ['data' => $binds, 'result' => false];
        $binds[$bindId]['desk'] = [
            'token_hash' => hash('sha256', $plainToken),
            'issued_at' => date('c'),
        ];
        return ['data' => $binds, 'result' => true];
    });
    return $updated ? $plainToken : false;
}

function validate_desk_token($bindId, $token) {
    if ($bindId === '' || $token === '') return false;
    $bind = get_bind($bindId);
    $hash = isset($bind['desk']['token_hash']) ? (string)$bind['desk']['token_hash'] : '';
    return $hash !== '' && hash_equals($hash, hash('sha256', $token));
}

function has_desk_token($bindId) {
    $bind = get_bind($bindId);
    return isset($bind['desk']['token_hash']) && (string)$bind['desk']['token_hash'] !== '';
}

// 强制模式开关（settings.json → requireDeskToken）：
// 关闭时保留"旧版桌面客户端"的兼容通道，打开后桌面侧必须带有效 deskToken。
function require_desk_token_enabled() {
    $settings = sync_settings_read();
    return !empty($settings['requireDeskToken']);
}

/**
 * 统一身份校验 —— 移动互联平台唯一入口。
 *
 * 凭证优先：mobileToken → 'mobile'；deskToken → 'desktop'。
 * 兼容期（绑定尚未签发过 deskToken 且未开启强制模式）：允许旧版客户端的 side 自报，
 * 但只要该绑定签发过 deskToken（或服务端开了强制模式），免凭证路径立即失效 —— 这样
 * 旧版装机不会立刻断，新版客户端一启动就会拿到 deskToken 并把自己这条绑定升级为"强制"。
 *
 * 返回 ['ok' => bool, 'side' => 'mobile'|'desktop', 'message' => string]
 */
function resolve_identity($bindId, $input) {
    if ($bindId === '' || !get_bind($bindId)) {
        return ['ok' => false, 'side' => '', 'message' => '绑定身份无效'];
    }
    $mobileToken = isset($input['mobileToken']) ? trim((string)$input['mobileToken']) : '';
    $deskToken = '';
    foreach (['deskToken', 'desk_token', 'token'] as $key) {
        if (isset($input[$key]) && trim((string)$input[$key]) !== '') {
            $deskToken = trim((string)$input[$key]);
            break;
        }
    }
    if ($mobileToken !== '' && validate_mobile_token($bindId, $mobileToken)) {
        return ['ok' => true, 'side' => 'mobile', 'message' => ''];
    }
    if ($deskToken !== '' && validate_desk_token($bindId, $deskToken)) {
        return ['ok' => true, 'side' => 'desktop', 'message' => ''];
    }
    // 出示了凭证但没通过 → 一律拒绝。
    // （不能因为"这个绑定还没签发过凭证"就回落到兼容通道：那样凭证轮换/失效会被静默掩盖，
    //   线上验收就是这么发现"带错误 deskToken 仍然放行"的。）
    if ($mobileToken !== '' || $deskToken !== '') {
        return ['ok' => false, 'side' => '', 'message' => '凭证已失效，请重新绑定或升级客户端'];
    }
    if (has_desk_token($bindId) || require_desk_token_enabled()) {
        return [
            'ok' => false,
            'side' => '',
            'message' => '请升级 ShortCut 到最新版（缺少桌面端凭证）',
        ];
    }
    // 兼容通道：只有"从未签发过 deskToken 的旧绑定"能走到这里
    $side = isset($input['side']) ? trim((string)$input['side']) : 'desktop';
    if ($side === 'mobile') {
        return ['ok' => false, 'side' => '', 'message' => '移动端绑定已失效，请重新绑定'];
    }
    return ['ok' => true, 'side' => 'desktop', 'message' => ''];
}

function message_path($bindId) {
    global $MESSAGE_DIR;
    $safe = preg_replace('/[^a-zA-Z0-9_-]/', '_', $bindId);
    if (!is_dir($MESSAGE_DIR)) mkdir($MESSAGE_DIR, 0755, true);
    return $MESSAGE_DIR . '/' . $safe . '.json';
}

function list_messages($bindId) {
    $path = message_path($bindId);
    return file_exists($path) ? json_lock_read($path) : [];
}

function append_message($bindId, $message) {
    $path = message_path($bindId);
    return json_lock_update($path, function ($messages) use ($message) {
        $messages[] = $message;
        if (count($messages) > 1000) $messages = array_slice($messages, -1000);
        return ['data' => $messages, 'result' => $message];
    });
}

function delete_message($bindId, $messageId) {
    $path = message_path($bindId);
    return json_lock_update($path, function ($messages) use ($messageId) {
        $next = array_values(array_filter($messages, function ($item) use ($messageId) {
            return (string)($item['id'] ?? '') !== $messageId;
        }));
        return ['data' => $next, 'result' => count($messages) !== count($next)];
    });
}

function safe_file_id($value) {
    return preg_match('/^file_[a-f0-9]{24}$/', (string)$value) ? (string)$value : null;
}

function file_dir($bindId, $fileId = '') {
    global $FILE_DIR;
    $safeBind = preg_replace('/[^a-zA-Z0-9_-]/', '_', $bindId);
    $dir = $FILE_DIR . '/' . $safeBind;
    if ($fileId !== '') $dir .= '/' . preg_replace('/[^a-zA-Z0-9_-]/', '_', $fileId);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    return $dir;
}

function file_meta_path($bindId, $fileId) { return file_dir($bindId, $fileId) . '/meta.json'; }

function save_file_meta($bindId, $meta) { return json_lock_write(file_meta_path($bindId, $meta['id']), $meta); }

// 分片哈希校验：期望是 64 位 hex（sha256）；分片内容不匹配返回 false
function verify_chunk_hash($tmpPath, $expectedHash) {
    $expectedHash = strtolower(trim((string)$expectedHash));
    if ($expectedHash === '') return true; // 客户端未上报哈希则跳过（向后兼容）
    if (!preg_match('/^[a-f0-9]{64}$/', $expectedHash)) return false;
    $actual = hash_file('sha256', $tmpPath);
    return $actual === $expectedHash;
}

// 拼接全部分片计算完整文件 SHA-256
function compute_file_sha256($bindId, $meta) {
    $dir = file_dir($bindId, $meta['id']);
    $ctx = hash_init('sha256');
    for ($i = 0; $i < (int)$meta['chunkCount']; $i++) {
        $part = $dir . '/chunk-' . $i . '.part';
        if (!is_file($part)) return null;
        $handle = @fopen($part, 'rb');
        if (!$handle) return null;
        while (!feof($handle)) {
            $buf = fread($handle, 1024 * 1024);
            if ($buf === false) { fclose($handle); return null; }
            hash_update($ctx, $buf);
        }
        fclose($handle);
    }
    return hash_final($ctx);
}

function load_file_meta($bindId, $fileId) {
    $id = safe_file_id($fileId);
    if ($id === null) return null;
    $path = file_meta_path($bindId, $id);
    return file_exists($path) ? json_lock_read($path) : null;
}

function remove_file_storage($bindId, $fileId) {
    $dir = file_dir($bindId, $fileId);
    if (!is_dir($dir)) return true;
    $items = scandir($dir);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . '/' . $item;
        if (is_file($path)) @unlink($path);
    }
    @rmdir($dir);
    return true;
}

function create_file_meta($bindId, $name, $size, $mime, $chunkSize, $side) {
    $safeName = limited_filename($name);
    if ($safeName === '') return false;
    $size = max(0, min((int)$size, 1024 * 1024 * 1024));
    $chunkSize = max(256 * 1024, min((int)$chunkSize, 5 * 1024 * 1024));
    $mimeText = trim((string)$mime);
    if (function_exists('mb_substr')) $mimeText = mb_substr($mimeText, 0, 120, 'UTF-8'); else $mimeText = substr($mimeText, 0, 120);
    $meta = ['id' => 'file_' . bin2hex(random_bytes(12)), 'name' => $safeName, 'size' => $size, 'mime' => $mimeText, 'chunkSize' => $chunkSize, 'chunkCount' => max(1, (int)ceil($size / $chunkSize)), 'uploaded' => [], 'sender' => $side, 'createdAt' => date('c')];
    return save_file_meta($bindId, $meta) ? $meta : false;
}

function limited_filename($value) {
    $name = trim((string)$value);
    $name = str_replace(["\\", '/', "\0"], '_', $name);
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, 180, 'UTF-8'); else $name = substr($name, 0, 180);
    return $name;
}

function file_message($meta, $side) {
    return ['id' => 'msg_' . bin2hex(random_bytes(12)), 'type' => 'file', 'fileId' => $meta['id'], 'name' => $meta['name'], 'size' => $meta['size'], 'mime' => $meta['mime'], 'sender' => $side, 'favorite' => false, 'createdAt' => date('c')];
}

function create_share($bindId, $message, $customCode, $hours, $allowsFile = true) {
    global $SHARES_FILE;
    return json_lock_update($SHARES_FILE, function ($shares) use ($bindId, $message, $customCode, $hours, $allowsFile) {
        $code = strtoupper(trim($customCode));
        // 自动生成或校验自定义 6 位码
        if ($code !== '') {
            if (!preg_match('/^[A-Z0-9]{6}$/', $code)) return ['data' => $shares, 'result' => false];
        }
        $now = time();
        foreach ($shares as $share) {
            if ((string)($share['code'] ?? '') === $code && strtotime((string)($share['expires_at'] ?? '')) > $now) {
                return ['data' => $shares, 'result' => false]; // 已被占用的码
            }
        }
        if ($code === '') {
            $activeCodes = [];
            foreach ($shares as $share) {
                if (strtotime((string)($share['expires_at'] ?? '')) > $now) $activeCodes[] = (string)($share['code'] ?? '');
            }
            $attempts = 0;
            do { $code = generate_bind_code($activeCodes); $attempts++; }
            while ((in_array($code, $activeCodes, true) || $code === null) && $attempts < 50);
            if ($code === null) return ['data' => $shares, 'result' => false];
        }
        // 时长上限 24 小时（小时数支持小数，最长 24）
        $hoursNum = max(0.5, min(24, (float)$hours));
        $share = [
            'id' => 'shr_' . bin2hex(random_bytes(12)),
            'code' => $code,
            'bind_id' => $bindId,
            'message' => $message,
            'created_at' => date('c'),
            'expires_at' => date('c', $now + round($hoursNum * 3600)),
        ];
        $shares[] = $share;
        return ['data' => $shares, 'result' => $share];
    });
}

function list_shares($bindId) {
    global $SHARES_FILE;
    if (!file_exists($SHARES_FILE)) return [];
    $shares = json_lock_read($SHARES_FILE);
    $now = time();
    $mine = [];
    foreach ((array)$shares as $share) {
        if ((string)($share['bind_id'] ?? '') === $bindId && strtotime((string)($share['expires_at'] ?? '')) > $now) {
            $mine[] = [
                'id' => $share['id'] ?? '',
                'code' => $share['code'] ?? '',
                'expiresAt' => $share['expires_at'] ?? '',
                'type' => $share['message']['type'] ?? 'text',
                'name' => $share['message']['name'] ?? '',
                'size' => $share['message']['size'] ?? 0,
                'text' => isset($share['message']['text']) ? limited_share_text($share['message']['text']) : '',
                'createdAt' => $share['created_at'] ?? '',
            ];
        }
    }
    return $mine;
}

function limited_share_text($text) {
    $t = trim((string)$text);
    if (function_exists('mb_substr')) return mb_substr($t, 0, 60, 'UTF-8');
    return substr($t, 0, 60);
}

function delete_share($bindId, $shareId) {
    global $SHARES_FILE;
    return json_lock_update($SHARES_FILE, function ($shares) use ($bindId, $shareId) {
        $exists = false;
        $next = [];
        foreach ($shares as $share) {
            if ((string)($share['id'] ?? '') === $shareId && (string)($share['bind_id'] ?? '') === $bindId) {
                $exists = true;
                continue;
            }
            $next[] = $share;
        }
        return ['data' => $next, 'result' => $exists];
    });
}


function claim_share($code) {
    global $SHARES_FILE;
    $shares = file_exists($SHARES_FILE) ? json_lock_read($SHARES_FILE) : [];
    $code = strtoupper(trim($code));
    foreach ((array)$shares as $share) {
        if ((string)($share['code'] ?? '') === $code && strtotime((string)($share['expires_at'] ?? '')) > time()) return $share;
    }
    return null;
}

// 为文件共享签发一次性下载令牌（短时有效，领取后作废）
function issue_share_download_token($shareId) {
    global $SHARES_FILE;
    $created = false;
    $result = json_lock_update($SHARES_FILE, function ($shares) use ($shareId, &$created) {
        foreach ($shares as &$share) {
            if ((string)($share['id'] ?? '') === $shareId && (string)($share['message']['type'] ?? '') === 'file') {
                $share['download_token'] = 'dl_' . bin2hex(random_bytes(24));
                $share['download_token_expires'] = date('c', time() + 900); // 15 分钟
                $created = true;
                return ['data' => $shares, 'result' => $share['download_token']];
            }
        }
        return ['data' => $shares, 'result' => null];
    });
    if (!$created) return null;
    return $result;
}

// 用下载令牌定位文件共享（未领取/未过期），返回 [bindId, fileId, meta name/size/mime]
function consume_share_download_token($token) {
    global $SHARES_FILE;
    $token = trim((string)$token);
    if (!preg_match('/^dl_[a-f0-9]{48}$/', $token)) return null;
    $now = time();
    $found = null;
    $next = [];
    json_lock_update($SHARES_FILE, function ($shares) use ($token, $now, &$found, &$next) {
        foreach ($shares as $share) {
            $t = (string)($share['download_token'] ?? '');
            if ((string)($share['id'] ?? '') !== '' && $found === null
                && $t === $token
                && strtotime((string)($share['download_token_expires'] ?? '')) > $now
                && strtotime((string)($share['expires_at'] ?? '')) > $now) {
                $found = [
                    'bindId' => (string)($share['bind_id'] ?? ''),
                    'fileId' => (string)($share['message']['fileId'] ?? ''),
                    'name' => (string)($share['message']['name'] ?? 'file'),
                    'size' => (int)($share['message']['size'] ?? 0),
                    'mime' => (string)($share['message']['mime'] ?? 'application/octet-stream'),
                ];
                // 一次性：领取即清除令牌
                unset($share['download_token']);
                unset($share['download_token_expires']);
            }
            $next[] = $share;
        }
        return ['data' => $next];
    });
    return $found;
}


// ===== 队列管理（通用，按 board + bindId）=====
function queue_path($board, $bindId) {
    global $QUEUE_DIR;
    $safeBind = preg_replace('/[^a-zA-Z0-9_-]/', '_', $bindId);
    $dir = $QUEUE_DIR . '/' . $board;
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir . '/' . $safeBind . '.json';
}

function load_queue($board, $bindId) {
    $path = queue_path($board, $bindId);
    if (!file_exists($path)) {
        return [];
    }
    return json_lock_read($path);
}

function save_queue($board, $bindId, $tasks) {
    $path = queue_path($board, $bindId);
    return json_lock_write($path, $tasks);
}

// 入队
function enqueue_task($board, $bindId, $task) {
    global $MAX_QUEUE_ITEMS;
    $path = queue_path($board, $bindId);
    return json_lock_update($path, function ($tasks) use ($task, $MAX_QUEUE_ITEMS) {
        if (count($tasks) >= $MAX_QUEUE_ITEMS) {
            return ['data' => $tasks, 'result' => false];
        }
        $tasks[] = $task;
        return ['data' => $tasks, 'result' => true];
    });
}

// 读取待消费任务。由客户端成功写入本地后再确认删除。
function peek_all($board, $bindId) {
    $path = queue_path($board, $bindId);
    if (!file_exists($path)) {
        return [];
    }
    return json_lock_read($path);
}

// 确认消费指定任务。
function acknowledge_tasks($board, $bindId, $taskIds) {
    $path = queue_path($board, $bindId);
    $idSet = array_fill_keys(array_values(array_filter($taskIds, 'is_string')), true);
    return json_lock_update($path, function ($tasks) use ($idSet) {
        $remaining = array_values(array_filter($tasks, function ($task) use ($idSet) {
            $id = isset($task['id']) ? (string)$task['id'] : '';
            return $id === '' || !isset($idSet[$id]);
        }));
        return ['data' => $remaining, 'result' => count($tasks) - count($remaining)];
    });
}

// 轻量限流。返回 true 表示允许本次请求。
function rate_limit_allow($key, $limit, $windowSeconds) {
    global $RATE_LIMIT_FILE;
    $now = time();
    return json_lock_update($RATE_LIMIT_FILE, function ($records) use ($key, $limit, $windowSeconds, $now) {
        foreach ($records as $recordKey => $timestamps) {
            $recent = array_values(array_filter((array)$timestamps, function ($stamp) use ($now, $windowSeconds) {
                return is_numeric($stamp) && (int)$stamp > $now - $windowSeconds;
            }));
            if ($recent) {
                $records[$recordKey] = $recent;
            } else {
                unset($records[$recordKey]);
            }
        }
        $entries = isset($records[$key]) ? (array)$records[$key] : [];
        $allowed = count($entries) < $limit;
        if ($allowed) {
            $entries[] = $now;
            $records[$key] = $entries;
        }
        return ['data' => $records, 'result' => $allowed];
    });
}

// ===== 过期清理（阶段 A：过期消息、孤立分片、失效分享、失效会话）=====

$SETTINGS_FILE = $DATA_DIR . '/settings.json';
$ACTIVATION_CONFIG_PATH = dirname(__DIR__) . '/activation/data/activation_config.json';

// 读取此绑定所属用户组的消息保留时长（小时），读不到则用平台默认
function sync_retention_hours($bindId = '') {
    global $ACTIVATION_CONFIG_PATH;
    $default = 24;
    $config = null;
    if (file_exists($ACTIVATION_CONFIG_PATH)) {
        $raw = @file_get_contents($ACTIVATION_CONFIG_PATH);
        $decoded = json_decode((string)$raw, true);
        if (is_array($decoded)) $config = $decoded;
    }
    $hours = 0;
    if (is_array($config)) {
        $bindLookup = [];
        if (isset($config['binds']) && is_array($config['binds'])) {
            // 多配置文件中无绑定到用户组映射；此处直接取匹配不到绑定时的平台策略
        }
        $groups = isset($config['groups']) && is_array($config['groups']) ? $config['groups'] : [];
        foreach ($groups as $group) {
            if (is_array($group) && isset($group['fileTransferPolicy']['retentionHours'])) {
                $hours = max($hours, (int)$group['fileTransferPolicy']['retentionHours']);
            }
        }
    }
    return $hours > 0 ? $hours : $default;
}

// ===== 模块契约层（移动互联平台）=====
// modules.json 是服务端权威清单：新增板块只在这里加一条 + 实现它声明的能力端点。
// 客户端（桌面/移动）通过 module.list 取清单，不再各自硬编码卡片。
function sync_modules_catalog() {
    global $MODULES_FILE;
    $fallback = [
        'version' => 1,
        'capabilities' => [],
        'modules' => [
            ['id' => 'taskwall', 'label' => '任务墙', 'icon' => '🗂️', 'desc' => '把任务从手机钉到桌面任务墙', 'entry' => '/taskwall/', 'capabilities' => ['queue'], 'defaultEnabled' => true],
            ['id' => 'fileTransfer', 'label' => '文件共享', 'icon' => '📤', 'desc' => '发送/领取文件与文本，共享给他人', 'entry' => '/transfer/', 'capabilities' => ['blob'], 'defaultEnabled' => true],
            ['id' => 'control', 'label' => '电脑控制', 'icon' => '🖥️', 'desc' => '手机向电脑打字、控制鼠标、粘贴板', 'entry' => '/control/', 'capabilities' => ['realtime'], 'defaultEnabled' => true],
        ],
    ];
    if (!file_exists($MODULES_FILE)) return $fallback;
    $decoded = json_decode((string)@file_get_contents($MODULES_FILE), true);
    if (!is_array($decoded) || !isset($decoded['modules']) || !is_array($decoded['modules'])) return $fallback;
    return $decoded;
}

/**
 * 模块的平台级策略（用户组策略里对应该模块的字段，取"最宽松"值）。
 * 说明：激活后台的分组是按机器码授予的，同步服务端目前拿不到 bindId → 分组 的映射，
 * 因此这里先取平台级结果；按绑定精确下发等后续补 bindId→分组 映射（见架构文档第五节）。
 */
function sync_module_policy($moduleId) {
    global $ACTIVATION_CONFIG_PATH;
    $policy = [];
    if (file_exists($ACTIVATION_CONFIG_PATH)) {
        $decoded = json_decode((string)@file_get_contents($ACTIVATION_CONFIG_PATH), true);
        $groups = (is_array($decoded) && isset($decoded['groups']) && is_array($decoded['groups'])) ? $decoded['groups'] : [];
        foreach ($groups as $group) {
            if (!is_array($group)) continue;
            $candidate = null;
            if ($moduleId === 'fileTransfer' && isset($group['fileTransferPolicy']) && is_array($group['fileTransferPolicy'])) {
                $candidate = $group['fileTransferPolicy'];
            } elseif (isset($group['modulePolicies'][$moduleId]) && is_array($group['modulePolicies'][$moduleId])) {
                $candidate = $group['modulePolicies'][$moduleId];
            }
            if (!is_array($candidate)) continue;
            foreach ($candidate as $key => $value) {
                if (is_bool($value)) {
                    $policy[$key] = (!isset($policy[$key]) || $policy[$key] === false) ? $value : $policy[$key];
                } elseif (is_numeric($value)) {
                    $policy[$key] = isset($policy[$key]) ? max((int)$policy[$key], (int)$value) : (int)$value;
                }
            }
        }
    }
    return $policy;
}

/** 对外下发的模块清单（目录 + 生效策略）。不包含任何凭证或绑定私有信息。 */
function sync_modules_for_client($bindId = '') {
    $catalog = sync_modules_catalog();
    $out = [];
    foreach ($catalog['modules'] as $module) {
        if (!is_array($module) || empty($module['id'])) continue;
        $id = (string)$module['id'];
        $policy = isset($module['policy']) && is_array($module['policy']) ? $module['policy'] : [];
        $policy = array_merge($policy, sync_module_policy($id));
        $item = [
            'id' => $id,
            'label' => isset($module['label']) ? (string)$module['label'] : $id,
            'icon' => isset($module['icon']) ? (string)$module['icon'] : '•',
            'desc' => isset($module['desc']) ? (string)$module['desc'] : '',
            'entry' => isset($module['entry']) ? (string)$module['entry'] : '',
            'capabilities' => isset($module['capabilities']) && is_array($module['capabilities']) ? array_values($module['capabilities']) : [],
            'minAppVersion' => isset($module['minAppVersion']) ? (string)$module['minAppVersion'] : '',
            'enabled' => isset($module['defaultEnabled']) ? (bool)$module['defaultEnabled'] : true,
            'policy' => $policy,
        ];
        // 策略里显式关闭分享也给前端一个明确信号（与 shareEnabled 同义，便于移动页灰掉入口）
        if ($id === 'fileTransfer' && isset($policy['shareEnabled']) && $policy['shareEnabled'] === false) {
            $item['shareEnabled'] = false;
        }
        $out[] = $item;
    }
    return ['version' => isset($catalog['version']) ? (int)$catalog['version'] : 1, 'capabilities' => isset($catalog['capabilities']) ? $catalog['capabilities'] : [], 'modules' => $out];
}

// 读取或初始化 sync 本地设置（lastCleanupAt 等）
function sync_settings_read() {
    global $SETTINGS_FILE;
    if (!file_exists($SETTINGS_FILE)) return ['lastCleanupAt' => 0, 'createdAt' => date('c')];
    return json_lock_read($SETTINGS_FILE);
}

function sync_settings_write($settings) {
    global $SETTINGS_FILE;
    return json_lock_write($SETTINGS_FILE, $settings);
}

// 清理已过期的分享记录
function cleanup_expired_shares() {
    global $SHARES_FILE;
    if (!file_exists($SHARES_FILE)) return 0;
    $now = time();
    return json_lock_update($SHARES_FILE, function ($shares) use ($now) {
        $kept = [];
        $removed = 0;
        foreach ($shares as $share) {
            if (strtotime((string)($share['expires_at'] ?? '')) > $now) {
                $kept[] = $share;
            } else {
                $removed++;
            }
        }
        return ['data' => $kept, 'result' => $removed];
    });
}

// 清理某绑定下已过期或不再被任何消息引用的文件分片（孤立分片）
function cleanup_expired_files($retentionHours) {
    global $FILE_DIR;
    if (!is_dir($FILE_DIR)) return 0;
    $maxAge = $retentionHours * 3600;
    $now = time();
    $removed = 0;
    $binds = @scandir($FILE_DIR);
    if (!$binds) return 0;
    foreach ($binds as $bindId) {
        if ($bindId === '.' || $bindId === '..') continue;
        $bindDir = $FILE_DIR . '/' . $bindId;
        if (!is_dir($bindDir)) continue;
        // 消息引用集合：该绑定当前仍被引用的 fileId
        $referenced = [];
        $msgPath = message_path($bindId);
        if (file_exists($msgPath)) {
            $messages = json_lock_read($msgPath);
            foreach ($messages as $msg) {
                if (is_array($msg) && !empty($msg['fileId'])) $referenced[$msg['fileId']] = true;
            }
        }
        $files = @scandir($bindDir);
        if (!$files) continue;
        foreach ($files as $fileId) {
            if ($fileId === '.' || $fileId === '..') continue;
            $fileDir = $bindDir . '/' . $fileId;
            if (!is_dir($fileDir)) continue;
            $remove = !isset($referenced[$fileId]); // 孤立文件
            if (!$remove) {
                // 仍被引用：按保留时长清理（未被收藏）
                $metaPath = $fileDir . '/meta.json';
                if (file_exists($metaPath)) {
                    $meta = json_lock_read($metaPath);
                    $createdAt = isset($meta['createdAt']) ? strtotime((string)$meta['createdAt']) : $now;
                    // 校验消息是否收藏
                    $favorited = false;
                    if (file_exists($msgPath)) {
                        $messages = json_lock_read($msgPath);
                        foreach ($messages as $msg) {
                            if (is_array($msg) && ($msg['fileId'] ?? '') === $fileId && !empty($msg['favorite'])) { $favorited = true; break; }
                        }
                    }
                    if (!$favorited && $createdAt > 0 && ($now - $createdAt) > $maxAge) $remove = true;
                } else {
                    $remove = true; // 无 meta 的残留目录
                }
            }
            if ($remove) {
                remove_file_storage($bindId, $fileId);
                $removed++;
            }
        }
    }
    return $removed;
}

// 清理过期消息（未收藏，超过保留时长）；返回移除的 fileId 集合供文件清理
function cleanup_expired_messages($retentionHours) {
    global $MESSAGE_DIR;
    if (!is_dir($MESSAGE_DIR)) return [];
    $maxAge = $retentionHours * 3600;
    $now = time();
    $removedFileIds = [];
    $binds = @scandir($MESSAGE_DIR);
    if (!$binds) return [];
    foreach ($binds as $bindId) {
        if ($bindId === '.' || $bindId === '..') continue;
        $path = $MESSAGE_DIR . '/' . $bindId . '.json';
        if (!file_exists($path)) continue;
        json_lock_update($path, function ($messages) use ($maxAge, $now, &$removedFileIds) {
            $kept = [];
            foreach ($messages as $msg) {
                if (!is_array($msg)) continue;
                if (!empty($msg['favorite'])) { $kept[] = $msg; continue; }
                $createdAt = isset($msg['createdAt']) ? strtotime((string)$msg['createdAt']) : $now;
                if ($createdAt > 0 && ($now - $createdAt) > $maxAge) {
                    if (!empty($msg['fileId'])) $removedFileIds[] = $msg['fileId'];
                    continue;
                }
                $kept[] = $msg;
            }
            return ['data' => $kept];
        });
    }
    return $removedFileIds;
}

// 清理限流旧记录
function cleanup_rate_limits() {
    global $RATE_LIMIT_FILE;
    if (!file_exists($RATE_LIMIT_FILE)) return 0;
    $now = time();
    return json_lock_update($RATE_LIMIT_FILE, function ($records) use ($now) {
        $kept = [];
        foreach ($records as $key => $timestamps) {
            $recent = array_values(array_filter((array)$timestamps, function ($stamp) use ($now) {
                return is_numeric($stamp) && (int)$stamp > $now - 86400;
            }));
            if ($recent) $kept[$key] = $recent;
        }
        return ['data' => $kept, 'result' => 0];
    });
}

// 统一的过期清理入口：节流（默认 15 分钟一次），返回清理统计
function run_cleanup_if_due($bindId = '') {
    $settings = sync_settings_read();
    $cleanupInterval = 900;
    $now = time();
    $last = isset($settings['lastCleanupAt']) ? (int)$settings['lastCleanupAt'] : 0;
    if ($now - $last < $cleanupInterval) return null;
    $retentionHours = sync_retention_hours($bindId);
    $stats = [
        'shares' => cleanup_expired_shares(),
        'messages' => 0,
        'files' => cleanup_expired_files($retentionHours),
        'rateLimits' => 0,
    ];
    $removedFileIds = cleanup_expired_messages($retentionHours);
    $stats['messages'] = count($removedFileIds);
    cleanup_rate_limits();
    // 被删消息引用的文件若无其他消息引用，已被 cleanup_expired_files 处理（下一轮），无需再动
    $settings['lastCleanupAt'] = $now;
    $settings['lastCleanupStats'] = $stats;
    sync_settings_write($settings);
    return $stats;
}
