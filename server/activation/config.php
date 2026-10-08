<?php

$ADMIN_PASSWORD = '791214';
$DATA_DIR = getenv('SHORTCUT_ACTIVATION_DATA') ?: dirname(__DIR__, 2) . '/ShortCut-activation-data';
$DATA_FILE = $DATA_DIR . '/codes.json';
$CONFIG_FILE = $DATA_DIR . '/activation_config.json';
$LOG_FILE = $DATA_DIR . '/checks.json';
$LOG_LIMIT = 20000;
$DEVICES_FILE = $DATA_DIR . '/devices.json';

$MODULE_META = [
    'shortcuts' => '快捷方式',
    'tasks' => '任务墙',
    'cockpit' => '驾驶舱',
    'translate' => '翻译',
    'fileTransfer' => '文件快传',
    'usage' => '应用使用记录',
    'island' => 'SC球',
    'codexProvider' => 'Codex供应商',
    'voiceInput' => '语音输入',
    'control' => '手机控制',
];

$DEFAULT_MODULE_LIST = [
    'shortcuts' => '免费',
    'tasks' => '免费',
    'cockpit' => '免费',
    'translate' => '免费',
    'fileTransfer' => '免费',
    'usage' => '免费',
    'island' => '会员',
    'codexProvider' => '免费',
    'voiceInput' => '免费',
    'control' => '免费',
];

// 子功能级权限（挂在板块之下，可单独授权）
$FEATURE_META = [
    'island.music' => ['module' => 'island', 'label' => 'SC球-音乐'],
    'island.tasks' => ['module' => 'island', 'label' => 'SC球-任务提醒'],
    'island.cockpit' => ['module' => 'island', 'label' => 'SC球-驾驶舱数据'],
    'island.balance' => ['module' => 'island', 'label' => 'SC球-余额(DeepSeek/OpenCode)'],
    'translate.bubble' => ['module' => 'translate', 'label' => '翻译-划词气泡 Alt+E'],
];

// 客户端激活板块提示“如何获取激活码”的文字，可在管理后台修改
$CONTACT_LINE_DEFAULT = '激活码请联系管理员获取';

