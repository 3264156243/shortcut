param(
    [string]$Executable = (Join-Path $PSScriptRoot '..\src-tauri\target\release\shortcut-tauri.exe'),
    [string]$Output = (Join-Path $PSScriptRoot '..\website\assets\img\screens\main-panel-raw.png'),
    [ValidateSet('shortcut', 'taskwall', 'scball', 'control', 'transfer', 'translate')]
    [string]$Section = 'shortcut'
)

$ErrorActionPreference = 'Stop'
$captureRoot = Join-Path $env:TEMP 'shortcut-website-capture'
$captureRootFull = [System.IO.Path]::GetFullPath($captureRoot)
$tempRootFull = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
if (-not $captureRootFull.StartsWith($tempRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Capture directory must stay under the system temp directory: $captureRootFull"
}
$appData = Join-Path $captureRoot 'AppData'
$sourceRoot = Join-Path $env:APPDATA 'ShortCut'
$targetRoot = Join-Path $appData 'ShortCut'
$targetConfig = Join-Path $targetRoot 'shortcut'
$targetIcons = Join-Path $targetConfig 'icons'
$oldAppData = $env:APPDATA
$process = $null

function Ensure-Parent([string]$Path) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
}

Ensure-Parent $Output
if (Test-Path $captureRootFull) { Remove-Item -LiteralPath $captureRootFull -Recurse -Force }
New-Item -ItemType Directory -Force -Path $targetIcons | Out-Null

foreach ($name in @('config.json', 'desk-token.json')) {
    $source = Join-Path $sourceRoot "shortcut\$name"
    if (Test-Path $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $targetConfig $name) -Force }
}

$moduleBySection = @{
    shortcut = 'shortcuts'
    taskwall = 'tasks'
    scball = 'island'
    control = 'control'
    transfer = 'fileTransfer'
    translate = 'translate'
}
$tempConfigPath = Join-Path $targetConfig 'config.json'
if ((Test-Path $tempConfigPath) -and $moduleBySection.ContainsKey($Section)) {
    $tempConfig = Get-Content -LiteralPath $tempConfigPath -Raw | ConvertFrom-Json
    $tempConfig.activeModule = $moduleBySection[$Section]
    $json = $tempConfig | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($tempConfigPath, $json, [System.Text.UTF8Encoding]::new($false))
}
$windowState = Join-Path $sourceRoot 'window-state.json'
if (Test-Path $windowState) { Copy-Item -LiteralPath $windowState -Destination (Join-Path $targetRoot 'window-state.json') -Force }
$iconSource = Join-Path $sourceRoot 'shortcut\icons'
if (Test-Path $iconSource) { Copy-Item -Path (Join-Path $iconSource '*') -Destination $targetIcons -Recurse -Force }

try {
    $env:APPDATA = $appData
    $process = Start-Process -FilePath $Executable -PassThru
    Start-Sleep -Seconds 5

    Add-Type -AssemblyName System.Drawing
    if (-not ('WebsiteCaptureWin32' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WebsiteCaptureWin32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr deviceContext, uint flags);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
}
'@
    }

    if (-not ('WebsiteCaptureWindows' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WebsiteCaptureWindows {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxLength);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    public static IntPtr FindLargestWindow(uint processId, string requiredTitle) {
        IntPtr best = IntPtr.Zero;
        long bestArea = 0;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            uint owner;
            GetWindowThreadProcessId(hWnd, out owner);
            if (owner != processId) return true;
            StringBuilder title = new StringBuilder(256);
            GetWindowText(hWnd, title, title.Capacity);
            if (requiredTitle.Length > 0 && title.ToString() != requiredTitle) return true;
            RECT rect;
            if (!GetWindowRect(hWnd, out rect)) return true;
            long width = Math.Max(0, rect.Right - rect.Left);
            long height = Math.Max(0, rect.Bottom - rect.Top);
            long area = width * height;
            if (area > bestArea) { bestArea = area; best = hWnd; }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
'@
    }

    # The app creates the main panel hidden. Select the largest top-level window
    # for this temporary process and show it directly, bypassing hotkey timing.
    $windowHandle = [WebsiteCaptureWindows]::FindLargestWindow([uint32]$process.Id, 'ShortCut')
    if ($windowHandle -eq [IntPtr]::Zero) { throw 'Could not find the ShortCut main window.' }

    [WebsiteCaptureWin32]::ShowWindow($windowHandle, 5) | Out-Null
    [WebsiteCaptureWin32]::MoveWindow($windowHandle, 24, 24, 1180, 760, $true) | Out-Null
    [WebsiteCaptureWin32]::SetForegroundWindow($windowHandle) | Out-Null
    Start-Sleep -Seconds 2

    $rect = New-Object WebsiteCaptureWin32+RECT
    [WebsiteCaptureWin32]::GetWindowRect($windowHandle, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) { throw 'Invalid ShortCut window bounds.' }

    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $deviceContext = $graphics.GetHdc()
        try {
            $captured = [WebsiteCaptureWin32]::PrintWindow($windowHandle, $deviceContext, 2)
        } finally {
            $graphics.ReleaseHdc($deviceContext)
        }
        if (-not $captured) {
            $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
        }
        $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    $env:APPDATA = $oldAppData
}

Get-Item -LiteralPath $Output | Select-Object FullName, Length, LastWriteTime
