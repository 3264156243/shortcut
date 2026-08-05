<?php

header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/config.php';

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = [];
}
$action = isset($input['action']) ? $input['action'] : (isset($_GET['action']) ? $_GET['action'] : '');

function respond($data) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function require_admin($input) {
    global $ADMIN_PASSWORD;
    if (!isset($input['adminPassword']) || $input['adminPassword'] !== $ADMIN_PASSWORD) {
        respond(['success' => false, 'message' => '管理员密码错误']);
    }
}

switch ($action) {
    case 'ping':
        respond(['success' => true, 'service' => 'shortcut-activation', 'time' => date('c')]);
        break;

    case 'generate':
        require_admin($input);
        $plan = isset($input['plan']) && trim($input['plan']) !== '' ? trim($input['plan']) : '基础版';
        $days = isset($input['days']) ? max(1, min(3650, intval($input['days']))) : 365;
        $codes = load_codes();
        $code = generate_code();
        $now = time();
        $record = [
            'code' => $code,
            'plan' => $plan,
            'days' => $days,
            'status' => 'active',
            'machine' => null,
            'created_at' => date('c', $now),
            'expires_at' => date('c', $now + $days * 86400),
            'last_check_at' => null,
        ];
        $codes[] = $record;
        save_codes($codes);
        respond(['success' => true, 'code' => $code, 'record' => $record]);
        break;

    case 'check':
        $code = isset($input['code']) ? strtoupper(trim($input['code'])) : '';
        $machine = isset($input['machineCode']) ? trim($input['machineCode']) : '';
        if ($code === '' || $machine === '') {
            respond(['success' => false, 'active' => false, 'message' => '激活码或机器码为空']);
        }
        $codes = load_codes();
        $found = null;
        $foundIndex = -1;
        foreach ($codes as $index => $record) {
            if (strtoupper(trim($record['code'])) === $code) {
                $found = $record;
                $foundIndex = $index;
                break;
            }
        }
        if (!$found) {
            respond(['success' => false, 'active' => false, 'message' => '激活码不存在']);
        }
        if ($found['status'] !== 'active') {
            respond(['success' => false, 'active' => false, 'message' => '激活码已被禁用']);
        }
        if (isset($found['expires_at']) && strtotime($found['expires_at']) < time()) {
            respond(['success' => false, 'active' => false, 'message' => '激活码已过期']);
        }
        if (empty($found['machine'])) {
            $found['machine'] = $machine;
        } elseif ($found['machine'] !== $machine) {
            respond(['success' => false, 'active' => false, 'message' => '激活码已绑定其他设备']);
        }
        $found['last_check_at'] = date('c');
        $codes[$foundIndex] = $found;
        save_codes($codes);
        respond([
            'success' => true,
            'active' => true,
            'plan' => $found['plan'],
            'expiresAt' => $found['expires_at'],
            'machineCode' => $machine,
            'message' => '激活成功',
        ]);
        break;

    case 'list':
        require_admin($input);
        $codes = load_codes();
        usort($codes, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        respond(['success' => true, 'codes' => $codes]);
        break;

    default:
        respond(['success' => false, 'message' => '未知操作']);
}
