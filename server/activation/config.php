<?php

$ADMIN_PASSWORD = '791214';
$DATA_DIR = __DIR__ . '/data';
$DATA_FILE = $DATA_DIR . '/codes.json';
$CONFIG_FILE = $DATA_DIR . '/activation_config.json';

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
    if (!rename($tmp, $DATA_FILE)) {
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

function load_activation_config() {
    global $CONFIG_FILE, $DEFAULT_MODULE_LIST;
    $defaults = [
        'activationPolicy' => 'none',
        'moduleList' => $DEFAULT_MODULE_LIST,
    ];
    if (!file_exists($CONFIG_FILE)) {
        return $defaults;
    }
    $raw = file_get_contents($CONFIG_FILE);
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return $defaults;
    }
    $moduleList = isset($data['moduleList']) && is_array($data['moduleList']) ? $data['moduleList'] : $DEFAULT_MODULE_LIST;
    $moduleList = array_merge($DEFAULT_MODULE_LIST, array_intersect_key($moduleList, $DEFAULT_MODULE_LIST));
    return [
        'activationPolicy' => in_array($data['activationPolicy'] ?? 'none', ['none', 'premium_only', 'all'], true)
            ? $data['activationPolicy']
            : 'none',
        'moduleList' => $moduleList,
    ];
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
    if (!rename($tmp, $CONFIG_FILE)) {
        @unlink($tmp);
        return false;
    }
    return true;
}
