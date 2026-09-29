# M6 内存基线：ShortCut Tauri 版 vs Electron 版
# 用法：
#   .\measure-memory.ps1 -Name tauri            # 测 Tauri（进程名 shortcut-tauri / ShortCut）
#   .\measure-memory.ps1 -Name electron         # 测 Electron（进程名 ShortCut）
# 连续采样 12 次（每 10s）取均值/峰值，输出 WorkingSet + PrivateMemorySize (MB)。

param(
    [Parameter(Mandatory = $true)][ValidateSet('tauri', 'electron')][string]$Name
)

$patterns = @{
    tauri    = @('shortcut-tauri', 'ShortCut')
    electron = @('ShortCut')
}

$procs = @()
foreach ($p in $patterns[$Name]) {
    $procs += Get-Process -Name $p -ErrorAction SilentlyContinue
}
$procs = $procs | Sort-Object Id -Unique
if (-not $procs) {
    Write-Output "NO_PROCESS: 找不到 $Name 进程"
    exit 1
}

Write-Output ("进程: " + (($procs | ForEach-Object { "$($_.Id):$($_.ProcessName)" }) -join ', '))

$samples = @()
for ($i = 0; $i -lt 12; $i++) {
    $cur = @()
    foreach ($p in $patterns[$Name]) {
        $cur += Get-Process -Name $p -ErrorAction SilentlyContinue
    }
    $cur = $cur | Sort-Object Id -Unique
    if (-not $cur) { break }
    $ws = ($cur | Measure-Object WorkingSet64 -Sum).Sum / 1MB
    $pm = ($cur | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB
    $count = $cur.Count
    $samples += [PSCustomObject]@{ WS = $ws; PM = $pm; Count = $count }
    Write-Output ("[{0:D2}] 进程数={1}  WorkingSet={2:N1}MB  Private={3:N1}MB" -f ($i + 1), $count, $ws, $pm)
    if ($i -lt 11) { Start-Sleep -Seconds 10 }
}

if ($samples.Count -gt 0) {
    $wsAvg = ($samples | Measure-Object WS -Average).Average
    $wsMax = ($samples | Measure-Object WS -Maximum).Maximum
    $pmAvg = ($samples | Measure-Object PM -Average).Average
    Write-Output ("SUMMARY[{0}]: 进程数={1}  WS均值={2:N1}MB  WS峰值={3:N1}MB  Private均值={4:N1}MB" -f $Name, $samples[-1].Count, $wsAvg, $wsMax, $pmAvg)
}
