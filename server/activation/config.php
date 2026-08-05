<?php

$ADMIN_PASSWORD = 'ShortCutAdmin2026';
$DATA_DIR = __DIR__ . '/data';
$DATA_FILE = $DATA_DIR . '/codes.json';

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
    $tmp = $DATA_FILE . '.tmp';
    file_put_contents($tmp, json_encode($codes, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    rename($tmp, $DATA_FILE);
}

function generate_code() {
    $hex = strtoupper(bin2hex(random_bytes(6)));
    $raw = implode('-', str_split($hex, 4));
    return 'SHC-' . $raw;
}
