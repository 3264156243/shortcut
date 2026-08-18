<?php

$DATA_DIR = __DIR__ . '/data';
$BINDS_FILE = $DATA_DIR . '/binds.json';
$QUEUE_DIR = $DATA_DIR . '/queues';
$RATE_LIMIT_FILE = $DATA_DIR . '/rate-limits.json';
$MAX_QUEUE_ITEMS = 500;

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
