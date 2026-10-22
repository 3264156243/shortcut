# 官网部署脚本
# ---------------------------------------------------------------------------
# 把 website/ 下的纯静态站点发布到服务器站点根，并在发布前备份全部覆盖内容。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-site.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-site.ps1 -DryRun
#
# 安全约定：
#   - 只上传白名单文件/目录，绝不上传 _bodies/ _preview*.html
#   - 不触碰既有目录：mobile/ taskwall/ transfer/ control/ sync/ updates/ activation/
#   - 发布前生成 /www/wwwroot/ShortCut-site-backup-<时间戳>.tar.gz
#
# 依赖：Posh-SSH（Install-Module Posh-SSH -Scope CurrentUser）

param(
    [switch]$DryRun,
    [string]$CredFile = 'D:\wenjian\mima\服务器连接信息.md'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$site = Join-Path $root 'website'

if (-not (Test-Path $site)) { throw "找不到站点目录：$site" }
if (-not (Test-Path $CredFile)) { throw "找不到凭据文件：$CredFile（需含 IP / 用户名 / 密码）" }

# ── 1. 从凭据文件读取连接信息 ────────────────────────────────────────────────
$cfg  = Get-Content $CredFile -Raw -Encoding UTF8
$ip   = ([regex]::Match($cfg, 'IP[：:]\s*(\d{1,3}(?:\.\d{1,3}){3})')).Groups[1].Value
$user = ([regex]::Match($cfg, '用户名[：:]\s*(\S+)')).Groups[1].Value
$pass = ([regex]::Match($cfg, '密码[：:]\s*(\S+)')).Groups[1].Value
if (-not $ip -or -not $user -or -not $pass) { throw '凭据文件缺少 IP / 用户名 / 密码' }

$remoteRoot = '/www/wwwroot/ShortCut'

# ── 2. 白名单：只发布这些内容 ────────────────────────────────────────────────
$rootFiles = @('index.html', 'download.html', 'changelog.html', 'faq.html', 'feedback.html')
$dirs      = @('features', 'en', 'assets')

$stage = Join-Path $env:TEMP ('sc-site-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$stage = [IO.Path]::GetFullPath($stage)
if (-not $stage.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw '暂存目录不在 TEMP 内' }

try {
    foreach ($f in $rootFiles) {
        $p = Join-Path $site $f
        if (Test-Path $p) { Copy-Item $p $stage -Force }
        else { Write-Warning "缺少页面：$f" }
    }
    foreach ($d in $dirs) {
        $p = Join-Path $site $d
        if (Test-Path $p) { Copy-Item $p $stage -Recurse -Force }
    }

    # 纯色本地备份图不必上线（logo-512 仅用于生成其它尺寸）
    $drop = Join-Path $stage 'assets\img\logo-512.png'
    if (Test-Path $drop) { Remove-Item $drop -Force }

    # ── 缓存击穿：给 css/js 引用加内容哈希版本号 ─────────────────────────────
    # 源站对 js/css 设了 12 小时缓存，不改 URL 的话用户会一直拿到旧脚本
    # （典型表现：新加的导航入口"看不见"）。这里只在暂存目录改写，仓库保持干净。
    $stampScript = Join-Path $PSScriptRoot 'stamp-assets.mjs'
    if ((Test-Path $stampScript) -and (Get-Command node -ErrorAction SilentlyContinue)) {
        $stampOut = & node $stampScript $stage 2>&1
        $stampOut | Where-Object { $_ -match '改写|资源引用' } | ForEach-Object { Write-Host ('  ' + $_) }
    } else {
        Write-Warning '跳过资源版本戳（缺 stamp-assets.mjs 或 node）'
    }

    $zip = Join-Path $env:TEMP 'sc-site.zip'
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($entry in (Get-ChildItem -LiteralPath $stage -Recurse -File)) {
            $relative = $entry.FullName.Substring($stage.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $entry.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }

    $files = (Get-ChildItem $stage -Recurse -File).Count
    $kb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
    Write-Host "打包完成：$files 个文件，$kb KB" -ForegroundColor Cyan
    Write-Host "  目标：$($ip):$remoteRoot" -ForegroundColor Cyan

    if ($DryRun) {
        Write-Host 'DryRun：仅打包，不上传。' -ForegroundColor Yellow
        return
    }

    # ── 3. 上传并解包 ────────────────────────────────────────────────────────
    Import-Module Posh-SSH -ErrorAction Stop
    $sec  = ConvertTo-SecureString $pass -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($user, $sec)
    $session = New-SSHSession -ComputerName $ip -Credential $cred -AcceptKey -ConnectionTimeout 60
    $sid = $session.SessionId

    try {
        Write-Host '上传中…' -NoNewline
        Set-SCPItem -ComputerName $ip -Credential $cred -AcceptKey -Path $zip -Destination '/tmp' | Out-Null
        Write-Host ' 完成'

        $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
        $cmd = @"
set -e
cd $remoteRoot
tar -czf /www/wwwroot/ShortCut-site-backup-$ts.tar.gz index.html download.html changelog.html faq.html feedback.html features en assets
unzip -o -q /tmp/sc-site.zip
chown -R www:www index.html download.html changelog.html faq.html feedback.html features en assets
chmod 644 index.html download.html changelog.html faq.html feedback.html
find features en assets -type d -exec chmod 755 {} \;
find features en assets -type f -exec chmod 644 {} \;
rm -f /tmp/sc-site.zip
echo "OK backup=/www/wwwroot/ShortCut-site-backup-$ts.tar.gz"
"@
        $result = Invoke-SSHCommand -SessionId $sid -Command $cmd -TimeOut 180
        $result.Output | ForEach-Object { Write-Host ('  ' + $_) }
        if ($result.ExitStatus -ne 0) { throw ('远程部署失败：' + ($result.Error -join ' ')) }
    }
    finally {
        Remove-SSHSession -SessionId $sid | Out-Null
    }

    Write-Host "`n部署完成。静态站点完整备份：/www/wwwroot/ShortCut-site-backup-$ts.tar.gz" -ForegroundColor Green
}
finally {
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
