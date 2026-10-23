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
$RTC_DIR = $DATA_DIR . '/rtc';
// 模块清单（服务端权威，与代码同目录，便于部署时一起更新）
$MODULES_FILE = __DIR__ . '/modules.json';
$MAX_QUEUE_ITEMS = 500;
// 移动互联协议版本：服务端在每个响应里回传它，客户端（移动页/将来的安卓壳）据此判断兼容性。
// 改协议时递增，并在服务端按客户端声明的版本做兼容分支。
$SYNC_PROTOCOL_VERSION = 1;

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

// ===== 设备与凭证（多设备模型）=====
// 为什么从"单槽"改成"列表"（2026-10-09 身份层补完）：
//   原来 `mobile` / `desk` 各只有一个槽位，`issue_mobile_token` 直接覆写整个 mobile 槽 ——
//   第二台手机一扫码就**静默顶掉**第一台：旧手机没有任何提示，之后所有请求变成
//   403「移动端绑定已失效」，用户完全不知道为什么；桌面端也看不到"当前绑了哪些设备"，
//   更没有移除入口（设置里只有二维码和绑定码，没有设备管理）。
//
// 存储（binds[bindId]）：
//   devices: [ { device_id, device_key, device_name, side: 'mobile'|'desktop',
//                token_hash, bound_at, last_seen_at } ]
//
// 旧 `mobile` / `desk` 单槽继续**可读**（由 bind_devices 投影成列表），并在下一次写入
// （注册 / 改名 / 移除 / 心跳）时并成 devices[] 且删掉旧槽 —— 因此既不需要停机迁移脚本，
// 也不会丢任何已签发凭证，老客户端不受影响。

/** 手机设备数上限：settings.json → maxMobileDevices（缺省 5，钳制 1..20） */
function max_mobile_devices() {
    $settings = sync_settings_read();
    if (!is_array($settings)) {
        $settings = [];
    }
    $limit = isset($settings['maxMobileDevices']) ? (int)$settings['maxMobileDevices'] : 5;
    if ($limit < 1) {
        $limit = 1;
    }
    if ($limit > 20) {
        $limit = 20;
    }
    return $limit;
}

/** 设备名限长（config.php 不依赖 api.php 的 limited_text，便于 file.php 单独引用本文件） */
function limited_device_name($value, $side) {
    $text = trim((string)$value);
    if ($text === '') {
        return $side === 'mobile' ? '我的手机' : '本机电脑';
    }
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, 30, 'UTF-8');
    }
    return substr($text, 0, 30);
}

/**
 * 把绑定的设备统一成列表（兼容旧 mobile/desk 单槽）。**只读投影，不写盘。**
 * 旧槽没有 device_id，用旧槽名 + token_hash 前缀合成稳定 id（legacy-mobile-ab12cd34），
 * 这样"移除旧设备"也能精确定位到它。
 */
function bind_devices($bind) {
    $devices = [];
    if (is_array($bind) && isset($bind['devices']) && is_array($bind['devices'])) {
        foreach ($bind['devices'] as $device) {
            if (is_array($device) && isset($device['device_id']) && isset($device['token_hash'])) {
                $devices[] = $device;
            }
        }
    }
    foreach (['mobile' => 'mobile', 'desk' => 'desktop'] as $slotKey => $side) {
        if (!is_array($bind) || !isset($bind[$slotKey]) || !is_array($bind[$slotKey])) {
            continue;
        }
        $slot = $bind[$slotKey];
        $hash = isset($slot['token_hash']) ? (string)$slot['token_hash'] : '';
        if ($hash === '') {
            continue;
        }
        $duplicate = false;
        foreach ($devices as $device) {
            if (hash_equals((string)$device['token_hash'], $hash)) {
                $duplicate = true;
                break;
            }
        }
        if ($duplicate) {
            continue;
        }
        $devices[] = [
            'device_id' => 'legacy-' . $slotKey . '-' . substr($hash, 0, 12),
            'device_key' => '',
            'device_name' => (isset($slot['device_name']) && $slot['device_name'] !== '')
                ? (string)$slot['device_name']
                : ($side === 'mobile' ? '我的手机' : '本机电脑'),
            'side' => $side,
            'token_hash' => $hash,
            'bound_at' => isset($slot['bound_at'])
                ? (string)$slot['bound_at']
                : (isset($slot['issued_at']) ? (string)$slot['issued_at'] : ''),
            'last_seen_at' => isset($slot['last_seen_at']) ? (string)$slot['last_seen_at'] : '',
        ];
    }
    return $devices;
}

