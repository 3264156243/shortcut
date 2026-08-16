# 语音输入全局注入桥（常驻）
# 通过 stdin 行协议接收指令：
#   T|<base64文本>   把文本粘贴到当前焦点输入框（剪贴板+Ctrl+V，结束后恢复原剪贴板）
#   B|<n>            退格删除 n 个字符
#   E                发送回车
#   R                恢复剪贴板为会话开始时保存的内容
#   Q                退出
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Set-ClipText {
    param([string]$Text)
    $sb = [System.Text.StringBuilder]::new()
    [void][System.Windows.Forms.Clipboard]::SetDataObject($Text, $true)
    Start-Sleep -Milliseconds 60
}

function Send-Keys {
    param([string]$Keys)
    try {
        [System.Windows.Forms.SendKeys]::SendWait($Keys)
    } catch {
        # 某些控件下 SendWait 可能抛异常，重试一次
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
        'Q' { break }
    }
}
