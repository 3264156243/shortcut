<?php
/**
 * 移动端共享 SDK 透传入口（防缓存）
 *
 * 为什么需要它：
 *   /sync/web/sdk.js 是静态 .js，nginx 里 `location ~ .*\.(js|css)?$ { expires 12h; }`
 *   会给出 12 小时缓存头，而站点前面还有 Cloudflare，CF 对静态资源默认按
 *   browser cache TTL = 4 小时缓存（cf-cache-status: HIT）。结果是：云端 sdk.js
 *   改了，手机端最长 4 小时仍拿到旧副本，页面行为与云端代码不一致，排查时会
 *   误判成"服务端没生效"。
 *
 *   走 PHP 出口后：CF 默认不缓存 .php，且这里显式发 no-store，手机每次拿到的
 *   都是当前云端版本。HTML 页面本身已用 meta 防缓存，两者配合即可保证
 *   「云端一改，手机刷新即生效」。
 *
 * 兼容：/sync/web/sdk.js 原路径保留（桌面端如引用不受影响）。
 */

header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

$file = __DIR__ . '/web/sdk.js';
if (!is_readable($file)) {
    http_response_code(500);
    echo '/* sdk.js not found */';
    exit;
}

// 保持与静态文件一致的弱校验值，便于部署后用 md5 核对内容是否上线
header('X-Sdk-Size: ' . (string) filesize($file));
readfile($file);
