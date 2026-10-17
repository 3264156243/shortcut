# ⚠️ 仅调试用：把构建产物拷到自建目录，并**改指自启/快捷方式**。
#
# 【2026-10-17 起日常不要用它】正式渠道已统一为 **NSIS 安装包**（自启/快捷方式由安装器管理）。
# 用这个脚本会让"安装包版"和"自建目录版"两份并存，导致升级/卸载行为不一致（实际踩过）。
#   · 开发时想快速看效果 → 用 scripts/run-app.ps1（直接从 target/release 跑，不改任何指针）
#   · 想装到本机正式使用 → 装 NSIS 安装包
#
# 保留原因：在没有安装包的机器上做"免安装"验证时仍有用
# （例如排查"安装版能跑、自建目录版不能跑"这类差异）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1              # 用现有构建安装
#   powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1 -Build       # 先构建再安装
#   powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1 -Build -NoStart
param(
  [switch]$Build,
  [switch]$NoStart,
  [string]$InstallDir = 'D:\APP\ShortCut-Tauri'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'src-tauri\target\release'

if ($Build) {
  Write-Host '[1/5] 前端构建（必须先于 Rust：tauri.conf.json 的 frontendDist 是编译期嵌入）'
  Push-Location $root
  npm run build
  Pop-Location
  Write-Host '[2/5] Rust release 构建（约 4~6 分钟）'
  Push-Location (Join-Path $root 'src-tauri')
  cmd /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1 && %USERPROFILE%\.cargo\bin\cargo.exe build --release --features custom-protocol'
  Pop-Location
}

$exe = Join-Path $src 'shortcut-tauri.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "找不到构建产物：$exe（先加 -Build 或手动构建）" }

Write-Host '[3/5] 停止正在运行的实例'
Get-Process shortcut-tauri -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "  停止 pid=$($_.Id)"
  Stop-Process -Id $_.Id -Force
}
Start-Sleep -Seconds 2

Write-Host "[4/5] 安装到固定目录：$InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
# ⚠️ 装好后的文件名**不能叫 ShortCut.exe**：程序里有实例守卫会扫 tasklist，
#    一旦发现名为 shortcut.exe 的进程就认定"旧版 Electron 版在运行"并拒绝启动
#    （命名成 ShortCut.exe 会把自己认成它 → 静默退出、连日志都不写）。
$targetExe = Join-Path $InstallDir 'ShortCut-Tauri.exe'
Copy-Item -LiteralPath $exe -Destination $targetExe -Force
# 运行时必需：exe 依赖同目录的 app_lib.dll（其余是系统 DLL / WebView2）
$dll = Join-Path $src 'app_lib.dll'
if (Test-Path -LiteralPath $dll) { Copy-Item -LiteralPath $dll -Destination (Join-Path $InstallDir 'app_lib.dll') -Force }
Write-Host ('  已安装：{0}（{1:N2} MB）' -f $targetExe, ((Get-Item $targetExe).Length / 1MB))

Write-Host '[5/5] 指向自启与快捷方式'
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'com.wanan.shortcut' -Value ('"' + $targetExe + '"')
$sh = New-Object -ComObject WScript.Shell
$links = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ShortCut.lnk'),
  (Join-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" 'ShortCut.lnk')
)
foreach ($lnk in $links) {
  if (Test-Path -LiteralPath $lnk) {
    $sc = $sh.CreateShortcut($lnk)
    $sc.TargetPath = $targetExe
    $sc.WorkingDirectory = $InstallDir
    $sc.Arguments = ''
    $sc.IconLocation = "$targetExe,0"
    $sc.Description = 'ShortCut（Tauri 版）'
    $sc.Save()
    Write-Host ('  已更新快捷方式：{0}' -f (Split-Path $lnk -Leaf))
  }
}

# 校验自启指向 + 以普通权限启动（提权启动会让外部文件拖放整体失效，见 docs/desktop/tauri-regression.md §15.2）
$run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run').'com.wanan.shortcut'
if ($run -notmatch [regex]::Escape($targetExe)) { throw "自启未指向预期路径：$run" }
Write-Host "  自启已指向：$run"

if (-not $NoStart) {
  Start-Process explorer.exe -ArgumentList ('"' + $targetExe + '"')
  Start-Sleep -Seconds 6
  $p = Get-Process shortcut-tauri -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { Write-Host "  已启动：pid=$($p.Id) 路径=$($p.Path)" } else { Write-Host '  ⚠️ 启动后未检测到进程，请手动确认' }
}
Write-Host '✅ 完成。target/ 现在可以安全清理（cargo clean）。'
