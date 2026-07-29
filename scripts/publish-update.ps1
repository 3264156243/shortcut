param(
  [string]$ServerHost = '43.108.21.35',
  [int]$Port = 22,
  [string]$User = 'root',
  [string]$RemoteDirectory = '/www/wwwroot/ShortCut/updates',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not $SkipBuild) {
  & npm.cmd run electron:build
  if ($LASTEXITCODE -ne 0) {
    throw 'Windows update package build failed.'
  }
}

$package = Get-Content -LiteralPath 'package.json' -Encoding UTF8 | ConvertFrom-Json
$setupName = $package.productName + '-' + $package.version + '-Setup.exe'
$releaseNotes = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'release') -Filter 'ShortCut-*-ReleaseNotes.md' -File |
  Sort-Object Name

if (-not $releaseNotes) {
  throw 'No release notes artifacts were generated.'
}

$artifacts = @(
  (Join-Path $projectRoot ('release/' + $setupName)),
  (Join-Path $projectRoot ('release/' + $setupName + '.blockmap'))
)
$artifacts += @($releaseNotes.FullName)
$artifacts += (Join-Path $projectRoot 'release/release-notes.json')
$artifacts += (Join-Path $projectRoot 'release/latest.yml')

foreach ($artifact in $artifacts) {
  if (-not (Test-Path -LiteralPath $artifact)) {
    throw 'Missing update artifact: ' + $artifact
  }
}

$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
if (-not (Test-Path -LiteralPath $scp)) {
  throw 'Windows OpenSSH scp.exe was not found.'
}

$destination = $User + '@' + $ServerHost + ':' + $RemoteDirectory + '/'
& $scp -P $Port @artifacts $destination
if ($LASTEXITCODE -ne 0) {
  throw 'Uploading update artifacts failed.'
}

Write-Host ('Uploaded version ' + $package.version + ' and ' + $releaseNotes.Count + ' release notes to ' + $destination)
Write-Host 'Verify: https://shortcut.326415.xyz/updates/latest.yml'