function load_codes() {
    global $DATA_FILE;
    if (!file_exists($DATA_FILE)) {
        return [];
    }
    $raw = file_get_contents($DATA_FILE);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function save_codes($codes) {
    global $DATA_DIR, $DATA_FILE;
    if (!is_dir($DATA_DIR)) {
        mkdir($DATA_DIR, 0755, true);
    }
    $tmp = $DATA_FILE . '.' . getmypid() . '.' . uniqid() . '.tmp';
    $payload = json_encode($codes, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if (file_put_contents($tmp, $payload, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    if (!@rename($tmp, $DATA_FILE)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function load_logs() {
    global $LOG_FILE;
    if (!file_exists($LOG_FILE)) {
        return [];
    }
    $raw = file_get_contents($LOG_FILE);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function save_logs($logs) {
    global $DATA_DIR, $LOG_FILE;
    if (!is_dir($DATA_DIR)) {
        mkdir($DATA_DIR, 0755, true);
    }
    $tmp = $LOG_FILE . '.' . getmypid() . '.' . uniqid() . '.tmp';
    $payload = json_encode($logs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if (file_put_contents($tmp, $payload, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    if (!@rename($tmp, $LOG_FILE)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function append_check_log($entry) {
    global $LOG_LIMIT;
    $logs = load_logs();
    array_unshift($logs, $entry);
    if (count($logs) > $LOG_LIMIT) {
        $logs = array_slice($logs, 0, $LOG_LIMIT);
    }
    return save_logs($logs);
}

function load_devices() {
    global $DEVICES_FILE;
    if (!file_exists($DEVICES_FILE)) {
        return [];
    }
    $raw = file_get_contents($DEVICES_FILE);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function save_devices($devices) {
    global $DATA_DIR, $DEVICES_FILE;
    if (!is_dir($DATA_DIR)) {
        mkdir($DATA_DIR, 0755, true);
    }
    $tmp = $DEVICES_FILE . '.' . getmypid() . '.' . uniqid() . '.tmp';
    $payload = json_encode($devices, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if (file_put_contents($tmp, $payload, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    if (!@rename($tmp, $DEVICES_FILE)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function normalize_client_info($clientInfo) {
    if (!is_array($clientInfo)) {
        $clientInfo = [];
    }
    $lanIps = isset($clientInfo['lanIps']) && is_array($clientInfo['lanIps'])
        ? array_values(array_filter(array_map('strval', $clientInfo['lanIps'])))
        : [];
    $macs = isset($clientInfo['macs']) && is_array($clientInfo['macs'])
        ? array_values(array_filter(array_map('strval', $clientInfo['macs'])))
        : [];
    return [
        'hostname' => trim(strval($clientInfo['hostname'] ?? '')),
        'appVersion' => trim(strval($clientInfo['appVersion'] ?? '')),
        'platform' => trim(strval($clientInfo['platform'] ?? '')),
        'machineSource' => trim(strval($clientInfo['machineSource'] ?? 'hardware')),
        'lanIps' => $lanIps,
        'macs' => $macs,
    ];
}

function upsert_device($machine, $clientInfo, $code = '', $remoteIp = '') {
    $machine = trim(strval($machine));
    if ($machine === '') {
        return false;
    }
    $info = normalize_client_info($clientInfo);
    $devices = load_devices();
    $now = date('c');
    $record = isset($devices[$machine]) && is_array($devices[$machine])
        ? $devices[$machine]
        : ['machine' => $machine];
    $record['machine'] = $machine;
    $record['machine_source'] = $info['machineSource'] !== '' ? $info['machineSource'] : ($record['machine_source'] ?? 'hardware');
    if ($info['hostname'] !== '') {
        $record['device_name'] = $info['hostname'];
    }
    if ($info['appVersion'] !== '') {
        $record['client_version'] = $info['appVersion'];
    }
    if ($info['platform'] !== '') {
        $record['platform'] = $info['platform'];
    }
    if ($remoteIp !== '') {
        $record['last_ip'] = $remoteIp;
    }
    if (count($info['lanIps']) > 0) {
        $record['lan_ips'] = $info['lanIps'];
    }
    if (count($info['macs']) > 0) {
        $record['macs'] = $info['macs'];
    }
    if ($code !== '') {
        $record['code'] = $code;
    }
    if (empty($record['first_seen_at'])) {
        $record['first_seen_at'] = $now;
    }
    $record['last_check_at'] = $now;
    $record['check_count'] = 1 + intval($record['check_count'] ?? 0);
    $devices[$machine] = $record;
    return save_devices($devices);
}

function generate_code() {
    $hex = strtoupper(bin2hex(random_bytes(6)));
    $raw = implode('-', str_split($hex, 4));
    return 'SHC-' . $raw;
}

function module_ids() {
    global $MODULE_META;
    return array_keys($MODULE_META);
}

function full_permissions($allowed = true) {
    $permissions = [];
    foreach (module_ids() as $id) {
        $permissions[$id] = $allowed;
    }
    foreach ($GLOBALS['FEATURE_META'] as $fid => $fmeta) {
        $permissions[$fid] = $allowed;
    }
    return $permissions;
}

function normalize_transfer_policy($raw = null) {
    $data = is_array($raw) ? $raw : [];
    return [
        'maxFileMb' => max(1, min(10240, intval($data['maxFileMb'] ?? 500))),
        'cloudQuotaMb' => max(1, min(102400, intval($data['cloudQuotaMb'] ?? 2048))),
        'shareEnabled' => array_key_exists('shareEnabled', $data) ? !empty($data['shareEnabled']) : true,
        'maxShareHours' => max(1, min(24, intval($data['maxShareHours'] ?? 24))),
        'retentionHours' => max(1, min(720, intval($data['retentionHours'] ?? 24))),
    ];
}

function default_groups() {
    $all = full_permissions(true);
    return [
        [
            'id' => 'guest',
            'name' => '未激活用户',
            'system' => true,
            'enabled' => true,
            'permissions' => $all,
            'fileTransferPolicy' => normalize_transfer_policy(),
        ],
        [
            'id' => 'trial',
            'name' => '免费试用',
            'system' => true,
            'enabled' => true,
            'permissions' => $all,
            'fileTransferPolicy' => normalize_transfer_policy(),
        ],
        [
            'id' => 'default',
            'name' => '默认用户',
            'system' => false,
            'enabled' => true,
            'permissions' => $all,
            'fileTransferPolicy' => normalize_transfer_policy(),
        ],
    ];
}

function migrate_legacy_groups($moduleList, $policy) {
    $guestEnabled = $policy === 'premium_only';
    $requireActivation = $policy !== 'none';
    $ids = module_ids();
    $permsFor = function ($maxLevel) use ($moduleList, $ids) {
        $permissions = [];
        foreach ($ids as $id) {
            $label = isset($moduleList[$id]) ? $moduleList[$id] : '免费';
            if ($maxLevel === 'free') {
                $permissions[$id] = $label === '免费';
            } elseif ($maxLevel === 'member') {
                $permissions[$id] = $label === '免费' || $label === '会员';
            } else {
                $permissions[$id] = true;
            }
        }
        return $permissions;
    };
    $groups = [
        [
            'id' => 'guest',
            'name' => '未激活用户',
            'system' => true,
            'enabled' => true,
            'permissions' => $permsFor('free'),
        ],
        [
            'id' => 'free',
            'name' => '免费用户',
            'system' => false,
            'enabled' => true,
            'permissions' => $permsFor('free'),
        ],
        [
            'id' => 'member',
            'name' => '会员',
            'system' => false,
            'enabled' => true,
            'permissions' => $permsFor('member'),
        ],
        [
            'id' => 'super',
            'name' => '超级会员',
            'system' => false,
            'enabled' => true,
            'permissions' => $permsFor('super'),
        ],
    ];
    return [$requireActivation, $guestEnabled, $groups];
}

function normalize_activation_config($data = null) {
    global $MODULE_META;
    if (!is_array($data)) {
        $config = [
            'requireActivation' => false,
            'guestEnabled' => false,
            'groups' => default_groups(),
        ];
    } else {
        $config = $data;
        $legacyPolicy = isset($config['activationPolicy']) && in_array($config['activationPolicy'], ['none', 'premium_only', 'all'], true)
            ? $config['activationPolicy']
            : 'none';
        $legacyModuleList = isset($config['moduleList']) && is_array($config['moduleList'])
            ? $config['moduleList']
            : $GLOBALS['DEFAULT_MODULE_LIST'];
        if (!isset($config['groups']) || !is_array($config['groups']) || count($config['groups']) === 0) {
            list($requireActivation, $guestEnabled, $groups) = migrate_legacy_groups($legacyModuleList, $legacyPolicy);
            $config['requireActivation'] = $requireActivation;
            $config['guestEnabled'] = $guestEnabled;
            $config['groups'] = $groups;
        }
        if (!isset($config['requireActivation'])) {
            $config['requireActivation'] = $legacyPolicy !== 'none';
        }
        if (!isset($config['guestEnabled'])) {
            $config['guestEnabled'] = $legacyPolicy === 'premium_only';
        }
        if (!isset($config['groups']) || !is_array($config['groups'])) {
            $config['groups'] = default_groups();
        }
    }

    // 解析持久化的板块元数据（客户端校验/上报时自动同步），并更新全局
    $savedMeta = isset($config['moduleMeta']) && is_array($config['moduleMeta']) ? $config['moduleMeta'] : [];
    $effectiveMeta = [];
    foreach ($MODULE_META as $mid => $label) {
        $effectiveMeta[$mid] = (isset($savedMeta[$mid]) && trim(strval($savedMeta[$mid])) !== '') ? strval($savedMeta[$mid]) : $label;
    }
    if (count($effectiveMeta) === 0) {
        $effectiveMeta = $MODULE_META;
    }
    $GLOBALS['MODULE_META'] = $effectiveMeta;
    $MODULE_META = $effectiveMeta;

    $requireActivation = !empty($config['requireActivation']);
    $guestEnabled = !empty($config['guestEnabled']);
    $groups = [];
    $seen = [];
    foreach ($config['groups'] as $group) {
        if (!is_array($group)) {
            continue;
        }
        $gid = isset($group['id']) && $group['id'] !== '' ? (string)$group['id'] : 'g' . (count($groups) + 1);
        if (isset($seen[$gid])) {
            continue;
        }
        $seen[$gid] = true;
        $rawPerms = isset($group['permissions']) && is_array($group['permissions']) ? $group['permissions'] : [];
        $permissions = [];
        foreach ($MODULE_META as $mid => $label) {
            $permissions[$mid] = array_key_exists($mid, $rawPerms) ? (bool)$rawPerms[$mid] : true;
        }
        foreach ($GLOBALS['FEATURE_META'] as $fid => $fmeta) {
            $permissions[$fid] = array_key_exists($fid, $rawPerms) ? (bool)$rawPerms[$fid] : true;
        }
        $name = trim((string)($group['name'] ?? ''));
        if ($name === '') {
            $name = $gid === 'guest' ? '未激活用户' : '用户组' . count($groups);
        }
        $groups[] = [
            'id' => $gid,
            'name' => $name,
            'system' => !empty($group['system']),
            'enabled' => isset($group['enabled']) ? (bool)$group['enabled'] : true,
            'permissions' => $permissions,
            'fileTransferPolicy' => normalize_transfer_policy($group['fileTransferPolicy'] ?? null),
        ];
    }

    if (!isset($seen['guest'])) {
        array_unshift($groups, [
            'id' => 'guest',
            'name' => '未激活用户',
            'system' => true,
            'enabled' => true,
            'permissions' => full_permissions(false),
            'fileTransferPolicy' => normalize_transfer_policy(),
        ]);
    }

    $trialEnabled = array_key_exists('trialEnabled', $config) ? !empty($config['trialEnabled']) : true;
    $trialMinutes = isset($config['trialMinutes']) ? max(1, min(1440, intval($config['trialMinutes']))) : 10;
    if (!isset($seen['trial'])) {
        $groups[] = [
            'id' => 'trial',
            'name' => '免费试用',
            'system' => true,
            'enabled' => $trialEnabled,
            'permissions' => full_permissions(true),
            'fileTransferPolicy' => normalize_transfer_policy(),
        ];
    } else {
        // 试用分组启用状态跟随 trialEnabled 开关
        foreach ($groups as &$g) {
            if ($g['id'] === 'trial') {
                $g['enabled'] = $trialEnabled && !empty($g['enabled']);
            }
        }
        unset($g);
    }

    $moduleList = [];
    if (isset($config['moduleList']) && is_array($config['moduleList'])) {
        foreach ($MODULE_META as $mid => $label) {
            $moduleList[$mid] = isset($config['moduleList'][$mid]) ? $config['moduleList'][$mid] : '免费';
        }
    } else {
        $reference = null;
        foreach ($groups as $group) {
            if (empty($group['system']) && !empty($group['enabled'])) {
                $reference = $group;
                break;
            }
        }
        foreach ($MODULE_META as $mid => $label) {
            $moduleList[$mid] = $reference && !empty($reference['permissions'][$mid]) ? '免费' : '会员';
        }
    }

    return [
        'requireActivation' => $requireActivation,
        'guestEnabled' => $guestEnabled,
        'trialEnabled' => $trialEnabled,
        'trialMinutes' => $trialMinutes,
        'groups' => $groups,
        'activationPolicy' => $requireActivation ? ($guestEnabled ? 'premium_only' : 'all') : 'none',
        'moduleList' => $moduleList,
        'moduleMeta' => $effectiveMeta,
        'featureMeta' => $GLOBALS['FEATURE_META'],
        'contactLine' => (isset($config['contactLine']) && trim(strval($config['contactLine'])) !== '') ? strval($config['contactLine']) : $GLOBALS['CONTACT_LINE_DEFAULT'],
    ];
}

/**
 * 客户端上报的板块清单（id=>label）与后台元数据合并：
 * 新增板块自动加入权限项，板块改名自动同步。
 * 返回 true 表示有变化并已保存。
 */
function sync_module_meta($moduleList) {
    if (!is_array($moduleList) || count($moduleList) === 0) {
        return false;
    }
    $config = load_activation_config();
    $meta = $GLOBALS['MODULE_META'];
    $changed = false;
    foreach ($moduleList as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $mid = trim(strval($entry['id'] ?? ''));
        if ($mid === '' || $mid === 'usageManage') {
            continue;
        }
        $label = trim(strval($entry['label'] ?? ''));
        if ($label === '') {
            continue;
        }
        if (!isset($meta[$mid])) {
            $meta[$mid] = $label;
            $changed = true;
        } elseif ($meta[$mid] !== $label) {
            $meta[$mid] = $label;
            $changed = true;
        }
    }
    if (!$changed) {
        return false;
    }
    $GLOBALS['MODULE_META'] = $meta;
    $config['moduleMeta'] = $meta;
    foreach ($config['groups'] as &$group) {
        if (!is_array($group) || !isset($group['permissions']) || !is_array($group['permissions'])) {
            continue;
        }
        foreach ($meta as $mid => $label) {
            if (!array_key_exists($mid, $group['permissions'])) {
                $group['permissions'][$mid] = true;
            }
        }
    }
    unset($group);
    $normalized = normalize_activation_config($config);
    return save_activation_config($normalized);
}

function load_activation_config() {
    global $CONFIG_FILE;
    if (!file_exists($CONFIG_FILE)) {
        return normalize_activation_config(null);
    }
    $raw = file_get_contents($CONFIG_FILE);
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return normalize_activation_config(null);
    }
    return normalize_activation_config($data);
}

function save_activation_config($config) {
    global $DATA_DIR, $CONFIG_FILE;
    if (!is_dir($DATA_DIR)) {
        mkdir($DATA_DIR, 0755, true);
    }
    $tmp = $CONFIG_FILE . '.' . getmypid() . '.' . uniqid() . '.tmp';
    $payload = json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if (file_put_contents($tmp, $payload, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    if (!@rename($tmp, $CONFIG_FILE)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function find_group($config, $token = null) {
    $groups = isset($config['groups']) && is_array($config['groups']) ? $config['groups'] : [];
    if ($token === null || $token === '') {
        foreach ($groups as $group) {
            if (empty($group['system']) && !empty($group['enabled'])) {
                return $group;
            }
        }
        foreach ($groups as $group) {
            if (!empty($group['enabled'])) {
                return $group;
            }
        }
        return !empty($groups) ? $groups[0] : null;
    }
    $needle = strtolower(trim((string)$token));
    foreach ($groups as $group) {
        if (strtolower((string)($group['id'] ?? '')) === $needle) {
            return $group;
        }
        if (strtolower((string)($group['name'] ?? '')) === $needle) {
            return $group;
        }
    }
    $legacyMap = ['free' => '免费', 'member' => '会员', 'super' => '超级会员'];
    if (isset($legacyMap[$needle])) {
        $want = $legacyMap[$needle];
        foreach ($groups as $group) {
            if (strpos((string)($group['name'] ?? ''), $want) !== false) {
                return $group;
            }
        }
    }
    return find_group($config, null);
}

function module_rules($config, $token = null) {
    global $MODULE_META;
    $group = find_group($config, $token);
    if (!$group) {
        $rules = [];
        foreach ($MODULE_META as $id => $label) {
            $rules[] = ['id' => $id, 'level' => 'free', 'allowed' => false];
        }
        return $rules;
    }
    $rules = [];
    foreach ($MODULE_META as $id => $label) {
        $rules[] = [
            'id' => $id,
            'level' => $group['name'],
            'allowed' => !empty($group['permissions'][$id]),
        ];
    }
    return $rules;
}

function feature_rules($config, $token = null) {
    $group = find_group($config, $token);
    $rules = [];
    foreach ($GLOBALS['FEATURE_META'] as $fid => $fmeta) {
        $rules[] = [
            'id' => $fid,
            'module' => $fmeta['module'],
            'label' => $fmeta['label'],
            'allowed' => $group ? !empty($group['permissions'][$fid]) : false,
        ];
    }
    return $rules;
}

function public_feature_rules($config) {
    $rules = [];
    foreach ($GLOBALS['FEATURE_META'] as $fid => $fmeta) {
        $rules[] = ['id' => $fid, 'module' => $fmeta['module'], 'label' => $fmeta['label'], 'allowed' => true];
    }
    if (!$config['requireActivation']) {
        return $rules;
    }
    if ($config['guestEnabled']) {
        return feature_rules($config, 'guest');
    }
    foreach ($rules as $index => $rule) {
        $rules[$index]['allowed'] = false;
    }
    return $rules;
}

function public_module_rules($config) {
    $rules = [];
    foreach (module_ids() as $id) {
        $rules[] = ['id' => $id, 'level' => 'free', 'allowed' => true];
    }
    if (!$config['requireActivation']) {
        return $rules;
    }
    if ($config['guestEnabled']) {
        return module_rules($config, 'guest');
    }
    foreach ($rules as $index => $rule) {
        $rules[$index]['allowed'] = false;
    }
    return $rules;
}
