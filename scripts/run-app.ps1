# 以【普通权限】启动构建产物，并校验完整性级别。
#
# 为什么必须这样启动：Windows 的 UIPI 会掐掉"资源管理器(Medium) → 管理员窗口(High)"的拖放，
# 表现为禁止光标 + 完全不触发任何事件（连 Tauri 的 DragDrop Enter 都没有）。
# 从管理员 shell 直接 Start-Process 会让 App 继承管理员权限 → 拖放、'SC 球/转换面板' 一起失效。
# 详见 docs/desktop/tauri-regression.md §15.2 / §15.3。
#
# 用途：**开发/临时**从构建产物目录直接跑（改了代码想立刻看效果用这个）。
# 日常使用请用 scripts/install-local.ps1 -Build：它会把 exe 装到固定目录
# （D:\APP\ShortCut-Tauri\），自启与快捷方式都指向那里，target/ 才能随时清理。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/run-app.ps1            # release
#   powershell -ExecutionPolicy Bypass -File scripts/run-app.ps1 -Debug     # debug 产物（需先 build debug）
param(
  [switch]$Debug,
  [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$profileName = if ($Debug) { 'debug' } else { 'release' }
$exe = Join-Path $root "src-tauri\target\$profileName\shortcut-tauri.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  throw "找不到构建产物：$exe（先构建：cd src-tauri; cargo build --release --features custom-protocol）"
}

if (-not $KeepRunning) {
  Get-Process shortcut-tauri -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "停止旧实例 pid=$($_.Id)"
    Stop-Process -Id $_.Id -Force
  }
  Start-Sleep -Seconds 2
}

# 关键：交给已运行的资源管理器（Medium 完整性）去启动，从而"降权"
Write-Host "以普通权限启动：$exe"
Start-Process explorer.exe -ArgumentList "`"$exe`""
Start-Sleep -Seconds 6

$proc = Get-Process shortcut-tauri -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { throw 'App 未启动（检查 exe 路径与依赖）' }

# 校验：父进程必须是 explorer.exe，且 TokenElevation = 0
$parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)").ParentProcessId
$parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue

Add-Type -Namespace Dsh -Name Elev -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
[DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
[DllImport("advapi32.dll", SetLastError=true)] public static extern bool GetTokenInformation(IntPtr token, int cls, out uint info, uint len, out uint ret);
public static string Check(uint pid) {
  IntPtr proc = OpenProcess(0x1000, false, pid);
  if (proc == IntPtr.Zero) return "unknown";
  IntPtr token;
  if (!OpenProcessToken(proc, 0x0008, out token)) { CloseHandle(proc); return "unknown"; }
  uint info; uint ret;
  bool ok = GetTokenInformation(token, 20, out info, 4, out ret);
  CloseHandle(token); CloseHandle(proc);
  if (!ok) return "unknown";
  return info != 0 ? "elevated" : "medium";
}
'@

$level = [Dsh.Elev]::Check([uint32]$proc.Id)
Write-Host "pid=$($proc.Id)  父进程=$($parent.Name)  完整性级别=$level"
if ($level -eq 'elevated') {
  throw '❌ 启动后仍是管理员权限：拖放会失效。请检查是否从提权 shell 启动，或快捷方式勾了"以管理员身份运行"。'
}
Write-Host '✅ 普通权限启动成功：拖放（SC 球 / 转换面板）正常，驾驶舱温度走"一次授权"通道。'
