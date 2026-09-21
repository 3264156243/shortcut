$ErrorActionPreference = 'Stop'
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SoftKeyboard {
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT {
        public int type;
        public INPUTUNION u;
    }

    const int INPUT_MOUSE = 0;
    const int INPUT_KEYBOARD = 1;

    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;

    static void SendAll(INPUT[] inputs) {
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sent != (uint)inputs.Length) {
            throw new Exception("SendInput failed: " + Marshal.GetLastWin32Error());
        }
    }

    static INPUT Key(ushort vk, ushort scan, uint flags) {
        INPUT inp = new INPUT();
        inp.type = INPUT_KEYBOARD;
        inp.u.ki.wVk = vk;
        inp.u.ki.wScan = scan;
        inp.u.ki.dwFlags = flags;
        inp.u.ki.time = 0;
        inp.u.ki.dwExtraInfo = IntPtr.Zero;
        return inp;
    }

    static INPUT Mouse(int dx, int dy, uint mouseData, uint flags) {
        INPUT inp = new INPUT();
        inp.type = INPUT_MOUSE;
        inp.u.mi.dx = dx;
        inp.u.mi.dy = dy;
        inp.u.mi.mouseData = mouseData;
        inp.u.mi.dwFlags = flags;
        inp.u.mi.time = 0;
        inp.u.mi.dwExtraInfo = IntPtr.Zero;
        return inp;
    }

    public static void TypeText(string text) {
        foreach (char c in text) {
            SendAll(new INPUT[] {
                Key(0, c, KEYEVENTF_UNICODE),
                Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
            });
        }
    }

    public static void SendVk(int vk) {
        SendAll(new INPUT[] {
            Key((ushort)vk, 0, 0),
            Key((ushort)vk, 0, KEYEVENTF_KEYUP)
        });
    }

    // vks: modifier-first then final key, e.g. 17,67 = Ctrl+C
    public static void SendCombo(int[] vks) {
        if (vks == null || vks.Length == 0) return;
        int n = vks.Length * 2;
        INPUT[] inputs = new INPUT[n];
        for (int i = 0; i < vks.Length; i++) {
            inputs[i] = Key((ushort)vks[i], 0, 0);
        }
        for (int i = 0; i < vks.Length; i++) {
            inputs[vks.Length + i] = Key((ushort)vks[vks.Length - 1 - i], 0, KEYEVENTF_KEYUP);
        }
        SendAll(inputs);
    }

    public static void MouseMove(int dx, int dy) {
        if (dx == 0 && dy == 0) return;
        SendAll(new INPUT[] { Mouse(dx, dy, 0, MOUSEEVENTF_MOVE) });
    }

    public static void MouseClick(string button) {
        uint down, up;
        switch ((button ?? "left").ToLowerInvariant()) {
            case "right":
                down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; break;
            case "middle":
                down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; break;
            default:
                down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; break;
        }
        SendAll(new INPUT[] {
            Mouse(0, 0, 0, down),
            Mouse(0, 0, 0, up)
        });
    }

    public static void MouseWheel(int delta) {
        if (delta == 0) return;
        SendAll(new INPUT[] { Mouse(0, 0, (uint)delta, MOUSEEVENTF_WHEEL) });
    }
}
'@

Write-Output "READY"

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq '') { continue }

    $idx = $line.IndexOf(' ')
    if ($idx -lt 0) {
        $cmd = $line
        $arg = ''
    } else {
        $cmd = $line.Substring(0, $idx)
        $arg = $line.Substring($idx + 1)
    }

    try {
        switch ($cmd) {
            'TYPE' {
                $bytes = [Convert]::FromBase64String($arg)
                $text  = [System.Text.Encoding]::UTF8.GetString($bytes)
                if ($text.Length -gt 0) {
                    [SoftKeyboard]::TypeText($text)
                    Write-Output "OK TYPE"
                } else {
                    Write-Output "OK EMPTY"
                }
            }
            'KEY' {
                [SoftKeyboard]::SendVk([int]$arg)
                Write-Output "OK KEY"
            }
            'COMBO' {
                $vks = @()
                foreach ($p in ($arg -split ',')) {
                    $p = $p.Trim()
                    if ($p -ne '') { $vks += [int]$p }
                }
                [SoftKeyboard]::SendCombo($vks)
                Write-Output ("OK COMBO " + ($vks -join ','))
            }
            'MOUSE' {
                $parts = $arg -split '\s+'
                $dx = [int]$parts[0]
                $dy = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
                [SoftKeyboard]::MouseMove($dx, $dy)
                Write-Output "OK MOUSE"
            }
            'CLICK' {
                [SoftKeyboard]::MouseClick($arg)
                Write-Output "OK CLICK"
            }
            'WHEEL' {
                [SoftKeyboard]::MouseWheel([int]$arg)
                Write-Output "OK WHEEL"
            }
            'PING' { Write-Output "OK PONG" }
            default { Write-Output "ERR unknown $cmd" }
        }
    } catch {
        Write-Output ("ERR " + $_.Exception.Message)
    }
}