/** 取出持有该凭证的设备；未命中返回 null。$side 为空表示不限端。 */
function match_device($bind, $token, $side = '') {
    $token = (string)$token;
    if ($token === '' || !is_array($bind)) {
        return null;
    }
    $hash = hash('sha256', $token);
    foreach (bind_devices($bind) as $device) {
        if ($side !== '' && (string)$device['side'] !== $side) {
            continue;
        }
        if (hash_equals((string)$device['token_hash'], $hash)) {
            return $device;
        }
    }
    return null;
}

/** 规范写入：把设备列表落成 devices[] 并删掉旧单槽（写路径上顺带完成迁移） */
function store_devices(&$binds, $bindId, array $devices) {
    $binds[$bindId]['devices'] = array_values($devices);
    unset($binds[$bindId]['mobile'], $binds[$bindId]['desk']);
}

/** 设备列表的对外投影（**绝不带 token_hash**），供 API / 桌面端设置面板使用 */
function list_devices($bindId) {
    $bind = get_bind($bindId);
    if (!$bind) {
        return [];
    }
    $out = [];
    foreach (bind_devices($bind) as $device) {
        $out[] = [
            'deviceId' => (string)$device['device_id'],
            'deviceName' => (string)$device['device_name'],
            'side' => (string)$device['side'],
            'boundAt' => (string)$device['bound_at'],
            'lastSeenAt' => (string)$device['last_seen_at'],
        ];
    }
    return $out;
}

/**
 * 注册 / 轮换一台设备的凭证。
 *
 * 手机：`device_key` 是手机浏览器自己生成的稳定标识（存在 localStorage）。同一台手机重新绑定
 * 时**原地轮换**而不是新增一条 —— 否则反复重绑会把设备上限占满，列表里堆一堆同名僵尸设备。
 * 电脑：`desk` 保持单台语义（一个绑定一份桌面凭证），再次签到时替换原来那条。
 *
 * 返回 ['token','deviceId','deviceName'] 或 ['error' => 'limit'|'notfound']。
 */
function register_device($bindId, $side, $deviceName, $deviceKey = '') {
    global $BINDS_FILE;
    $plainToken = bin2hex(random_bytes(24));
    $newDeviceId = bin2hex(random_bytes(12));
    $name = limited_device_name($deviceName, $side);
    $key = trim((string)$deviceKey);
    if (strlen($key) > 64) {
        $key = substr($key, 0, 64);
    }
    $limit = max_mobile_devices();
    $failure = null;
    $effectiveId = $newDeviceId;
    $updated = json_lock_update($BINDS_FILE, function ($binds) use ($bindId, $side, $name, $key, $plainToken, $newDeviceId, $limit, &$failure, &$effectiveId) {
        if (!isset($binds[$bindId])) {
            $failure = 'notfound';
            return ['data' => $binds, 'result' => false];
        }
        $devices = bind_devices($binds[$bindId]);
        $now = date('c');
        $index = -1;
        $keylessMobile = -1;
        foreach ($devices as $i => $device) {
            $deviceSide = (string)$device['side'];
            if ($side === 'desktop') {
                // 桌面单台语义：替换原有的电脑条目（含旧 legacy 槽）
                if ($deviceSide === 'desktop') {
                    $index = $i;
                    break;
                }
                continue;
            }
            if ($deviceSide !== 'mobile') {
                continue;
            }
            // 同一台手机（稳定 deviceKey）重新绑定 → 原地轮换，不占新名额
            if ($key !== '' && isset($device['device_key']) && (string)$device['device_key'] === $key) {
                $index = $i;
                break;
            }
            // 迁移期兜底：从旧单槽投影出来的手机行没有 device_key。那台手机重绑时（最典型的是
            // 清了浏览器数据 / 换了浏览器 → deviceKey 变了）如果另起一行，用户就会在设备列表里
            // 看到两台"我的手机"，还得手动删一台。这里让它**就地接管**那一行（凭证换新、
            // 补上 deviceKey、沿用原 bound_at）。只在"恰好一行无 key 手机"时生效 ——
            // 旧单槽最多只能投影出一行，所以不会误接管别人的设备。
            if ($key !== '' && $keylessMobile < 0
                && (!isset($device['device_key']) || (string)$device['device_key'] === '')) {
                $keylessMobile = $i;
            }
        }
        if ($index < 0 && $side === 'mobile' && $keylessMobile >= 0) {
            $index = $keylessMobile;
        }
        if ($index < 0 && $side === 'mobile') {
            $mobileCount = 0;
            foreach ($devices as $device) {
                if ((string)$device['side'] === 'mobile') {
                    $mobileCount++;
                }
            }
            if ($mobileCount >= $limit) {
                $failure = 'limit';
                return ['data' => $binds, 'result' => false];
            }
        }
        $effectiveId = $index >= 0 ? (string)$devices[$index]['device_id'] : $newDeviceId;
        $entry = [
            'device_id' => $effectiveId,
            'device_key' => $key,
            'device_name' => $name,
            'side' => $side,
            'token_hash' => hash('sha256', $plainToken),
            'bound_at' => ($index >= 0 && !empty($devices[$index]['bound_at']))
                ? (string)$devices[$index]['bound_at']
                : $now,
            'last_seen_at' => $now,
        ];
        if ($index >= 0) {
            $devices[$index] = $entry;
        } else {
            $devices[] = $entry;
        }
        store_devices($binds, $bindId, $devices);
        return ['data' => $binds, 'result' => true];
    });
    if ($updated) {
        return ['token' => $plainToken, 'deviceId' => $effectiveId, 'deviceName' => $name];
    }
    return ['error' => $failure === null ? 'notfound' : $failure];
}

