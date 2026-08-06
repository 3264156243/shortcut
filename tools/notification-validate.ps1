param(
  [switch]$Watch
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Runtime
$null = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]

function Wait-WinRtTask {
  param(
    [object]$Operation,
    [type]$ResultType
  )
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.IsGenericMethod -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } |
    Select-Object -First 1
  $generic = $method.MakeGenericMethod($ResultType)
  $task = $generic.Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

function Read-Notifications {
  $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  $access = Wait-WinRtTask $listener.RequestAccessAsync() ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])
  if ($access.ToString() -ne "Allowed") {
    return [pscustomobject]@{
      timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      access = $access.ToString()
      count = 0
      notifications = @()
    }
  }

  $kinds = [Windows.UI.Notifications.NotificationKinds]::Toast
  $operation = $listener.GetNotificationsAsync($kinds)
  $notifications = Wait-WinRtTask $operation ([Windows.Foundation.Collections.IVectorView[Windows.UI.Notifications.Management.UserNotification]])
  $rows = @()
  foreach ($notification in $notifications) {
    $row = [ordered]@{
      id = $notification.Id
      app = $null
      appId = $null
      title = $null
      body = $null
      arrivedAt = $notification.CreationTime.ToString("o")
    }
    try {
      $row.app = $notification.AppInfo.DisplayName
      $row.appId = $notification.AppInfo.AppUserModelId
    } catch {}
    try {
      $binding = $notification.Notification.Visual.GetBinding([Windows.UI.Notifications.NotificationBindingType]::ToastGeneric)
      if ($binding) {
        $texts = $binding.GetTextElements()
        if ($texts.Count -gt 0) { $row.title = $texts[0].Text }
        if ($texts.Count -gt 1) { $row.body = $texts[1].Text }
      }
    } catch {}
    $rows += [pscustomobject]$row
  }
  return [pscustomobject]@{
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    access = $access.ToString()
    count = $rows.Count
    notifications = $rows
  }
}

if ($Watch) {
  while ($true) {
    Read-Notifications | ConvertTo-Json -Compress -Depth 5
    Start-Sleep -Seconds 2
  }
} else {
  Read-Notifications | ConvertTo-Json -Compress -Depth 5
}
