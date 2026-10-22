param(
    [string]$Executable = (Join-Path $PSScriptRoot '..\src-tauri\target\release\shortcut-tauri.exe'),
    [string]$Output = (Join-Path $PSScriptRoot '..\website\assets\img\screens\main-panel-raw.png'),
    [ValidateSet('shortcut', 'taskwall', 'scball', 'control', 'transfer', 'translate')]
    [string]$Section = 'shortcut',
    [switch]$SampleContent,
    [int]$CropTop = 0,
    [int]$ReadyWaitSeconds = 5
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

$copyNames = if ($SampleContent) { @('config.json') } else { @('config.json', 'desk-token.json') }
foreach ($name in $copyNames) {
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
    if ($SampleContent) {
        # All changes below target the isolated copy. Never write the real profile.
        Add-Type -AssemblyName System.Drawing
        $now = '2026-10-22T09:00:00.000Z'
        $sampleShortcuts = @()
        $entries = @(
            @('文件资源管理器', 'app', "$env:WINDIR\explorer.exe"),
            @('浏览器', 'app', 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),
            @('终端', 'app', "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"),
            @('记事本', 'app', "$env:WINDIR\System32\notepad.exe"),
            @('计算器', 'app', "$env:WINDIR\System32\calc.exe"),
            @('项目资料', 'folder', "$env:USERPROFILE\Documents"),
            @('灵感图片', 'folder', "$env:USERPROFILE\Pictures"),
            @('下载文件', 'folder', "$env:USERPROFILE\Downloads")
        )
        $idx = 0
        foreach ($entry in $entries) {
            if (-not (Test-Path -LiteralPath $entry[2])) { continue }
            $iconData = $null
            try {
                $extracted = [System.Drawing.Icon]::ExtractAssociatedIcon($entry[2])
                $iconBitmap = $extracted.ToBitmap()
                $stream = New-Object System.IO.MemoryStream
                try {
                    $iconBitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
                    $iconData = 'data:image/png;base64,' + [Convert]::ToBase64String($stream.ToArray())
                } finally { $stream.Dispose(); $iconBitmap.Dispose(); $extracted.Dispose() }
            } catch { $iconData = $null }
            $sampleShortcuts += @{ id="sample-$idx"; name=$entry[0]; type=$entry[1]; targetPath=$entry[2]; icon=$iconData; remark=''; createdAt=$now; updatedAt=$now; sort=$idx }
            $idx++
        }
        $sampleTabs = @(@{ id='sample-work'; name='工作台'; sort=0; groups=@(@{id='sample-daily';name='每天都会用';collapsed=$false;sort=0;shortcuts=$sampleShortcuts}) }, @{id='sample-personal';name='生活';sort=1;groups=@()}, @{id='sample-ideas';name='灵感与资料';sort=2;groups=@()})
        $sampleNotes = @()
        $texts = @('今天，先把最重要的事做好', '整理这周的灵感和参考', '给周末留一点空白', '把新想法写下来', '完成一件，也值得打个勾', '读完书桌上的那本书')
        for ($n=0; $n -lt $texts.Count; $n++) {
            $sampleNotes += @{id="note-$n";text=$texts[$n];longText=($n -eq 1);details=$(if($n -eq 1){"把零散的想法放在一起。`n留出时间，慢慢变成可以实现的小计划。"}else{''});done=($n -eq 4);x=(3+($n%3)*32);y=(10+[Math]::Floor($n/3)*47);rotation=@(-3,2,-2,2,-1,3)[$n];tape=@('#dfc883','#94c1cc','#d59aab','#a9bc8c','#dfc883','#b6a0cf')[$n];zIndex=($n+1);createdAt=$now;updatedAt=$now}
        }
        $values = @{ tabs=$sampleTabs; activeTabId='sample-work'; tasks=@(); taskBoards=@(@{id='sample-today';name='今天的事';notes=$sampleNotes;createdAt=$now;updatedAt=$now},@{id='sample-ideas';name='灵感便签';notes=@();createdAt=$now;updatedAt=$now}); activeTaskBoardId='sample-today'; taskEditorDraft=$null; scTaskList=@(); searchHistory=@(); closeOnBlur=$false; openOnStartup=$false; sync=$null; voiceInput=@{enabled=$false}; island=@{enabled=$false}; theme='dark' }
        foreach($key in $values.Keys) { $tempConfig | Add-Member -NotePropertyName $key -NotePropertyValue $values[$key] -Force }
    }
    $json = $tempConfig | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($tempConfigPath, $json, [System.Text.UTF8Encoding]::new($false))
}
$windowState = Join-Path $sourceRoot 'window-state.json'
if (Test-Path $windowState) { Copy-Item -LiteralPath $windowState -Destination (Join-Path $targetRoot 'window-state.json') -Force }
$iconSource = Join-Path $sourceRoot 'shortcut\icons'
if (Test-Path $iconSource) { Copy-Item -Path (Join-Path $iconSource '*') -Destination $targetIcons -Recurse -Force }

try {
    $env:APPDATA = $appData
    $process = Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds $ReadyWaitSeconds

    Add-Type -AssemblyName System.Drawing
    if (-not ('WebsiteCaptureWin32' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WebsiteCaptureWin32 {
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
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
    [WebsiteCaptureWin32]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
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
        if ($CropTop -gt 0 -and $CropTop -lt $height) {
            $cropRect = [System.Drawing.Rectangle]::new(0, $CropTop, $width, $height - $CropTop)
            $cropped = $bitmap.Clone($cropRect, $bitmap.PixelFormat)
            try { $cropped.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $cropped.Dispose() }
        } else { $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png) }
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    $env:APPDATA = $oldAppData
}

Get-Item -LiteralPath $Output | Select-Object FullName, Length, LastWriteTime
