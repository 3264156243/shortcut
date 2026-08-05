param(
  [switch]$Watch,
  [string]$Control,
  [switch]$Lyrics
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime]

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

function Read-Session {
  param($Session)
  $item = [ordered]@{}
  try { $item.appId = $Session.SourceAppUserModelId } catch { $item.appId = $null }
  try {
    $media = Wait-WinRtTask $Session.TryGetMediaPropertiesAsync() ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $item.title = $media.Title
    $item.artist = $media.Artist
    $item.album = $media.AlbumTitle
    $item.thumbnail = $null
    $item.songId = $null
    $item.lyricsSource = $null
    $item.lyrics = $null
    if ($media.Thumbnail) {
      try {
        $stream = Wait-WinRtTask $media.Thumbnail.OpenReadAsync() ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $size = [uint32]$stream.Size
        if ($size -gt 0 -and $size -le 8388608) {
          $buffer = New-Object Windows.Storage.Streams.Buffer([uint32]$size)
          $read = Wait-WinRtTask $stream.ReadAsync($buffer, [uint32]$size, [Windows.Storage.Streams.InputStreamOptions]::None) ([Windows.Storage.Streams.IBuffer])
          $bytes = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::ToArray($read)
          $item.thumbnail = "data:image/png;base64," + [Convert]::ToBase64String($bytes)
        }
      } catch {
        $item.thumbnail = $null
      }
    }
    if ($Lyrics -and $item.title) {
      $lyricsResult = Get-NetEaseLyrics $item.title $item.artist
      $item.songId = $lyricsResult.songId
      $item.lyricsSource = $lyricsResult.source
      $item.lyrics = $lyricsResult.lyrics
    }
  } catch {
    $item.title = $null
    $item.artist = $null
    $item.album = $null
    $item.thumbnail = $null
    $item.songId = $null
    $item.lyricsSource = $null
    $item.lyrics = $null
  }
  try {
    $playback = $Session.GetPlaybackInfo()
    $item.isPlaying = ($playback.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
    $item.playbackStatus = $playback.PlaybackStatus.ToString()
  } catch {
    $item.isPlaying = $false
    $item.playbackStatus = $null
  }
  try {
    $timeline = $Session.GetTimelineProperties()
    $item.positionMs = [long]($timeline.Position.Duration / 10000)
    $item.durationMs = [long]($timeline.EndTime.Duration / 10000)
  } catch {
    $item.positionMs = 0
    $item.durationMs = 0
  }
  return $item
}

function Get-NetEaseLyrics {
  param([string]$Title, [string]$Artist)
  try {
    $ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    $query = "$Title $Artist".Trim()
    $body = @{ s = $query; type = 1; limit = 3; offset = 0 }
    $search = Invoke-RestMethod -Method Post -Uri "https://music.163.com/api/search/get/web" -Headers @{ Referer = "https://music.163.com"; "User-Agent" = $ua } -Body $body -TimeoutSec 8
    $songs = @($search.result.songs)
    $song = $songs | Where-Object {
      $_.name -and
      $_.name.IndexOf($Title, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      ($_.artists | ForEach-Object { $_.name }) -join "," -match [regex]::Escape(($Artist -split " ")[0])
    } | Select-Object -First 1
    if (-not $song) { $song = $songs | Select-Object -First 1 }
    if (-not $song) { return @{ songId = $null; source = $null; lyrics = $null } }
    $lyric = Invoke-RestMethod -Method Get -Uri "https://music.163.com/api/song/lyric?id=$($song.id)&lv=-1&kv=-1&tv=-1" -Headers @{ Referer = "https://music.163.com"; "User-Agent" = $ua } -TimeoutSec 8
    return @{ songId = $song.id; source = "netease"; lyrics = $lyric.lrc.lyric }
  } catch {
    return @{ songId = $null; source = $null; lyrics = $null }
  }
}

function Invoke-MediaControl {
  param($Session, [string]$Action)
  $result = "ok"
  try {
    switch ($Action.ToLowerInvariant()) {
      "toggle" { $null = Wait-WinRtTask $Session.TryTogglePlayPauseAsync() ([bool]); break }
      "playpause" { $null = Wait-WinRtTask $Session.TryTogglePlayPauseAsync() ([bool]); break }
      "next" { $null = Wait-WinRtTask $Session.TrySkipNextAsync() ([bool]); break }
      "prev" { $null = Wait-WinRtTask $Session.TrySkipPreviousAsync() ([bool]); break }
      "previous" { $null = Wait-WinRtTask $Session.TrySkipPreviousAsync() ([bool]); break }
      default { $result = "unknown control: $Action" }
    }
  } catch {
    $result = $_.Exception.Message
  }
  [pscustomobject]@{ action = $Action; result = $result } | ConvertTo-Json -Compress
}

try {
  $manager = Wait-WinRtTask ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $sessions = @($manager.GetSessions())
  $target = $null
  foreach ($session in $sessions) {
    try {
      $appId = $Session.SourceAppUserModelId
      if ($appId -match "cloudmusic|netease") { $target = $session; break }
    } catch { }
  }
  if (-not $target) { $target = $sessions | Select-Object -First 1 }

  if ($Control) {
    if (-not $target) { [pscustomobject]@{ error = "No media session available" } | ConvertTo-Json -Compress }
    else { Invoke-MediaControl $target $Control }
    exit 0
  }

  if ($Watch) {
    while ($true) {
      $rows = @()
      foreach ($session in $sessions) { $rows += Read-Session $session }
      [pscustomobject]@{ timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); sessionCount = $rows.Count; sessions = $rows } | ConvertTo-Json -Compress -Depth 6
      Start-Sleep -Seconds 1
    }
  } else {
    $rows = @()
    foreach ($session in $sessions) { $rows += Read-Session $session }
    [pscustomobject]@{ timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); sessionCount = $rows.Count; sessions = $rows } | ConvertTo-Json -Compress -Depth 6
  }
} catch {
  [pscustomobject]@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
