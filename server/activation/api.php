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
$clientInfo = isset($input['clientInfo']) && is_array($input['clientInfo']) ? $input['clientInfo'] : [];
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

function error_message($message) {
    respond(['success' => false, 'message' => $message]);
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

    case 'getPolicy':
        require_admin();
        $config = load_activation_config();
        respond(array_merge(['success' => true], $config, ['moduleMeta' => $GLOBALS['MODULE_META']]));
        break;

    case 'savePolicy':
        require_admin();
        $config = load_activation_config();
        if (array_key_exists('requireActivation', $input)) {
            $config['requireActivation'] = !empty($input['requireActivation']);
        }
        if (array_key_exists('guestEnabled', $input)) {
            $config['guestEnabled'] = !empty($input['guestEnabled']);
        }
        if (isset($input['groups']) && is_array($input['groups'])) {
            $groups = [];
            foreach ($input['groups'] as $group) {
                if (!is_array($group)) {
                    continue;
                }
                $gid = isset($group['id']) && $group['id'] !== '' ? strval($group['id']) : 'g' . (count($groups) + 1);
                $rawPerms = isset($group['permissions']) && is_array($group['permissions']) ? $group['permissions'] : [];
                $permissions = [];
                foreach ($GLOBALS['MODULE_META'] as $mid => $label) {
                    $permissions[$mid] = array_key_exists($mid, $rawPerms) ? !empty($rawPerms[$mid]) : true;
                }
                $groups[] = [
                    'id' => $gid,
                    'name' => trim(strval($group['name'] ?? '')) !== '' ? trim(strval($group['name'])) : ('用户组' . (count($groups) + 1)),
                    'system' => !empty($group['system']),
                    'enabled' => array_key_exists('enabled', $group) ? !empty($group['enabled']) : true,
                    'permissions' => $permissions,
                ];
            }
            $config['groups'] = $groups;
        }
        $normalized = normalize_activation_config($config);
        if (save_activation_config($normalized)) {
            respond(array_merge(['success' => true, 'message' => '授权策略已保存'], $normalized));
        }
        error_message('授权策略保存失败');
        break;

    case 'generate':
        require_admin();
        $days = isset($input['days']) ? max(1, min(3650, intval($input['days']))) : 365;
        $config = load_activation_config();
        $groupId = isset($input['groupId']) ? trim(strval($input['groupId'])) : '';
        $tier = isset($input['tier']) ? trim(strval($input['tier'])) : '';
        $group = find_group($config, $groupId !== '' ? $groupId : ($tier !== '' ? $tier : null));
        if (!$group) {
            error_message('用户分组不存在');
        }
        if (!empty($group['system'])) {
            error_message('不能给未激活用户分组生成激活码');
        }
        if (empty($group['enabled'])) {
            error_message('所选分组已停用');
        }
        $codes = load_codes();
        $code = generate_code();
        $now = time();
        $record = [
            'code' => $code,
            'days' => $days,
            'group_id' => $group['id'],
            'group_name' => $group['name'],
            'tier' => $group['name'],
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
        $code = isset($input['code']) ? strtoupper(trim(strval($input['code']))) : '';
        $machine = isset($input['machineCode']) ? trim(strval($input['machineCode'])) : '';
        $config = load_activation_config();
        if ($code === '' || $machine === '') {
            respond([
                'success' => false,
                'active' => false,
                'message' => $code === '' ? '请先填写激活码' : '机器码为空',
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => public_module_rules($config),
            ]);
        }
        $codes = load_codes();
        $found = null;
        $foundIndex = -1;
        foreach ($codes as $index => $record) {
            if (strtoupper(trim(strval($record['code']))) === $code) {
                $found = $record;
                $foundIndex = $index;
                break;
            }
        }
        if (!$found) {
            respond([
                'success' => false,
                'active' => false,
                'message' => '激活码不存在',
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => public_module_rules($config),
            ]);
        }
        if ($found['status'] !== 'active') {
            respond(['success' => false, 'active' => false, 'message' => '激活码已被禁用']);
        }
        if (isset($found['expires_at']) && strtotime($found['expires_at']) < time()) {
            respond(['success' => false, 'active' => false, 'message' => '激活码已过期']);
        }
        $group = find_group($config, isset($found['group_id']) && $found['group_id'] !== '' ? $found['group_id'] : (isset($found['tier']) ? $found['tier'] : null));
        if ($group && empty($group['enabled'])) {
            respond(['success' => false, 'active' => false, 'message' => '激活码所属分组已停用']);
        }
        if (!empty($found['machine']) && $found['machine'] !== $machine) {
            respond([
                'success' => false,
                'active' => false,
                'message' => '激活码已绑定其他设备',
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => module_rules($config, $group ? $group['id'] : null),
            ]);
        }
        $now = date('c');
        $remoteIp = isset($_SERVER['REMOTE_ADDR']) ? strval($_SERVER['REMOTE_ADDR']) : '';
        $deviceName = trim(strval($clientInfo['hostname'] ?? ''));
        $clientVersion = trim(strval($clientInfo['appVersion'] ?? ''));
        $platform = trim(strval($clientInfo['platform'] ?? ''));
        $machineSource = trim(strval($clientInfo['machineSource'] ?? 'hardware'));
        $lanIps = isset($clientInfo['lanIps']) && is_array($clientInfo['lanIps'])
            ? array_values(array_filter(array_map('strval', $clientInfo['lanIps'])))
            : [];
        $macs = isset($clientInfo['macs']) && is_array($clientInfo['macs'])
            ? array_values(array_filter(array_map('strval', $clientInfo['macs'])))
            : [];
        $found['machine'] = $machine;
        $found['machine_source'] = $machineSource !== '' ? $machineSource : 'hardware';
        $found['device_name'] = $deviceName !== '' ? $deviceName : ($found['device_name'] ?? '');
        $found['client_version'] = $clientVersion !== '' ? $clientVersion : ($found['client_version'] ?? '');
        $found['platform'] = $platform !== '' ? $platform : ($found['platform'] ?? '');
        $found['last_ip'] = $remoteIp !== '' ? $remoteIp : ($found['last_ip'] ?? '');
        $found['lan_ips'] = count($lanIps) > 0 ? $lanIps : ($found['lan_ips'] ?? []);
        $found['macs'] = count($macs) > 0 ? $macs : ($found['macs'] ?? []);
        if (empty($found['first_seen_at'])) {
            $found['first_seen_at'] = $now;
        }
        $found['last_check_at'] = $now;
        $found['check_count'] = 1 + intval($found['check_count'] ?? 0);
        $codes[$foundIndex] = $found;
        if (!save_codes($codes)) {
            respond(['success' => false, 'active' => false, 'message' => '激活记录保存失败']);
        }
        append_check_log([
            'time' => $now,
            'code' => strval($found['code']),
            'machine' => $machine,
            'machine_source' => $machineSource,
            'device_name' => $deviceName,
            'group_id' => $group ? $group['id'] : ($found['group_id'] ?? null),
            'group_name' => $group ? $group['name'] : ($found['group_name'] ?? ''),
            'ip' => $remoteIp,
            'lan_ips' => $lanIps,
            'client_version' => $clientVersion,
            'platform' => $platform,
        ]);
        respond([
            'success' => true,
            'active' => true,
            'expiresAt' => $found['expires_at'],
            'machineCode' => $machine,
            'message' => '激活成功',
            'plan' => $group ? $group['name'] : null,
            'tier' => $group ? $group['name'] : ($found['tier'] ?? 'free'),
            'activationPolicy' => $config['activationPolicy'],
            'moduleAccess' => module_rules($config, $group ? $group['id'] : null),
        ]);
        break;

    case 'list':
        require_admin();
        $config = load_activation_config();
        $codes = load_codes();
        usort($codes, function ($a, $b) {
            return strcmp(strval($b['created_at']), strval($a['created_at']));
        });
        foreach ($codes as $index => $record) {
            $group = find_group($config, isset($record['group_id']) && $record['group_id'] !== '' ? $record['group_id'] : (isset($record['tier']) ? $record['tier'] : null));
            $codes[$index]['group_name'] = $group ? $group['name'] : (isset($record['tier']) ? $record['tier'] : '未指定');
            $codes[$index]['group_system'] = $group ? !empty($group['system']) : false;
            $codes[$index]['tier'] = $group ? $group['name'] : (isset($record['tier']) ? $record['tier'] : 'free');
        }
        respond(['success' => true, 'codes' => $codes]);
        break;

    case 'updateCode':
        require_admin();
        $code = isset($input['code']) ? strtoupper(trim(strval($input['code']))) : '';
        if ($code === '') {
            error_message('激活码为空');
        }
        $config = load_activation_config();
        $codes = load_codes();
        $foundIndex = -1;
        foreach ($codes as $index => $record) {
            if (strtoupper(trim(strval($record['code']))) === $code) {
                $foundIndex = $index;
                break;
            }
        }
        if ($foundIndex === -1) {
            error_message('激活码不存在');
        }
        $record = $codes[$foundIndex];
        if (isset($input['groupId']) && trim(strval($input['groupId'])) !== '') {
            $groupId = trim(strval($input['groupId']));
            $group = find_group($config, $groupId);
            if (!$group) {
                error_message('用户分组不存在');
            }
            if (!empty($group['system'])) {
                error_message('不能把激活码改为未激活用户分组');
            }
            $record['group_id'] = $group['id'];
            $record['group_name'] = $group['name'];
            $record['tier'] = $group['name'];
        }
        if (isset($input['status'])) {
            if (!in_array(strval($input['status']), ['active', 'disabled'], true)) {
                error_message('无效的状态');
            }
            $record['status'] = strval($input['status']);
        }
        if (isset($input['extendDays']) && intval($input['extendDays']) > 0) {
            $extendDays = min(3650, intval($input['extendDays']));
            $base = isset($record['expires_at']) ? strtotime($record['expires_at']) : time();
            if (!$base || $base < time()) {
                $base = time();
            }
            $record['expires_at'] = date('c', $base + $extendDays * 86400);
            $record['days'] = max(1, ($extendDays + max(0, intval($record['days'] ?? 0))));
        }
        $codes[$foundIndex] = $record;
        save_codes($codes);
        $resolvedGroup = find_group($config, $record['group_id'] ?? ($record['tier'] ?? null));
        respond([
            'success' => true,
            'message' => '激活码已更新',
            'record' => array_merge($record, [
                'group_name' => $resolvedGroup ? $resolvedGroup['name'] : ($record['tier'] ?? '未指定'),
                'group_system' => $resolvedGroup ? !empty($resolvedGroup['system']) : false,
            ]),
        ]);
        break;

    case 'disable':
        require_admin();
        $input['status'] = 'disabled';
        $codes = load_codes();
        $code = isset($input['code']) ? strtoupper(trim(strval($input['code']))) : '';
        foreach ($codes as $index => $record) {
            if (strtoupper(trim(strval($record['code']))) === $code) {
                $codes[$index]['status'] = 'disabled';
                save_codes($codes);
                respond(['success' => true, 'message' => '已禁用']);
            }
        }
        error_message('激活码不存在');
        break;

    case 'enable':
        require_admin();
        $code = isset($input['code']) ? strtoupper(trim(strval($input['code']))) : '';
        $codes = load_codes();
        foreach ($codes as $index => $record) {
            if (strtoupper(trim(strval($record['code']))) === $code) {
                $codes[$index]['status'] = 'active';
                save_codes($codes);
                respond(['success' => true, 'message' => '已启用']);
            }
        }
        error_message('激活码不存在');
        break;

    case 'unbind':
        require_admin();
        $code = isset($input['code']) ? strtoupper(trim(strval($input['code']))) : '';
        $codes = load_codes();
        foreach ($codes as $index => $record) {
            if (strtoupper(trim(strval($record['code']))) === $code) {
                $codes[$index]['machine'] = null;
                save_codes($codes);
                respond(['success' => true, 'message' => '已解除绑定']);
            }
        }
        error_message('激活码不存在');
        break;

    case 'delete':
        require_admin();
        $code = isset($input['code']) ? strtoupper(trim(strval($input['code']))) : '';
        $codes = load_codes();
        $kept = array_values(array_filter($codes, function ($record) use ($code) {
            return strtoupper(trim(strval($record['code']))) !== $code;
        }));
        if (count($kept) === count($codes)) {
            error_message('激活码不存在');
        }
        save_codes($kept);
        respond(['success' => true, 'message' => '已删除']);
        break;

    case 'dashboard':
        require_admin();
        $config = load_activation_config();
        $codes = load_codes();
        $logs = load_logs();
        $todayStart = strtotime(date('Y-m-d'));
        $weekStart = strtotime('-7 days', $todayStart);
        $checksToday = 0;
        $checksWeek = 0;
        foreach ($logs as $log) {
            $t = strtotime(strval($log['time'] ?? ''));
            if ($t >= $todayStart) {
                $checksToday++;
            }
            if ($t >= $weekStart) {
                $checksWeek++;
            }
        }
        $devices = [];
        $uniqueMachines = [];
        $activeCodes = 0;
        foreach ($codes as $record) {
            if (isset($record['status']) && $record['status'] === 'active') {
                $activeCodes++;
            }
            $machine = trim(strval($record['machine'] ?? ''));
            if ($machine === '') {
                continue;
            }
            $groupId = isset($record['group_id']) && $record['group_id'] !== ''
                ? $record['group_id']
                : (isset($record['tier']) ? $record['tier'] : null);
            $group = find_group($config, $groupId);
            $record['group_name'] = $group ? $group['name'] : ($record['group_name'] ?? '未指定');
            $record['tier'] = $group ? $group['name'] : ($record['tier'] ?? '未指定');
            $devices[] = $record;
            $uniqueMachines[$machine] = true;
        }
        usort($devices, function ($a, $b) {
            return strcmp(strval($b['last_check_at'] ?? ''), strval($a['last_check_at'] ?? ''));
        });
        respond([
            'success' => true,
            'devices' => $devices,
            'logs' => array_slice($logs, 0, 200),
            'stats' => [
                'devices' => count($uniqueMachines),
                'bindings' => count($devices),
                'codes' => count($codes),
                'activeCodes' => $activeCodes,
                'checksToday' => $checksToday,
                'checksWeek' => $checksWeek,
                'checksTotal' => count($logs),
            ],
        ]);
        break;

    case 'deviceLogs':
        require_admin();
        $machine = trim(strval($input['machine'] ?? ''));
        if ($machine === '') {
            error_message('设备指纹为空');
        }
        $logs = array_values(array_filter(load_logs(), function ($log) use ($machine) {
            return strval($log['machine'] ?? '') === $machine;
        }));
        $bindings = array_values(array_filter(load_codes(), function ($record) use ($machine) {
            return strval($record['machine'] ?? '') === $machine;
        }));
        respond(['success' => true, 'machine' => $machine, 'logs' => $logs, 'bindings' => $bindings]);
        break;

    case 'clearLogs':
        require_admin();
        if (save_logs([])) {
            respond(['success' => true, 'message' => '使用记录已清空']);
        }
        error_message('使用记录清空失败');
        break;

    case 'clearAllData':
        require_admin();
        $codesOk = save_codes([]);
        $logsOk = save_logs([]);
        if ($codesOk && $logsOk) {
            respond(['success' => true, 'message' => '激活码与使用记录已全部清空']);
        }
        error_message('数据清空失败');
        break;

    default:
        respond(['success' => false, 'message' => '未知操作']);
}
