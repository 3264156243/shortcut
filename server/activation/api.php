<?php

error_reporting(0);
ini_set('display_errors', '0');

session_start();
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

function require_admin() {
    if (empty($_SESSION['admin'])) {
        respond(['success' => false, 'message' => '未登录']);
    }
}

switch ($action) {
    case 'ping':
        respond(['success' => true, 'service' => 'shortcut-activation', 'time' => date('c')]);
        break;

    case 'login':
        global $ADMIN_PASSWORD;
        if (isset($input['adminPassword']) && $input['adminPassword'] === $ADMIN_PASSWORD) {
            $_SESSION['admin'] = true;
            respond(['success' => true, 'message' => '登录成功']);
        }
        respond(['success' => false, 'message' => '管理员密码错误']);
        break;

    case 'logout':
        $_SESSION['admin'] = false;
        session_destroy();
        respond(['success' => true, 'message' => '已退出']);
        break;

    case 'generate':
        require_admin();
        $days = isset($input['days']) ? max(1, min(3650, intval($input['days']))) : 365;
        $codes = load_codes();
        $code = generate_code();
        $now = time();
        $record = [
            'code' => $code,
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
        if (!save_codes($codes)) {
            respond(['success' => false, 'active' => false, 'message' => '激活记录保存失败']);
        }
        respond([
            'success' => true,
            'active' => true,
            'expiresAt' => $found['expires_at'],
            'machineCode' => $machine,
            'message' => '激活成功',
        ]);
        break;

    case 'list':
        require_admin();
        $codes = load_codes();
        usort($codes, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        respond(['success' => true, 'codes' => $codes]);
        break;

    case 'disable':
        require_admin();
        $code = isset($input['code']) ? strtoupper(trim($input['code'])) : '';
        $codes = load_codes();
        foreach ($codes as $index => $record) {
            if (strtoupper(trim($record['code'])) === $code) {
                $codes[$index]['status'] = 'disabled';
                save_codes($codes);
                respond(['success' => true, 'message' => '已禁用']);
            }
        }
        respond(['success' => false, 'message' => '激活码不存在']);
        break;

    case 'enable':
        require_admin();
        $code = isset($input['code']) ? strtoupper(trim($input['code'])) : '';
        $codes = load_codes();
        foreach ($codes as $index => $record) {
            if (strtoupper(trim($record['code'])) === $code) {
                $codes[$index]['status'] = 'active';
                save_codes($codes);
                respond(['success' => true, 'message' => '已启用']);
            }
        }
        respond(['success' => false, 'message' => '激活码不存在']);
        break;

    case 'unbind':
        require_admin();
        $code = isset($input['code']) ? strtoupper(trim($input['code'])) : '';
        $codes = load_codes();
        foreach ($codes as $index => $record) {
            if (strtoupper(trim($record['code'])) === $code) {
                $codes[$index]['machine'] = null;
                save_codes($codes);
                respond(['success' => true, 'message' => '已解除绑定']);
            }
        }
        respond(['success' => false, 'message' => '激活码不存在']);
        break;

    case 'delete':
        require_admin();
        $code = isset($input['code']) ? strtoupper(trim($input['code'])) : '';
        $codes = load_codes();
        $kept = array_values(array_filter($codes, function ($record) use ($code) {
            return strtoupper(trim($record['code'])) !== $code;
        }));
        if (count($kept) === count($codes)) {
            respond(['success' => false, 'message' => '激活码不存在']);
        }
        save_codes($kept);
        respond(['success' => true, 'message' => '已删除']);
        break;

    default:
        respond(['success' => false, 'message' => '未知操作']);
}
