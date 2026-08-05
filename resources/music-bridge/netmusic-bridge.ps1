param(
  [string]$Control = "",
  [long]$Seek = -1,
  [int]$IntervalMs = 1000
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime]

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MediaKeyBridge {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

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

function Get-NetEaseSession {
  try {
    $manager = Wait-WinRtTask ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $sessions = @($manager.GetSessions())
    foreach ($session in $sessions) {
      try {
        $appId = $session.SourceAppUserModelId
        if ($appId -match "cloudmusic|netease") {
          return $session
        }
      } catch { }
    }
  } catch { }
  return $null
}

function ConvertTo-NetEaseCoverUrl {
  param([string]$PicId, [int]$Size = 500)
  $magic = "3go8&`$8*3*3h0k(2)2"
  $magicBytes = [System.Text.Encoding]::UTF8.GetBytes($magic)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($PicId)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = $bytes[$i] -bxor $magicBytes[$i % $magicBytes.Length]
  }
  $md5 = [System.Security.Cryptography.MD5]::Create()
  $digest = $md5.ComputeHash($bytes)
  $enc = [Convert]::ToBase64String($digest).Replace("/", "_").Replace("+", "-")
  return "https://p1.music.126.net/$enc/$PicId.jpg`?param=${Size}y${Size}"
}

function Get-NetEaseLyrics {
  param([string]$Title, [string]$Artist)
  $empty = @{ songId = $null; lyrics = $null; coverUrl = $null; source = $null }
  try {
    if (-not $Title) { return $empty }
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
    if (-not $song) { return $empty }
    $lyric = Invoke-RestMethod -Method Get -Uri "https://music.163.com/api/song/lyric?id=$($song.id)&lv=-1&kv=-1&tv=-1" -Headers @{ Referer = "https://music.163.com"; "User-Agent" = $ua } -TimeoutSec 8
    $coverUrl = $null
    if ($song.album.picId) {
      $coverUrl = ConvertTo-NetEaseCoverUrl -PicId ([string]$song.album.picId) -Size 500
    }
    return @{
      songId = $song.id
      lyrics = $lyric.lrc.lyric
      coverUrl = $coverUrl
      source = "netease"
    }
  } catch {
    return $empty
  }
}

function Read-SessionState {
  param($Session)
  $item = [ordered]@{
    available = $true
    title = $null
    artist = $null
    album = $null
    songId = $null
    lyrics = $null
    coverUrl = $null
    isPlaying = $false
    positionMs = 0
    durationMs = 0
  }
  try {
    $media = Wait-WinRtTask $Session.TryGetMediaPropertiesAsync() ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $item.title = $media.Title
    $item.artist = $media.Artist
    $item.album = $media.AlbumTitle
  } catch { }
  try {
    $playback = $Session.GetPlaybackInfo()
    $item.isPlaying = ($playback.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
  } catch { }
  try {
    $timeline = $Session.GetTimelineProperties()
    $item.positionMs = [long]($timeline.Position.Ticks / 10000)
    $item.durationMs = [long]($timeline.EndTime.Ticks / 10000)
  } catch { }
  return $item
}

function Send-MediaKey {
  param([byte]$Vk)
  [MediaKeyBridge]::keybd_event($Vk, 0, 0, [UIntPtr]::Zero)
  [MediaKeyBridge]::keybd_event($Vk, 0, 2, [UIntPtr]::Zero)
}

function Invoke-Control {
  param([string]$Action)
  switch ($Action.ToLowerInvariant()) {
    "next" { Send-MediaKey 0xB0; break }
    "prev" { Send-MediaKey 0xB1; break }
    "previous" { Send-MediaKey 0xB1; break }
    "toggle" { Send-MediaKey 0xB3; break }
    "playpause" { Send-MediaKey 0xB3; break }
    default { return @{ action = $Action; result = "unknown control: $Action" } }
  }
  return @{ action = $Action; result = "ok" }
}

function Invoke-Seek {
  param([long]$PositionMs)
  $session = Get-NetEaseSession
  if (-not $session) {
    return @{ action = "seek"; result = "no-session"; positionMs = $PositionMs }
  }
  try {
    $ok = Wait-WinRtTask $session.TryChangePlaybackPositionAsync($PositionMs) ([bool])
    $result = "unsupported"
    if ($ok) { $result = "ok" }
    return @{ action = "seek"; result = $result; positionMs = $PositionMs }
  } catch {
    return @{ action = "seek"; result = "unsupported"; positionMs = $PositionMs }
  }
}

if ($Control) {
  Invoke-Control $Control | ConvertTo-Json -Compress
  exit 0
}

if ($Seek -ge 0) {
  Invoke-Seek $Seek | ConvertTo-Json -Compress
  exit 0
}

$lastSongKey = ""
$lastLyrics = $null
$lastLyricsAt = [long]0

while ($true) {
  $state = $null
  $session = Get-NetEaseSession
  if ($session) {
    $state = Read-SessionState $session
  } else {
    $state = [ordered]@{
      available = $false
      title = $null
      artist = $null
      album = $null
      songId = $null
      lyrics = $null
      coverUrl = $null
      isPlaying = $false
      positionMs = 0
      durationMs = 0
    }
  }

  if ($state.available -and $state.title) {
    $key = "$($state.title)|$($state.artist)"
    $now = [Environment]::TickCount64
    $lyricsStale = ($null -eq $lastLyrics) -or ($key -ne $lastSongKey) -or (($now - $lastLyricsAt) -gt 60000)
    if ($lyricsStale) {
      $lastLyrics = Get-NetEaseLyrics -Title $state.title -Artist $state.artist
      $lastSongKey = $key
      $lastLyricsAt = $now
    }
    $state.songId = $lastLyrics.songId
    $state.lyrics = $lastLyrics.lyrics
    $state.coverUrl = $lastLyrics.coverUrl
  }

  [pscustomobject]$state | ConvertTo-Json -Compress
  Start-Sleep -Milliseconds $IntervalMs
}