/**
 * 更新"最后活跃"时间。**节流 60 秒**：同一个设备 60 秒内不重复写盘，
 * 避免每个带身份的请求都加一次文件锁 + 落盘（原来这个字段只在绑定时写一次，是假数据）。
 */
function touch_device_last_seen($bindId, $deviceId) {
    if ($bindId === '' || $deviceId === '') {
        return false;
    }
    $bind = get_bind($bindId);
    if (!$bind) {
        return false;
    }
    $devices = bind_devices($bind);
    $index = -1;
    foreach ($devices as $i => $device) {
        if ((string)$device['device_id'] === $deviceId) {
            $index = $i;
            break;
        }
    }
    if ($index < 0) {
        return false;
    }
    $last = isset($devices[$index]['last_seen_at']) ? strtotime((string)$devices[$index]['last_seen_at']) : 0;
    if ($last > 0 && (time() - $last) < 60) {
        return true;
    }
    $devices[$index]['last_seen_at'] = date('c');
    global $BINDS_FILE;
    return (bool) json_lock_update($BINDS_FILE, function ($binds) use ($bindId, $devices) {
        if (!isset($binds[$bindId])) {
            return ['data' => $binds, 'result' => false];
        }
        // 乐观校验：设备集合数量变了说明并发里有注册/移除，本次心跳放弃（下次请求会再写）
        if (count(bind_devices($binds[$bindId])) !== count($devices)) {
            return ['data' => $binds, 'result' => false];
        }
        store_devices($binds, $bindId, $devices);
        return ['data' => $binds, 'result' => true];
    });
}

/**
 * 移除一台设备：**只撤销凭证**（该设备下次请求返回「失效」并自动跳回绑定页），
 * 不清理它产生的任务/消息/文件 —— 那些数据按"绑定"归属而不是按"设备"归属。
 */
function remove_device($bindId, $deviceId) {
    global $BINDS_FILE;
    $deviceId = trim((string)$deviceId);
    if ($bindId === '' || $deviceId === '') {
        return false;
    }
    return (bool) json_lock_update($BINDS_FILE, function ($binds) use ($bindId, $deviceId) {
        if (!isset($binds[$bindId])) {
            return ['data' => $binds, 'result' => false];
        }
        $next = [];
        $removed = false;
        foreach (bind_devices($binds[$bindId]) as $device) {
            if ((string)$device['device_id'] === $deviceId) {
                $removed = true;
                continue;
            }
            $next[] = $device;
        }
        if (!$removed) {
            return ['data' => $binds, 'result' => false];
        }
        store_devices($binds, $bindId, $next);
        return ['data' => $binds, 'result' => true];
    });
}

