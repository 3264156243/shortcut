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

    case 'policy':
        // 公开端点：返回全部分组的板块/子功能权限（客户端激活板块展示用）
        $config = load_activation_config();
        $groups = [];
        foreach ($config['groups'] as $group) {
            $groups[] = [
                'id' => $group['id'],
                'name' => $group['name'],
                'system' => !empty($group['system']),
                'enabled' => !empty($group['enabled']),
                'permissions' => $group['permissions'],
                'fileTransferPolicy' => $group['fileTransferPolicy'] ?? normalize_transfer_policy(),
            ];
        }
        $trialUsed = false;
        $trialActive = false;
        $trialExpiresAt = null;
        $machine = trim(strval($input['machineCode'] ?? ''));
        if ($machine !== '') {
            $devices = load_devices();
            $trialUsed = isset($devices[$machine]['trial_used_at']) && $devices[$machine]['trial_used_at'] !== '';
            $trialCodes = load_codes();
            foreach ($trialCodes as $record) {
                if ((strval($record['kind'] ?? '') === 'trial') && strval($record['machine'] ?? '') === $machine && strval($record['status'] ?? '') === 'active' && isset($record['expires_at']) && strtotime($record['expires_at']) >= time()) {
                    $trialActive = true;
                    $trialExpiresAt = $record['expires_at'];
                    break;
                }
            }
        }
        respond([
            'success' => true,
            'groups' => $groups,
            'moduleMeta' => $GLOBALS['MODULE_META'],
            'featureMeta' => $GLOBALS['FEATURE_META'],
            'activationPolicy' => $config['activationPolicy'],
            'guestEnabled' => $config['guestEnabled'],
            'trialEnabled' => !empty($config['trialEnabled']),
            'trialMinutes' => max(1, min(1440, intval($config['trialMinutes'] ?? 10))),
            'trialUsed' => $trialUsed,
            'trialActive' => $trialActive,
            'trialExpiresAt' => $trialExpiresAt,
            'contactLine' => $config['contactLine'],
        ]);
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
        respond(array_merge(['success' => true], $config, [
            'moduleMeta' => $GLOBALS['MODULE_META'],
            'featureMeta' => $GLOBALS['FEATURE_META'],
        ]));
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
        if (array_key_exists('trialEnabled', $input)) {
            $config['trialEnabled'] = !empty($input['trialEnabled']);
        }
        if (array_key_exists('trialMinutes', $input)) {
            $config['trialMinutes'] = max(1, min(1440, intval($input['trialMinutes'])));
        }
        if (array_key_exists('contactLine', $input)) {
            $config['contactLine'] = trim(strval($input['contactLine']));
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
                foreach ($GLOBALS['FEATURE_META'] as $fid => $fmeta) {
                    $permissions[$fid] = array_key_exists($fid, $rawPerms) ? !empty($rawPerms[$fid]) : true;
                }
                $groups[] = [
                    'id' => $gid,
                    'name' => trim(strval($group['name'] ?? '')) !== '' ? trim(strval($group['name'])) : ('用户组' . (count($groups) + 1)),
                    'system' => !empty($group['system']),
                    'enabled' => array_key_exists('enabled', $group) ? !empty($group['enabled']) : true,
                    'permissions' => $permissions,
                    'fileTransferPolicy' => normalize_transfer_policy($group['fileTransferPolicy'] ?? null),
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

    case 'report':
        $machine = isset($input['machineCode']) ? trim(strval($input['machineCode'])) : '';
        if ($machine === '') {
            respond(['success' => false, 'message' => '机器码为空']);
        }
        sync_module_meta(isset($clientInfo['modules']) && is_array($clientInfo['modules']) ? $clientInfo['modules'] : null);
        $code = isset($input['code']) ? strtoupper(trim(strval($input['code']))) : '';
        $now = date('c');
        $remoteIp = isset($_SERVER['REMOTE_ADDR']) ? strval($_SERVER['REMOTE_ADDR']) : '';
        $info = normalize_client_info($clientInfo);
        if (!upsert_device($machine, $clientInfo, $code, $remoteIp)) {
            respond(['success' => false, 'message' => '设备上报保存失败']);
        }
        append_check_log([
            'time' => $now,
            'code' => $code,
            'machine' => $machine,
            'machine_source' => $info['machineSource'],
            'device_name' => $info['hostname'],
            'group_id' => null,
            'group_name' => '',
            'ip' => $remoteIp,
            'lan_ips' => $info['lanIps'],
            'client_version' => $info['appVersion'],
            'platform' => $info['platform'],
            'event' => 'startup',
        ]);
        respond(['success' => true, 'message' => '设备已上报', 'machineCode' => $machine]);
        break;

    case 'check':
        $code = isset($input['code']) ? strtoupper(trim(strval($input['code']))) : '';
        $machine = isset($input['machineCode']) ? trim(strval($input['machineCode'])) : '';
        sync_module_meta(isset($clientInfo['modules']) && is_array($clientInfo['modules']) ? $clientInfo['modules'] : null);
        $config = load_activation_config();
        if ($code === '' || $machine === '') {
            respond([
                'success' => false,
                'active' => false,
                'message' => $code === '' ? '请先填写激活码' : '机器码为空',
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => public_module_rules($config),
                'featureAccess' => public_feature_rules($config),
                'guestEnabled' => $config['guestEnabled'],
                'contactLine' => $config['contactLine'],
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
                'featureAccess' => public_feature_rules($config),
                'guestEnabled' => $config['guestEnabled'],
                'contactLine' => $config['contactLine'],
            ]);
        }
        if ($found['status'] !== 'active') {
            respond([
                'success' => false,
                'active' => false,
                'message' => '激活码已被禁用',
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => public_module_rules($config),
                'featureAccess' => public_feature_rules($config),
                'guestEnabled' => $config['guestEnabled'],
                'contactLine' => $config['contactLine'],
            ]);
        }
        if (isset($found['expires_at']) && strtotime($found['expires_at']) < time()) {
            respond([
                'success' => false,
                'active' => false,
                'message' => '激活码已过期',
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => public_module_rules($config),
                'featureAccess' => public_feature_rules($config),
                'guestEnabled' => $config['guestEnabled'],
                'contactLine' => $config['contactLine'],
            ]);
        }
        $group = find_group($config, isset($found['group_id']) && $found['group_id'] !== '' ? $found['group_id'] : (isset($found['tier']) ? $found['tier'] : null));
        if ($group && empty($group['enabled'])) {
            respond([
                'success' => false,
                'active' => false,
                'message' => '激活码所属分组已停用',
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => public_module_rules($config),
                'featureAccess' => public_feature_rules($config),
                'guestEnabled' => $config['guestEnabled'],
                'contactLine' => $config['contactLine'],
            ]);
        }
        if (!empty($found['machine']) && $found['machine'] !== $machine) {
            respond([
                'success' => false,
                'active' => false,
                'message' => '激活码已绑定其他设备',
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => module_rules($config, $group ? $group['id'] : null),
                'featureAccess' => feature_rules($config, $group ? $group['id'] : null),
                'guestEnabled' => $config['guestEnabled'],
                'contactLine' => $config['contactLine'],
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
        upsert_device($machine, $clientInfo, strval($found['code']), $remoteIp);
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
            'event' => 'check',
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
            'featureAccess' => feature_rules($config, $group ? $group['id'] : null),
            'guestEnabled' => $config['guestEnabled'],
            'contactLine' => $config['contactLine'],
        ]);
        break;

    case 'trial':
        // 每个机器码有且仅有一次免费试用（10 分钟），试用期间幂等返回
        $machine = trim(strval($input['machineCode'] ?? ''));
        if ($machine === '') {
            respond(['success' => false, 'message' => '机器码为空']);
        }
        $config = load_activation_config();
        if (empty($config['trialEnabled'])) {
            respond(['success' => false, 'message' => '免费试用未开放']);
        }
        $group = find_group($config, 'trial');
        if (!$group || empty($group['enabled'])) {
            respond(['success' => false, 'message' => '免费试用分组已停用']);
        }
        $codes = load_codes();
        $activeTrial = null;
        foreach ($codes as $record) {
            if ((strval($record['kind'] ?? '') === 'trial') && strval($record['machine'] ?? '') === $machine && strval($record['status'] ?? '') === 'active') {
                $activeTrial = $record;
                break;
            }
        }
        if ($activeTrial && isset($activeTrial['expires_at']) && strtotime($activeTrial['expires_at']) >= time()) {
            // 试用仍在有效期内：幂等返回
            respond([
                'success' => true,
                'active' => true,
                'code' => strval($activeTrial['code']),
                'expiresAt' => $activeTrial['expires_at'],
                'tier' => $group['name'],
                'plan' => $group['name'],
                'trialUsed' => true,
                'trialActive' => true,
                'activationPolicy' => $config['activationPolicy'],
                'moduleAccess' => module_rules($config, 'trial'),
                'featureAccess' => feature_rules($config, 'trial'),
                'guestEnabled' => $config['guestEnabled'],
                'contactLine' => $config['contactLine'],
                'message' => '免费试用进行中',
            ]);
        }
        $devices = load_devices();
        $usedAt = isset($devices[$machine]['trial_used_at']) ? $devices[$machine]['trial_used_at'] : null;
        if ($usedAt !== null && $usedAt !== '') {
            respond(['success' => false, 'message' => '该设备已使用过免费试用']);
        }
        $code = 'TRIAL-' . strtoupper(substr(md5(uniqid('', true)), 0, 10));
        $now = time();
        $trialMinutes = max(1, min(1440, intval($config['trialMinutes'] ?? 10)));
        $record = [
            'code' => $code,
            'kind' => 'trial',
            'days' => 0,
            'group_id' => 'trial',
            'group_name' => $group['name'],
            'tier' => $group['name'],
            'status' => 'active',
            'machine' => $machine,
            'created_at' => date('c', $now),
            'expires_at' => date('c', $now + $trialMinutes * 60),
            'last_check_at' => null,
        ];
        $codes[] = $record;
        save_codes($codes);
        $devices[$machine]['trial_used_at'] = date('c', $now);
        save_devices($devices);
        respond([
            'success' => true,
            'active' => true,
            'code' => $code,
            'expiresAt' => $record['expires_at'],
            'tier' => $group['name'],
            'plan' => $group['name'],
            'trialUsed' => true,
            'trialActive' => true,
            'activationPolicy' => $config['activationPolicy'],
            'moduleAccess' => module_rules($config, 'trial'),
            'featureAccess' => feature_rules($config, 'trial'),
            'guestEnabled' => $config['guestEnabled'],
            'contactLine' => $config['contactLine'],
            'message' => '免费试用已开启，' . $trialMinutes . ' 分钟后自动到期',
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
        $registry = load_devices();
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
        $bindingsByMachine = [];
        $activeCodes = 0;
        foreach ($codes as $record) {
            if (isset($record['status']) && $record['status'] === 'active') {
                $activeCodes++;
            }
            $machine = trim(strval($record['machine'] ?? ''));
            if ($machine === '') {
                continue;
            }
            if (!isset($bindingsByMachine[$machine])) {
                $bindingsByMachine[$machine] = [];
            }
            $bindingsByMachine[$machine][] = $record;
        }
        $devicesByMachine = [];
        foreach ($registry as $machine => $device) {
            if (!is_array($device) || trim(strval($machine)) === '') {
                continue;
            }
            $devicesByMachine[$machine] = $device;
        }
        foreach ($bindingsByMachine as $machine => $records) {
            if (!isset($devicesByMachine[$machine])) {
                $devicesByMachine[$machine] = ['machine' => $machine];
            }
            $binding = !empty($records[0]) ? $records[0] : [];
            if (!empty($binding)) {
                $devicesByMachine[$machine]['code'] = strval($binding['code'] ?? '');
                $devicesByMachine[$machine]['status'] = strval($binding['status'] ?? '');
                $devicesByMachine[$machine]['created_at'] = strval($binding['created_at'] ?? '');
                $devicesByMachine[$machine]['expires_at'] = strval($binding['expires_at'] ?? '');
                if (isset($binding['group_id']) && $binding['group_id'] !== '') {
                    $devicesByMachine[$machine]['group_id'] = $binding['group_id'];
                } elseif (isset($binding['tier']) && $binding['tier'] !== '') {
                    $devicesByMachine[$machine]['group_id'] = $binding['tier'];
                }
            }
        }
        $devices = [];
        foreach ($devicesByMachine as $machine => $device) {
            $device['machine'] = $machine;
            $groupId = isset($device['group_id']) && $device['group_id'] !== ''
                ? $device['group_id']
                : (isset($device['tier']) ? $device['tier'] : null);
            $group = find_group($config, $groupId);
            $device['group_name'] = $group ? $group['name'] : ($device['group_name'] ?? '未指定');
            $device['tier'] = $group ? $group['name'] : ($device['tier'] ?? '未指定');
            $device['code'] = $device['code'] ?? '';
            $devices[] = $device;
        }
        usort($devices, function ($a, $b) {
            return strcmp(strval($b['last_check_at'] ?? ''), strval($a['last_check_at'] ?? ''));
        });
        respond([
            'success' => true,
            'devices' => $devices,
            'logs' => array_slice($logs, 0, 200),
            'stats' => [
                'devices' => count($devicesByMachine),
                'bindings' => count($bindingsByMachine),
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
        $devicesOk = save_devices([]);
        if ($codesOk && $logsOk && $devicesOk) {
            respond(['success' => true, 'message' => '激活码、设备与使用记录已全部清空']);
        }
        error_message('数据清空失败');
        break;

    default:
        respond(['success' => false, 'message' => '未知操作']);
}
