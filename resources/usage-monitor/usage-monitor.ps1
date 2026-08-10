$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class UsageNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
  public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }
}
"@

while ($true) {
  $processId = [uint32]0
  $title = ''
  $windowClass = ''
  $idleMs = [uint32]0
  $hwnd = [UsageNative]::GetForegroundWindow()

  if ($hwnd -ne [IntPtr]::Zero) {
    [UsageNative]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
    $len = [UsageNative]::GetWindowTextLength($hwnd)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [UsageNative]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
      $title = $sb.ToString()
    }
    $classBuilder = New-Object System.Text.StringBuilder 256
    [UsageNative]::GetClassName($hwnd, $classBuilder, 256) | Out-Null
    $windowClass = $classBuilder.ToString()
  }

  $lastInput = [UsageNative+LASTINPUTINFO]::new()
  $lastInput.cbSize = [uint32][System.Runtime.InteropServices.Marshal]::SizeOf([type][UsageNative+LASTINPUTINFO])
  if ([UsageNative]::GetLastInputInfo([ref]$lastInput)) {
    $idleMs = [UsageNative]::GetTickCount() - $lastInput.dwTime
  }

  $exe = ''
  $path = ''
  if ($processId -gt 0) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc) {
      $exe = [string]$proc.ProcessName
      try { $path = [string]$proc.Path } catch {}
    }
  }

  $payload = [pscustomobject]@{
    pid = $processId
    exe = $exe
    path = $path
    title = $title
    class = $windowClass
    idleMs = $idleMs
    hwnd = ('0x{0:X}' -f $hwnd.ToInt64())
  }
  try {
    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  } catch {}

  Start-Sleep -Milliseconds 3000
}
