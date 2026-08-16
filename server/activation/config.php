<?php

$ADMIN_PASSWORD = '791214';
$DATA_DIR = __DIR__ . '/data';
$DATA_FILE = $DATA_DIR . '/codes.json';
$CONFIG_FILE = $DATA_DIR . '/activation_config.json';

$MODULE_META = [
    'shortcuts' => '快捷方式',
    'tasks' => '任务墙',
    'cockpit' => '驾驶舱',
    'translate' => '翻译',
    'usage' => '应用使用记录',
    'island' => 'SC球',
    'codexProvider' => 'Codex供应商',
];

$DEFAULT_MODULE_LIST = [
    'shortcuts' => '免费',
    'tasks' => '免费',
    'cockpit' => '免费',
    'translate' => '免费',
    'usage' => '免费',
    'island' => '会员',
    'codexProvider' => '免费',
];

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
    return $permissions;
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
        ],
        [
            'id' => 'default',
            'name' => '默认用户',
            'system' => false,
            'enabled' => true,
            'permissions' => $all,
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
        ];
    }

    if (!isset($seen['guest'])) {
        array_unshift($groups, [
            'id' => 'guest',
            'name' => '未激活用户',
            'system' => true,
            'enabled' => true,
            'permissions' => full_permissions(false),
        ]);
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
        'groups' => $groups,
        'activationPolicy' => $requireActivation ? ($guestEnabled ? 'premium_only' : 'all') : 'none',
        'moduleList' => $moduleList,
    ];
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
