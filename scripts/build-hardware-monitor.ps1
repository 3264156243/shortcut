$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "tools\hardware-monitor\HardwareMonitorBridge.cs"
$outputDir = Join-Path $root "resources\hardware-monitor"
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$library = Join-Path $outputDir "LibreHardwareMonitorLib.dll"
$output = Join-Path $outputDir "ShortCut.HardwareMonitor.exe"

foreach ($required in @($compiler, $source, $library)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Hardware monitor build dependency is missing: $required"
  }
}

& $compiler /nologo /optimize+ /target:exe /out:$output /reference:$library /reference:System.Management.dll /reference:System.Web.Extensions.dll $source
if ($LASTEXITCODE -ne 0) {
  throw "Hardware monitor bridge compilation failed."
}

Write-Host "Built $output"
