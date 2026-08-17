# 语音输入全局注入桥（常驻）
# stdin 行协议：
#   T|<base64>    粘贴文本到当前焦点输入框（剪贴板+Ctrl+V）
#   B|<n>         退格删除 n 个字符
#   E             发送回车
#   R             恢复剪贴板
#   ARM           安装全局键盘钩子（空格=开关识别、回车=确认，消费按键并上报）
#   DISARM        卸载键盘钩子
#   Q             退出
# stdout 事件：
#   EVENT|SPACE   用户按了空格（已消费）
#   EVENT|ENTER   用户按了回车（已消费）
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms

$hookSource = @'
using System;
using System.Threading;
using System.Runtime.InteropServices;
public static class KbHook {
    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookExW(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern bool GetMessageW(ref MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    static extern IntPtr GetModuleHandle(string lpModuleName);
    [StructLayout(LayoutKind.Sequential)]
    public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int ptX; public int ptY; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
    static IntPtr hHook = IntPtr.Zero;
    static HookProc proc;
    static Thread pump;
    public static event Action<int> KeyPressed;
    public static void Install() {
        if (hHook != IntPtr.Zero) return;
        proc = new HookProc(Callback);
        IntPtr hMod = IntPtr.Zero;
        try {
            using (var cur = System.Diagnostics.Process.GetCurrentProcess())
            using (var mod = cur.MainModule) { hMod = GetModuleHandle(mod.ModuleName); }
        } catch { }
        hHook = SetWindowsHookExW(13, proc, hMod, 0);
        pump = new Thread(Loop);
        pump.IsBackground = true;
        pump.Start();
    }
    public static void Uninstall() {
        if (hHook != IntPtr.Zero) { UnhookWindowsHookEx(hHook); hHook = IntPtr.Zero; }
    }
    static void Loop() {
        MSG msg;
        while (GetMessageW(ref msg, IntPtr.Zero, 0, 0)) { }
    }
    static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && wParam == (IntPtr)0x100) {
            KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if (k.vkCode == 0x20 || k.vkCode == 0x0D) {
                try { KeyPressed((int)k.vkCode); } catch { }
                return (IntPtr)1; // 消费按键
            }
        }
        return CallNextHookEx(hHook, nCode, wParam, lParam);
    }
}
'@
Add-Type -TypeDefinition $hookSource

$action = [Action[int]]{
    param($vk)
    if ($vk -eq 0x20) { [Console]::Out.WriteLine('EVENT|SPACE') }
    elseif ($vk -eq 0x0D) { [Console]::Out.WriteLine('EVENT|ENTER') }
    [Console]::Out.Flush()
}
[KbHook]::add_KeyPressed($action)

function Set-ClipText {
    param([string]$Text)
    [System.Windows.Forms.Clipboard]::SetDataObject($Text, $true)
    Start-Sleep -Milliseconds 60
}

function Send-Keys {
    param([string]$Keys)
    try {
        [System.Windows.Forms.SendKeys]::SendWait($Keys)
    } catch {
        Start-Sleep -Milliseconds 100
        try { [System.Windows.Forms.SendKeys]::SendWait($Keys) } catch {}
    }
    Start-Sleep -Milliseconds 30
}

$savedClipboard = $null
try { $savedClipboard = [System.Windows.Forms.Clipboard]::GetText() } catch {}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Length -eq 0) { continue }
    $cmd = $line.Substring(0, 1).ToUpperInvariant()
    $arg = $line.Substring(2)
    switch ($cmd) {
        'T' {
            $text = ''
            try { $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg)) } catch { $text = $arg }
            if ($text.Length -eq 0) { break }
            Set-ClipText $text
            Send-Keys '^v'
            break
        }
        'B' {
            $n = 0
            [void][int]::TryParse($arg, [ref]$n)
            if ($n -gt 0 -and $n -le 5000) { Send-Keys ('{BS ' + $n + '}') }
            break
        }
        'E' { Send-Keys '{ENTER}'; break }
        'R' {
            if ($null -ne $savedClipboard) { Set-ClipText $savedClipboard }
            break
        }
        'A' { [KbHook]::Install(); break }
        'D' { [KbHook]::Uninstall(); break }
        'Q' { [KbHook]::Uninstall(); break }
    }
}