/** 给一台设备改名（30 字以内）。返回改后的名字，失败返回 null。 */
function rename_device($bindId, $deviceId, $deviceName) {
    global $BINDS_FILE;
    $deviceId = trim((string)$deviceId);
    if ($bindId === '' || $deviceId === '') {
        return null;
    }
    $name = null;
    $ok = json_lock_update($BINDS_FILE, function ($binds) use ($bindId, $deviceId, $deviceName, &$name) {
        if (!isset($binds[$bindId])) {
            return ['data' => $binds, 'result' => false];
        }
        $devices = bind_devices($binds[$bindId]);
        $index = -1;
        foreach ($devices as $i => $device) {
            if ((string)$device['device_id'] === $deviceId) {
                $index = $i;
                break;
            }
        }
        if ($index < 0) {
            return ['data' => $binds, 'result' => false];
        }
        $name = limited_device_name($deviceName, (string)$devices[$index]['side']);
        $devices[$index]['device_name'] = $name;
        store_devices($binds, $bindId, $devices);
        return ['data' => $binds, 'result' => true];
    });
    return $ok ? $name : null;
}

function issue_mobile_token($bindId, $deviceName, $deviceKey = '') {
    return register_device($bindId, 'mobile', $deviceName, $deviceKey);
}

function validate_mobile_token($bindId, $token) {
    return match_device(get_bind($bindId), $token, 'mobile') !== null;
}

// ===== 桌面端凭证（deskToken）=====
// 为什么需要：原来桌面侧请求只要自报 side=desktop 就算通过（没有任何凭证），
// 于是"知道 bindId"就等于"能读写删全部消息与文件"。deskToken 与 mobileToken 同构：
// 服务端只存 sha256、重新签发即轮换、请求时用 hash_equals 比对。
// 多设备改造后它与手机共用 devices[]，靠 side='desktop' 区分（仍是单台语义）。
function issue_desk_token($bindId, $deviceName = '') {
    $result = register_device($bindId, 'desktop', $deviceName);
    return isset($result['token']) ? $result['token'] : false;
}

function validate_desk_token($bindId, $token) {
    if ($bindId === '' || $token === '') return false;
    return match_device(get_bind($bindId), $token, 'desktop') !== null;
}

