$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class UsageNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
}
"@

$sessionId = (Get-Process -Id $PID).SessionId

while ($true) {
  $rows = @()
  $all = @(Get-Process -ErrorAction SilentlyContinue)
  foreach ($p in $all) {
    if ($null -eq $p -or $p.SessionId -ne $sessionId) { continue }
    $itemPath = $null
    $itemTitle = ''
    $itemHandle = [IntPtr]::Zero
    try { $itemPath = $p.Path } catch {}
    if ([string]::IsNullOrWhiteSpace($itemPath)) { continue }
    try { $itemTitle = $p.MainWindowTitle } catch {}
    try { $itemHandle = $p.MainWindowHandle } catch {}
    $rows += [pscustomobject]@{
      name = [string]$p.ProcessName
      id = $p.Id
      path = $itemPath
      title = [string]$itemTitle
      handle = $itemHandle.ToInt64()
    }
  }

  $fgHandle = [UsageNative]::GetForegroundWindow()
  $fgPid = [uint32]0
  try { [UsageNative]::GetWindowThreadProcessId($fgHandle, [ref]$fgPid) | Out-Null } catch {}
  $fgTitle = ''
  if ($fgHandle -ne [IntPtr]::Zero) {
    try {
      $len = [UsageNative]::GetWindowTextLength($fgHandle)
      if ($len -gt 0) {
        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [UsageNative]::GetWindowText($fgHandle, $sb, $sb.Capacity) | Out-Null
        $fgTitle = $sb.ToString()
      }
    } catch {}
  }

  $payload = [pscustomobject]@{
    processes = @($rows)
    foreground = [pscustomobject]@{ pid = $fgPid; title = $fgTitle }
  }
  try {
    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
  } catch {}

  Start-Sleep -Milliseconds 3000
}
