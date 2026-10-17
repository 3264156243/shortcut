# ShortCut 安卓端发布脚本
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File android/publish.ps1                    # 构建 + 上传
#   powershell -ExecutionPolicy Bypass -File android/publish.ps1 -SkipUpload        # 只出产物
#   powershell -ExecutionPolicy Bypass -File android/publish.ps1 -KeyPath <私钥>    # 指定私钥
#
# 它做什么：构建 release → 校验签名与版本 → 生成 latest.json → **SFTP** 上传到服务器
#
# ## 为什么用 sftp 而不是 scp（2026-10-18 桌面侧实测结论）
#
# 桌面侧给了专用的最小权限账号 `android-pub`：
#   - **只能 SFTP**（shell 被强制为 internal-sftp，拿不到命令行）
#   - **只能写** /www/wwwroot/ShortCut/updates/android/
#   - 只允许密钥登录（密码已锁定）
#
# `scp` 在旧版本 OpenSSH 里会调用远端 shell，在这个账号上会被拒，
# 所以改用 sftp 批处理（最稳）。
#
# ## 为什么不放 scripts/
#
# 按《协同开发规范》§3，scripts/** 归桌面侧，安卓侧不能动。
#
# ⚠️ 含中文，必须以 UTF-8 BOM 保存（Windows PowerShell 5.1 的坑）。

param(
  [string]$ServerHost = '43.108.21.35',
  [int]$Port = 22,
  [string]$User = 'android-pub',
  [string]$RemoteDirectory = '/www/wwwroot/ShortCut/updates/android',
  [string]$BaseUrl = 'https://shortcut.326415.xyz/updates/android',
  [string]$KeyPath = '',
  [switch]$SkipUpload
)

$ErrorActionPreference = 'Stop'

$androidRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputDirectory = Join-Path $androidRoot 'build-update'

Write-Host '=== ShortCut 安卓端发布 ===' -ForegroundColor Cyan

# ---------- 0. 环境 ----------
# 本机 PATH 默认解析到 JDK 25，而 AGP 不支持（Unsupported class file major version 69）
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:ANDROID_SDK_ROOT = 'D:\Android\Sdk'
$env:GRADLE_USER_HOME = 'D:\dev\gradle-home'
$env:PATH = "$env:JAVA_HOME\bin;D:\Android\Sdk\platform-tools;$env:PATH"

# ---------- 1. 检查签名配置 ----------
$keystoreProps = Join-Path $androidRoot 'keystore.properties'
if (-not (Test-Path -LiteralPath $keystoreProps)) {
  throw "缺少 android/keystore.properties —— 发布版必须签名，请先按 android/PUBLISH.md 配置。"
}

# ---------- 2. 读版本（以 build.gradle.kts 为准） ----------
$gradleFile = Join-Path $androidRoot 'app/build.gradle.kts'
$gradleText = Get-Content -LiteralPath $gradleFile -Raw -Encoding UTF8

$versionCodeMatch = [regex]::Match($gradleText, 'versionCode\s*=\s*(\d+)')
$versionNameMatch = [regex]::Match($gradleText, 'versionName\s*=\s*"([^"]+)"')
if (-not $versionCodeMatch.Success -or -not $versionNameMatch.Success) {
  throw '无法从 app/build.gradle.kts 解析 versionCode / versionName'
}
$versionCode = [int]$versionCodeMatch.Groups[1].Value
$versionName = $versionNameMatch.Groups[1].Value
Write-Host "版本：$versionName (versionCode=$versionCode)"

# ---------- 3. 更新说明（每个版本必须有） ----------
$notesFile = Join-Path $androidRoot "release-notes/$versionName.md"
if (-not (Test-Path -LiteralPath $notesFile)) {
  throw "缺少更新说明：android/release-notes/$versionName.md（与桌面端 release-notes/ 同一习惯）"
}
$releaseNotes = (Get-Content -LiteralPath $notesFile -Raw -Encoding UTF8).Trim()

# ---------- 4. 构建 ----------
Write-Host '构建 release APK…' -ForegroundColor Cyan
Push-Location $androidRoot
try {
  & (Join-Path $androidRoot 'gradlew.bat') assembleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) { throw 'assembleRelease 失败' }
} finally {
  Pop-Location
}

$apkSource = Join-Path $androidRoot 'app/build/outputs/apk/release/app-release.apk'
if (-not (Test-Path -LiteralPath $apkSource)) { throw "未找到构建产物：$apkSource" }

# ---------- 5. 校验签名（关键：未签名/错签名的包用户装不上） ----------
Write-Host '校验签名…' -ForegroundColor Cyan
$apksigner = 'D:\Android\Sdk\build-tools\35.0.0\apksigner.bat'
if (Test-Path -LiteralPath $apksigner) {
  $signInfo = & $apksigner verify --print-certs $apkSource 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "APK 签名校验失败：$signInfo" }
  $shaMatch = [regex]::Match($signInfo, 'SHA-256 digest:\s*([0-9a-fA-F]+)')
  if ($shaMatch.Success) {
    Write-Host ("签名指纹 SHA-256：" + $shaMatch.Groups[1].Value)
  }
} else {
  Write-Warning "未找到 apksigner，跳过签名校验（$apksigner）"
}

