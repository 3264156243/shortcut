# ShortCut 安卓端发布脚本
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File android/publish.ps1
#   powershell -ExecutionPolicy Bypass -File android/publish.ps1 -SkipUpload   # 只出产物
#
# 它做什么：构建 release → 校验签名与版本 → 生成 latest.json → 上传到服务器
#
# 为什么不放 scripts/：按《协同开发规范》§3，scripts/** 归桌面侧，安卓侧不能动。
#
# ⚠️ 含中文，必须以 UTF-8 BOM 保存（规范 §8.3：PowerShell 5.1 的坑）。

param(
  [string]$ServerHost = '',
  [int]$Port = 22,
  [string]$User = 'root',
  [string]$RemoteDirectory = '/www/wwwroot/ShortCut/updates/android',
  [string]$BaseUrl = 'https://shortcut.326415.xyz/updates/android',
  [switch]$SkipUpload
)

$ErrorActionPreference = 'Stop'

$androidRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $androidRoot
$outputDirectory = Join-Path $androidRoot 'build-update'

Write-Host '=== ShortCut 安卓端发布 ===' -ForegroundColor Cyan

# ---------- 0. 环境 ----------
# 本机 PATH 默认解析到 JDK 25，而 AGP 不支持（Unsupported class file major version 69），
# 所以这里显式指定 JDK 21。
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

# ---------- 5. 校验签名（关键：未签名的包用户装不上） ----------
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
# 但判据换成 versionCode —— 安卓系统本身就是按它判断能否覆盖安装。
$manifest = [ordered]@{
  versionCode             = $versionCode
  versionName             = $versionName
  apkUrl                  = "$BaseUrl/$apkName"
  sha256                  = $sha256
  size                    = $size
  releaseNotes            = $releaseNotes
  releaseDate             = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  minSupportedVersionCode = 1
}
$manifestPath = Join-Path $outputDirectory 'latest.json'
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "清单：$manifestPath"
Write-Host '--- latest.json ---'
Get-Content -LiteralPath $manifestPath -Encoding UTF8

# ---------- 8. 上传 ----------
if ($SkipUpload) {
  Write-Host '已跳过上传（-SkipUpload）。' -ForegroundColor Yellow
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ServerHost)) {
  throw '未指定 -ServerHost。服务器连接信息不在仓库里，请显式传入或使用 -SkipUpload。'
}

$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
if (-not (Test-Path -LiteralPath $scp)) {
  # 回退：本机 OpenSSH 未装时用 Git 自带的
  $scp = 'D:\dev\git\usr\bin\scp.exe'
  if (-not (Test-Path -LiteralPath $scp)) { throw '未找到 scp，请安装 OpenSSH 客户端。' }
}

Write-Host "上传到 $User@$ServerHost`:$RemoteDirectory …" -ForegroundColor Cyan
& $scp -P $Port $apkTarget $manifestPath "${User}@${ServerHost}:${RemoteDirectory}/"
if ($LASTEXITCODE -ne 0) { throw '上传失败' }

Write-Host '上传完成。验证：' -ForegroundColor Green
Write-Host "  $BaseUrl/latest.json"