function has_desk_token($bindId) {
    foreach (bind_devices(get_bind($bindId)) as $device) {
        if ((string)$device['side'] === 'desktop') {
            return true;
        }
    }
    return false;
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
 * 多设备后额外返回 `deviceId`（命中哪台设备的凭证）——调用方据此更新该设备的"最后活跃"时间，
 * 也让"移除设备"能精确到具体一台而不是"整个绑定失效"。
 *
 * 返回 ['ok' => bool, 'side' => 'mobile'|'desktop', 'deviceId' => string, 'message' => string]
 */
function resolve_identity($bindId, $input) {
    $bind = ($bindId === '') ? null : get_bind($bindId);
    if (!$bind) {
        return ['ok' => false, 'side' => '', 'deviceId' => '', 'message' => '绑定身份无效'];
    }
    $mobileToken = isset($input['mobileToken']) ? trim((string)$input['mobileToken']) : '';
    $deskToken = '';
    foreach (['deskToken', 'desk_token', 'token'] as $key) {
        if (isset($input[$key]) && trim((string)$input[$key]) !== '') {
            $deskToken = trim((string)$input[$key]);
            break;
        }
    }
    if ($mobileToken !== '') {
        $device = match_device($bind, $mobileToken, 'mobile');
        if ($device) {
            return ['ok' => true, 'side' => 'mobile', 'deviceId' => (string)$device['device_id'], 'message' => ''];
        }
    }
    if ($deskToken !== '') {
        $device = match_device($bind, $deskToken, 'desktop');
        if ($device) {
            return ['ok' => true, 'side' => 'desktop', 'deviceId' => (string)$device['device_id'], 'message' => ''];
        }
    }
    // 出示了凭证但没通过 → 一律拒绝。
    // （不能因为"这个绑定还没签发过凭证"就回落到兼容通道：那样凭证轮换/失效会被静默掩盖，
    //   线上验收就是这么发现"带错误 deskToken 仍然放行"的。）
    //
    // 文案按端区分：手机侧必须命中 SDK 里的「移动端绑定已失效」—— sdk.js 靠这个字符串
    // 清掉本地身份并置 needBind → 页面自动跳回绑定页。「移除设备」正是依赖这条路径：
    // 被移除的手机下次请求就该被引导去重新绑定，而不是卡在一句看不懂的报错上。
    if ($mobileToken !== '') {
        return ['ok' => false, 'side' => '', 'deviceId' => '', 'message' => '移动端绑定已失效，请重新绑定'];
    }
    if ($deskToken !== '') {
        return ['ok' => false, 'side' => '', 'deviceId' => '', 'message' => '凭证已失效，请重新绑定或升级客户端'];
    }
    if (has_desk_token($bindId) || require_desk_token_enabled()) {
        return [
            'ok' => false,
            'side' => '',
            'deviceId' => '',
            'message' => '请升级 ShortCut 到最新版（缺少桌面端凭证）',
        ];
    }
    // 兼容通道：只有"从未签发过 deskToken 的旧绑定"能走到这里
    $side = isset($input['side']) ? trim((string)$input['side']) : 'desktop';
    if ($side === 'mobile') {
        return ['ok' => false, 'side' => '', 'deviceId' => '', 'message' => '移动端绑定已失效，请重新绑定'];
    }
    return ['ok' => true, 'side' => 'desktop', 'deviceId' => '', 'message' => ''];
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

/** 原子更新单个上传会话，避免并发分片各自覆盖 uploaded 数组。 */
function update_file_meta($bindId, $fileId, $fn) {
    $id = safe_file_id($fileId);
    if ($id === null) return false;
    return json_lock_update(file_meta_path($bindId, $id), $fn);
}

function set_message_favorite($bindId, $messageId, $favorite) {
    $path = message_path($bindId);
    $retentionHours = sync_retention_hours($bindId);
    return json_lock_update($path, function ($messages) use ($messageId, $favorite, $retentionHours) {
        $updated = null;
        foreach ($messages as &$item) {
            if ((string)($item['id'] ?? '') !== $messageId) continue;
            $item['favorite'] = (bool)$favorite;
            if ($favorite) unset($item['expiresAt']);
            else $item['expiresAt'] = date('c', time() + $retentionHours * 3600);
            $updated = $item;
            break;
        }
        unset($item);
        return ['data' => $messages, 'result' => $updated];
    });
}

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

function find_resumable_file($bindId, $resumeKey, $side, $name, $size) {
    if (!preg_match('/^[a-zA-Z0-9_-]{16,80}$/', (string)$resumeKey)) return null;
    $root = file_dir($bindId);
    foreach ((array)@scandir($root) as $entry) {
        if (!safe_file_id($entry)) continue;
        $meta = load_file_meta($bindId, $entry);
        if (!is_array($meta) || !empty($meta['complete'])) continue;
        if (hash_equals((string)($meta['resumeKey'] ?? ''), (string)$resumeKey)
            && (string)($meta['sender'] ?? '') === $side
            && (string)($meta['name'] ?? '') === limited_filename($name)
            && (int)($meta['size'] ?? 0) === (int)$size) return $meta;
    }
    return null;
}

function create_file_meta($bindId, $name, $size, $mime, $chunkSize, $side, $resumeKey = '') {
    $safeName = limited_filename($name);
    if ($safeName === '') return false;
    $size = max(0, min((int)$size, 10 * 1024 * 1024 * 1024));
    $chunkSize = max(256 * 1024, min((int)$chunkSize, 5 * 1024 * 1024));
    $mimeText = trim((string)$mime);
    if (function_exists('mb_substr')) $mimeText = mb_substr($mimeText, 0, 120, 'UTF-8'); else $mimeText = substr($mimeText, 0, 120);
    $safeResumeKey = preg_match('/^[a-zA-Z0-9_-]{16,80}$/', (string)$resumeKey) ? (string)$resumeKey : '';
    $meta = ['id' => 'file_' . bin2hex(random_bytes(12)), 'name' => $safeName, 'size' => $size, 'mime' => $mimeText, 'chunkSize' => $chunkSize, 'chunkCount' => max(1, (int)ceil($size / $chunkSize)), 'uploaded' => [], 'sender' => $side, 'resumeKey' => $safeResumeKey, 'createdAt' => date('c'), 'updatedAt' => date('c'), 'complete' => false];
    return save_file_meta($bindId, $meta) ? $meta : false;
}

function limited_filename($value) {
    $name = trim((string)$value);
    $name = str_replace(["\\", '/', "\0"], '_', $name);
    if (function_exists('mb_substr')) $name = mb_substr($name, 0, 180, 'UTF-8'); else $name = substr($name, 0, 180);
    return $name;
}

function file_message($meta, $side, $bindId = '') {
    $createdAt = date('c');
    $type = strpos(strtolower((string)($meta['mime'] ?? '')), 'image/') === 0 ? 'image' : 'file';
    return ['id' => 'msg_' . bin2hex(random_bytes(12)), 'type' => $type, 'fileId' => $meta['id'], 'name' => $meta['name'], 'size' => $meta['size'], 'mime' => $meta['mime'], 'sender' => $side, 'favorite' => false, 'createdAt' => $createdAt, 'expiresAt' => date('c', time() + sync_retention_hours($bindId) * 3600)];
}

/**
 * 在单文件完成锁内验证全部分片并生成一次消息。重复 complete 返回原消息，不重复追加。
 */
function complete_file_upload($bindId, $fileId, $side) {
    $metaPath = file_meta_path($bindId, $fileId);
    return with_lock($metaPath . '.complete', function () use ($bindId, $fileId, $side, $metaPath) {
        $meta = json_lock_read($metaPath);
        if (!is_array($meta) || empty($meta['id'])) return ['success' => false, 'message' => '文件上传会话不存在'];
        if (!empty($meta['complete'])) {
            $messageId = (string)($meta['messageId'] ?? '');
            foreach ((array)list_messages($bindId) as $item) {
                if ((string)($item['id'] ?? '') === $messageId) {
                    return ['success' => true, 'message' => $item, 'sha256' => (string)($meta['sha256'] ?? ''), 'alreadyComplete' => true];
                }
            }
            return ['success' => false, 'message' => '文件状态异常，请重新上传'];
        }
        $uploaded = array_values(array_unique(array_map('intval', (array)($meta['uploaded'] ?? []))));
        sort($uploaded);
        $expected = range(0, max(0, (int)$meta['chunkCount'] - 1));
        if ($uploaded !== $expected) return ['success' => false, 'message' => '文件仍有分片未上传'];
        $total = 0;
        $dir = file_dir($bindId, $fileId);
        for ($i = 0; $i < (int)$meta['chunkCount']; $i++) {
            $part = $dir . '/chunk-' . $i . '.part';
            if (!is_file($part)) return ['success' => false, 'message' => '文件仍有分片未上传'];
            $bytes = @filesize($part);
            if ($bytes === false) return ['success' => false, 'message' => '分片读取失败'];
            $total += (int)$bytes;
        }
        if ($total !== (int)$meta['size']) return ['success' => false, 'message' => '文件大小校验失败'];
        $sha256 = compute_file_sha256($bindId, $meta);
        if (!$sha256) return ['success' => false, 'message' => '文件完整性校验失败'];
        $message = file_message($meta, $side, $bindId);
        $meta['sha256'] = $sha256;
        $meta['complete'] = true;
        $meta['messageId'] = $message['id'];
        $meta['updatedAt'] = date('c');
        if (!save_file_meta($bindId, $meta)) return ['success' => false, 'message' => '文件状态保存失败'];
        if (!append_message($bindId, $message)) {
            $meta['complete'] = false;
            unset($meta['messageId']);
            save_file_meta($bindId, $meta);
            return ['success' => false, 'message' => '文件消息保存失败'];
        }
        return ['success' => true, 'message' => $message, 'sha256' => $sha256, 'alreadyComplete' => false];
    });
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

// 为每次领取签发独立的一次性下载令牌（短时有效，领取后作废）。
// 旧 download_token 字段仍由消费端兼容读取，避免部署瞬间让已签发令牌失效。
function issue_share_download_token($shareId) {
    global $SHARES_FILE;
    $created = false;
    $result = json_lock_update($SHARES_FILE, function ($shares) use ($shareId, &$created) {
        foreach ($shares as &$share) {
            if ((string)($share['id'] ?? '') === $shareId && in_array((string)($share['message']['type'] ?? ''), ['file', 'image'], true)) {
                $token = 'dl_' . bin2hex(random_bytes(24));
                if (!isset($share['download_tokens']) || !is_array($share['download_tokens'])) $share['download_tokens'] = [];
                $now = time();
                $share['download_tokens'] = array_values(array_filter($share['download_tokens'], function ($entry) use ($now) {
                    return is_array($entry) && strtotime((string)($entry['expires_at'] ?? '')) > $now;
                }));
                $share['download_tokens'][] = ['token' => $token, 'expires_at' => date('c', $now + 900)];
                $created = true;
                return ['data' => $shares, 'result' => $token];
            }
        }
        return ['data' => $shares, 'result' => null];
    });
    if (!$created) return null;
    return $result;
}

// 用下载令牌定位文件共享（未领取/未过期），返回 [bindId, fileId, meta name/size/mime]
function peek_share_download_token($token) {
    global $SHARES_FILE;
    $token = trim((string)$token);
    if (!preg_match('/^dl_[a-f0-9]{48}$/', $token) || !file_exists($SHARES_FILE)) return null;
    $now = time();
    foreach ((array)json_lock_read($SHARES_FILE) as $share) {
        if (strtotime((string)($share['expires_at'] ?? '')) <= $now) continue;
        $valid = (string)($share['download_token'] ?? '') === $token
            && strtotime((string)($share['download_token_expires'] ?? '')) > $now;
        foreach ((array)($share['download_tokens'] ?? []) as $entry) {
            if (is_array($entry) && hash_equals((string)($entry['token'] ?? ''), $token)
                && strtotime((string)($entry['expires_at'] ?? '')) > $now) $valid = true;
        }
        if ($valid) return [
            'bindId' => (string)($share['bind_id'] ?? ''),
            'fileId' => (string)($share['message']['fileId'] ?? ''),
            'name' => (string)($share['message']['name'] ?? 'file'),
            'size' => (int)($share['message']['size'] ?? 0),
            'mime' => (string)($share['message']['mime'] ?? 'application/octet-stream'),
        ];
    }
    return null;
}

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
            $tokens = isset($share['download_tokens']) && is_array($share['download_tokens']) ? $share['download_tokens'] : [];
            $matchedToken = false;
            $keptTokens = [];
            foreach ($tokens as $entry) {
                if (!is_array($entry) || strtotime((string)($entry['expires_at'] ?? '')) <= $now) continue;
                if (!$matchedToken && hash_equals((string)($entry['token'] ?? ''), $token)) {
                    $matchedToken = true;
                    continue;
                }
                $keptTokens[] = $entry;
            }
            if ((string)($share['id'] ?? '') !== '' && $found === null
                && (($t === $token && strtotime((string)($share['download_token_expires'] ?? '')) > $now) || $matchedToken)
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
            $share['download_tokens'] = $keptTokens;
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

// ===== 文件快传 WebRTC 轻量信令 =====
function rtc_presence_path($bindId) {
    global $RTC_DIR;
    $safe = preg_replace('/[^a-zA-Z0-9_-]/', '_', (string)$bindId);
    return $RTC_DIR . '/' . $safe . '-presence.json';
}

function rtc_signal_path($bindId, $side) {
    global $RTC_DIR;
    $safe = preg_replace('/[^a-zA-Z0-9_-]/', '_', (string)$bindId);
    $target = $side === 'desktop' ? 'desktop' : 'mobile';
    return $RTC_DIR . '/' . $safe . '-' . $target . '.json';
}

function rtc_touch($bindId, $side) {
    $side = $side === 'desktop' ? 'desktop' : 'mobile';
    return json_lock_update(rtc_presence_path($bindId), function ($state) use ($side) {
        $state[$side] = time();
        return ['data' => $state, 'result' => true];
    });
}

function rtc_online_state($bindId) {
    $state = json_lock_read(rtc_presence_path($bindId));
    $now = time();
    return [
        'desktop' => is_array($state) && $now - (int)($state['desktop'] ?? 0) <= 12,
        'mobile' => is_array($state) && $now - (int)($state['mobile'] ?? 0) <= 12,
    ];
}

function rtc_push_signal($bindId, $from, $to, $sessionId, $type, $payload) {
    if (!preg_match('/^[a-zA-Z0-9_-]{8,80}$/', (string)$sessionId)) return false;
    if (!in_array($type, ['offer', 'answer', 'candidate', 'cancel'], true)) return false;
    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($encoded === false || strlen($encoded) > 180000) return false;
    $item = ['id' => bin2hex(random_bytes(12)), 'sessionId' => $sessionId, 'from' => $from, 'type' => $type, 'payload' => $payload, 'createdAt' => date('c')];
    return json_lock_update(rtc_signal_path($bindId, $to), function ($items) use ($item) {
        $cutoff = time() - 60;
        $items = array_values(array_filter((array)$items, function ($row) use ($cutoff) { return is_array($row) && strtotime((string)($row['createdAt'] ?? '')) >= $cutoff; }));
        $items[] = $item;
        if (count($items) > 100) $items = array_slice($items, -100);
        return ['data' => $items, 'result' => $item];
    });
}

function rtc_take_signals($bindId, $side) {
    return json_lock_update(rtc_signal_path($bindId, $side), function ($items) {
        $cutoff = time() - 60;
        $out = array_values(array_filter((array)$items, function ($row) use ($cutoff) { return is_array($row) && strtotime((string)($row['createdAt'] ?? '')) >= $cutoff; }));
        return ['data' => [], 'result' => $out];
    });
}

/** 文件快传最终策略：modules.json 默认值 + 激活后台平台策略覆盖。 */
function file_transfer_policy() {
    $policy = ['maxFileMb' => 1024, 'cloudQuotaMb' => 2048, 'shareEnabled' => true, 'maxShareHours' => 24, 'retentionHours' => 24];
    $catalog = sync_modules_catalog();
    foreach ((array)($catalog['modules'] ?? []) as $module) {
        if (($module['id'] ?? '') === 'fileTransfer' && isset($module['policy']) && is_array($module['policy'])) {
            $policy = array_merge($policy, $module['policy']);
            break;
        }
    }
    return array_merge($policy, sync_module_policy('fileTransfer'));
}

/** 服务端模块总开关。关闭后 API 与文件端点都拒绝新请求。 */
function sync_module_enabled($moduleId) {
    $catalog = sync_modules_catalog();
    foreach ((array)($catalog['modules'] ?? []) as $module) {
        if (!is_array($module) || (string)($module['id'] ?? '') !== (string)$moduleId) continue;
        if (isset($module['defaultEnabled']) && !$module['defaultEnabled']) return false;
        $policy = array_merge((array)($module['policy'] ?? []), sync_module_policy($moduleId));
        return !isset($policy['enabled']) || (bool)$policy['enabled'];
    }
    return false;
}

function bind_file_storage_bytes($bindId) {
    global $FILE_DIR;
    $safeBind = preg_replace('/[^a-zA-Z0-9_-]/', '_', $bindId);
    $root = $FILE_DIR . '/' . $safeBind;
    if (!is_dir($root)) return 0;
    $total = 0;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) if ($file->isFile() && substr($file->getFilename(), -5) === '.part') $total += $file->getSize();
    return $total;
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
            // ✅ 2026-10-18（回应安卓侧 A2）：minAppVersion 装的是**桌面端**版本号（如 2.4.5），
            // 安卓端是 0.1.0，两者不是同一个命名空间 —— 安卓端拿它做门禁会「0.1.0 < 2.4.5 恒成立」，
            // 表现为任务墙/文件共享/电脑控制全部被锁死（线上已发生）。
            // 这里补一个**安卓端专用**的版本下限字段；不下发（或空串）时安卓端不做门禁。
            // 桌面端/移动 Web 继续只看 minAppVersion，互不影响。
            'minAndroidVersion' => isset($module['minAndroidVersion']) ? (string)$module['minAndroidVersion'] : '',
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
            $metaPath = $fileDir . '/meta.json';
            $meta = file_exists($metaPath) ? json_lock_read($metaPath) : null;
            $updatedAt = is_array($meta) ? strtotime((string)($meta['updatedAt'] ?? $meta['createdAt'] ?? '')) : 0;
            // 上传尚未 complete 时没有消息引用。必须给活跃上传会话宽限期，否则恰逢 15 分钟清理就会被删。
            $uploadGrace = 24 * 3600;
            $remove = !isset($referenced[$fileId]) && (!$meta || !empty($meta['complete']) || $updatedAt <= 0 || ($now - $updatedAt) > $uploadGrace);
            if (!$remove) {
                if (is_array($meta) && empty($meta['complete']) && !isset($referenced[$fileId])) continue;
                // 仍被引用：按保留时长清理（未被收藏）
                if (file_exists($metaPath)) {
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
        // scandir 返回的就是 <bindId>.json；旧代码又拼一次 .json，导致清理永远跳过真实文件。
        $path = $MESSAGE_DIR . '/' . $bindId;
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
