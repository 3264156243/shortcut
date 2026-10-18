# 官网部署脚本
# ---------------------------------------------------------------------------
# 把 website/ 下的纯静态站点发布到服务器站点根，并在发布前备份旧首页。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-site.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-site.ps1 -DryRun
#
# 安全约定：
#   - 只上传白名单文件/目录，绝不上传 _bodies/ _preview*.html
#   - 不触碰既有目录：mobile/ taskwall/ transfer/ control/ sync/ updates/ activation/
#   - 发布前把线上 index.html 备份成 index.html.bak-<时间戳>，回滚即 cp 回来
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
$rootFiles = @('index.html', 'download.html', 'changelog.html', 'faq.html')
$dirs      = @('features', 'assets')

$stage = Join-Path $env:TEMP ('sc-site-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
New-Item -ItemType Directory -Force -Path $stage | Out-Null

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

    $zip = Join-Path $env:TEMP 'sc-site.zip'
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force

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
cd $remoteRoot
[ -f index.html ] && cp -p index.html index.html.bak-$ts
unzip -o -q /tmp/sc-site.zip
chown -R www:www index.html download.html changelog.html faq.html features assets
chmod 644 *.html features/*.html assets/css/* assets/js/* assets/img/*
chmod 755 features assets assets/css assets/js assets/img
rm -f /tmp/sc-site.zip
echo "OK backup=index.html.bak-$ts"
"@
        $out = (Invoke-SSHCommand -SessionId $sid -Command $cmd -TimeOut 180).Output
        $out | ForEach-Object { Write-Host ('  ' + $_) }
    }
    finally {
        Remove-SSHSession -SessionId $sid | Out-Null
    }

    Write-Host "`n部署完成。回滚：cp -p $remoteRoot/index.html.bak-<时间戳> $remoteRoot/index.html" -ForegroundColor Green
}
finally {
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
