$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "tools\netmusic-bridge.ps1"
$outputDir = Join-Path $root "resources\music-bridge"
$output = Join-Path $outputDir "netmusic-bridge.ps1"

if (-not (Test-Path -LiteralPath $source)) {
  throw "Music bridge script is missing: $source"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Copy-Item -LiteralPath $source -Destination $output -Force

Write-Host "Built $output"
