# 语音输入全局注入桥（常驻）
# stdin 行协议：
#   T|<base64>   SendInput 直接输入 Unicode 文本到焦点控件（不碰剪贴板）
#   B|<n>        退格删除 n 个字符
#   E            发送回车
#   ARM          安装全局键盘钩子（空格=开关识别、回车=确认，消费按键并上报）
#   DISARM       卸载键盘钩子
#   F            查询前台焦点控件是否可输入（输出 FOCUS|1/0|<类名>）
#   Q            退出
# stdout：
#   EVENT|SPACE  用户按了空格（已消费）
#   EVENT|ENTER  用户按了回车（已消费）
#   READY|HOOK   键盘钩子已安装
#   FOCUS|1|Edit  焦点检测结果
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$csharp = @'
using System;
using System.Threading;
using System.Runtime.InteropServices;
using System.Text;

public static class TextSender {
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion u; }
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint KEYEVENTF_KEYUP = 0x0002;

    static void KeyInput(ushort vk, ushort scan, uint flags) {
        INPUT[] inp = new INPUT[1];
        inp[0].type = INPUT_KEYBOARD;
        inp[0].u.ki.wVk = vk;
        inp[0].u.ki.wScan = scan;
        inp[0].u.ki.dwFlags = flags;
        inp[0].u.ki.time = 0;
        inp[0].u.ki.dwExtraInfo = IntPtr.Zero;
        SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void TypeText(string text) {
        foreach (char ch in text) {
            KeyInput(0, (ushort)ch, KEYEVENTF_UNICODE);
            KeyInput(0, (ushort)ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
            Thread.Sleep(4);
        }
    }
    public static void Backspace(int n) {
        if (n < 0) return;
        if (n > 5000) n = 5000;
        for (int i = 0; i < n; i++) {
            KeyInput(0x08, 0, 0);
            KeyInput(0x08, 0, KEYEVENTF_KEYUP);
            Thread.Sleep(4);
        }
    }
    public static void Enter() {
        KeyInput(0x0D, 0, 0);
        KeyInput(0x0D, 0, KEYEVENTF_KEYUP);
    }
}

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
    public static bool Installed { get { return hHook != IntPtr.Zero; } }
    public static void Install() {
        if (hHook != IntPtr.Zero) return;
        proc = new HookProc(Callback);
        IntPtr hMod = IntPtr.Zero;
        try {
            using (var cur = System.Diagnostics.Process.GetCurrentProcess())
            using (var mod = cur.MainModule) { hMod = GetModuleHandle(mod.ModuleName); }
        } catch { }
        hHook = SetWindowsHookExW(13, proc, hMod, 0);
        if (hHook != IntPtr.Zero) {
            pump = new Thread(Loop);
            pump.IsBackground = true;
            pump.Start();
        }
    }
    public static void Uninstall() {
        if (hHook != IntPtr.Zero) { UnhookWindowsHookEx(hHook); hHook = IntPtr.Zero; }
    }
    static void Loop() {
        MSG msg = new MSG();
        while (GetMessageW(ref msg, IntPtr.Zero, 0, 0)) { }
    }
    static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && wParam == (IntPtr)0x100) {
            KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if (k.vkCode == 0x20 || k.vkCode == 0x0D) {
                try { KeyPressed((int)k.vkCode); } catch { }
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(hHook, nCode, wParam, lParam);
    }
}

public static class FocusCheck {
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")]
    static extern bool GetGUIThreadInfo(uint idThread, out GUITHREADINFO lpgui);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO { public int cbSize; public uint flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret; }
    public static bool IsEditableFocus(out string className) {
        className = "";
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;
        uint pid;
        uint tid = GetWindowThreadProcessId(fg, out pid);
        GUITHREADINFO info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        if (!GetGUIThreadInfo(tid, out info)) return false;
        IntPtr focus = info.hwndFocus;
        if (focus == IntPtr.Zero) return false;
        StringBuilder sb = new StringBuilder(256);
        GetClassNameW(focus, sb, 256);
        className = sb.ToString();
        if (System.Text.RegularExpressions.Regex.IsMatch(className, @"Edit|RichEdit|RICHEDIT|Chrome_WidgetWin|DirectUIHWND|WindowsForms10|ConsoleWindowClass|Notepad|ModernApp|WndClass", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return true;
        if (System.Text.RegularExpressions.Regex.IsMatch(className, @"Progman|WorkerW|CabinetWClass|SysListView32|SysTreeView32|Shell_TrayWnd|MSTaskListWClass|Static|Button", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return false;
        return false;
    }
}
'@
Add-Type -TypeDefinition $csharp

$action = [Action[int]]{
    param($vk)
    if ($vk -eq 0x20) { [Console]::Out.WriteLine('EVENT|SPACE') }
    elseif ($vk -eq 0x0D) { [Console]::Out.WriteLine('EVENT|ENTER') }
    [Console]::Out.Flush()
}
[KbHook]::add_KeyPressed($action)

:bridge while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break bridge }
    if ($line.Length -eq 0) { continue }
    $cmd = $line.Substring(0, 1).ToUpperInvariant()
    $arg = if ($line.Length -gt 2) { $line.Substring(2) } else { '' }
    switch ($cmd) {
        'T' {
            $text = ''
            try { $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg)) } catch { $text = $arg }
            if ($text.Length -gt 0) { [TextSender]::TypeText($text) }
            break
        }
        'B' {
            $n = 0
            [void][int]::TryParse($arg, [ref]$n)
            if ($n -gt 0) { [TextSender]::Backspace($n) }
            break
        }
        'E' { [TextSender]::Enter(); break }
        'A' {
            [KbHook]::Install()
            if ([KbHook]::Installed) { [Console]::Out.WriteLine('READY|HOOK'); [Console]::Out.Flush() }
            else { [Console]::Out.WriteLine('ERR|HOOK_INSTALL_FAILED'); [Console]::Out.Flush() }
            break
        }
        'D' { [KbHook]::Uninstall(); break }
        'F' {
            $cls = ''
            $ok = [FocusCheck]::IsEditableFocus([ref]$cls)
            [Console]::Out.WriteLine('FOCUS|' + $(if ($ok) { '1' } else { '0' }) + '|' + $cls)
            [Console]::Out.Flush()
            break
        }
        'Q' { [KbHook]::Uninstall(); break bridge }
    }
}