# ---------- 6. 产出物 ----------
if (Test-Path -LiteralPath $outputDirectory) { Remove-Item -LiteralPath $outputDirectory -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$apkName = "ShortCut-$versionName.apk"
$apkTarget = Join-Path $outputDirectory $apkName
Copy-Item -LiteralPath $apkSource -Destination $apkTarget -Force

$size = (Get-Item -LiteralPath $apkTarget).Length
$sha256 = (Get-FileHash -LiteralPath $apkTarget -Algorithm SHA256).Hash.ToLower()
Write-Host "APK：$apkName  $([math]::Round($size / 1MB, 2)) MB"
Write-Host "SHA-256：$sha256"

# ---------- 7. 生成 latest.json ----------
# 字段与桌面端 latest.yml 对齐（版本/大小/sha256/更新说明），
# 但判据换成 versionCode —— 安卓系统本身就是按它判断能否覆盖安装；
# 而且能避开 "0.10.0" 字典序小于 "0.9.0" 的坑。
#
# ⚠️ 不用 ConvertTo-Json：PS 5.1 会把中文转成 \uXXXX 转义。
#    那虽是合法 JSON（客户端能解析），但线上文件对人不友好，这里手写原始中文。
$escapedNotes = ($releaseNotes -replace '\\', '\\\\' -replace '"', '\"' -replace "`r`n", '\n' -replace "`n", '\n')
$manifestText = @"
{
  "versionCode": $versionCode,
  "versionName": "$versionName",
  "apkUrl": "$BaseUrl/$apkName",
  "sha256": "$sha256",
  "size": $size,
  "releaseNotes": "$escapedNotes",
  "releaseDate": "$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))",
  "minSupportedVersionCode": 1
}
"@
$manifestPath = Join-Path $outputDirectory 'latest.json'
[System.IO.File]::WriteAllText($manifestPath, $manifestText, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "清单：$manifestPath"
Write-Host '--- latest.json（前 3 行）---'
Get-Content -LiteralPath $manifestPath -Encoding UTF8 | Select-Object -First 3

# ---------- 8. 上传（SFTP） ----------
if ($SkipUpload) {
  Write-Host '已跳过上传（-SkipUpload）。' -ForegroundColor Yellow
  exit 0
}

# 私钥：默认找仓库外的 D:\wenjian\mima\android-pub-key（与桌面端放服务器信息的习惯一致）
if ([string]::IsNullOrWhiteSpace($KeyPath)) {
  $candidates = @(
    'D:\wenjian\mima\android-pub-key',
    'D:\wenjian\mima\android-pub',
    "$env:USERPROFILE\.ssh\android-pub"
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { $KeyPath = $c; break }
  }
}
if ([string]::IsNullOrWhiteSpace($KeyPath) -or -not (Test-Path -LiteralPath $KeyPath)) {
  throw "未找到 android-pub 私钥。请用 -KeyPath 指定，或放到 D:\wenjian\mima\android-pub-key（**不要提交进 Git**）。"
}

$sftp = 'C:\Windows\System32\OpenSSH\sftp.exe'
if (-not (Test-Path -LiteralPath $sftp)) {
  $sftp = 'D:\dev\git\usr\bin\sftp.exe'
  if (-not (Test-Path -LiteralPath $sftp)) { throw '未找到 sftp.exe' }
}

# OpenSSH 要求私钥权限收紧，否则直接拒绝使用（Windows 上的经典坑）
Write-Host '收紧私钥权限…'
& icacls $KeyPath /inheritance:r | Out-Null
& icacls $KeyPath /grant:r "$($env:USERNAME):(R)" | Out-Null

# SFTP 批处理：逐条 put，最后 bye
$batchFile = Join-Path $env:TEMP ("sc-sftp-" + [guid]::NewGuid().ToString('N') + ".txt")
$apkLeaf = Split-Path $apkTarget -Leaf
$apkRemote = $apkTarget.Replace('\', '/')
$manifestRemote = $manifestPath.Replace('\', '/')
@(
  "put `"$apkRemote`" $RemoteDirectory/$apkLeaf"
  "put `"$manifestRemote`" $RemoteDirectory/latest.json"
  'bye'
) | Set-Content -LiteralPath $batchFile -Encoding ascii

Write-Host "SFTP 上传到 ${User}@${ServerHost}:${RemoteDirectory} …" -ForegroundColor Cyan
try {
  & $sftp -i $KeyPath -P $Port -o StrictHostKeyChecking=accept-new -o BatchMode=yes -b $batchFile "${User}@${ServerHost}"
  if ($LASTEXITCODE -ne 0) { throw "SFTP 上传失败（退出码 $LASTEXITCODE）" }
} finally {
  Remove-Item -LiteralPath $batchFile -Force -ErrorAction SilentlyContinue
}

# ---------- 9. 验证公网可访问 ----------
Write-Host '验证公网地址…' -ForegroundColor Cyan
try {
  $probe = Invoke-WebRequest -Uri "$BaseUrl/latest.json" -TimeoutSec 20 -UseBasicParsing
  if ($probe.StatusCode -eq 200) {
    Write-Host "✓ $BaseUrl/latest.json 已可访问" -ForegroundColor Green
  }
} catch {
  Write-Warning "上传完成，但公网验证失败：$($_.Exception.Message)（CDN 可能有几秒延迟，稍后重试）"
}

Write-Host '发布完成。' -ForegroundColor Green
Write-Host "  清单：$BaseUrl/latest.json"
Write-Host "  APK ：$BaseUrl/$apkName"
