// 对照验证：复刻 electron/main.ts getMachineCode 的机器码生成，输出与 Rust 版对比
const { execSync } = require('child_process');
const os = require('os');
const nodeCrypto = require('crypto');

const MACHINE_FINGERPRINT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$props = [ordered]@{}
function Get-Value($obj, $name) {
  try { $v = $obj.$name } catch { return '' }
  if ($null -eq $v) { return '' }
  return ([string]$v).Trim()
}
function Add-Prop($key, $value) {
  $s = [string]$value
  $props[$key] = $s.Trim()
}
$cs = Get-CimInstance Win32_ComputerSystemProduct
if ($cs) {
  Add-Prop 'systemUuid' (Get-Value $cs 'UUID')
  Add-Prop 'systemSerial' (Get-Value $cs 'IdentifyingNumber')
}
$bb = Get-CimInstance Win32_BaseBoard
if ($bb) {
  Add-Prop 'baseboardSerial' (Get-Value $bb 'SerialNumber')
  Add-Prop 'baseboardProduct' (Get-Value $bb 'Product')
}
$bios = Get-CimInstance Win32_BIOS
if ($bios) { Add-Prop 'biosSerial' (Get-Value $bios 'SerialNumber') }
$cpu = Get-CimInstance Win32_Processor
if ($cpu) {
  Add-Prop 'cpuId' (Get-Value $cpu 'ProcessorId')
  Add-Prop 'cpuModel' (Get-Value $cpu 'Name')
}
$disk = Get-CimInstance Win32_DiskDrive | Sort-Object Index | Select-Object -First 1
if ($disk) {
  Add-Prop 'diskSerial' (Get-Value $disk 'SerialNumber')
  Add-Prop 'diskModel' (Get-Value $disk 'Model')
}
$guid = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid
if ($guid) { Add-Prop 'machineGuid' $guid.MachineGuid }
$adapterMacs = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.MacAddress -and $_.MacAddress -ne '00-00-00-00-00-00' } | Select-Object -ExpandProperty MacAddress | ForEach-Object { ($_ -replace '[-:]','').ToUpper() })
$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress)
$props['adapterMacs'] = @($adapterMacs)
$props['lanIps'] = @($lanIps)
$props['hostname'] = $env:COMPUTERNAME
$props['platform'] = $env:PROCESSOR_ARCHITECTURE
$result = [ordered]@{ success = $true; fields = $props; collectedAt = (Get-Date).ToString('o') }
$result | ConvertTo-Json -Compress -Depth 4
`;

async function main() {
  const out = execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${MACHINE_FINGERPRINT_SCRIPT.replace(/"/g, '\\"')}"`, { encoding: 'utf8', windowsHide: true });
  const payload = JSON.parse(out.trim().split(/\r?\n/)[0]);
  const fields = payload.success && payload.fields ? payload.fields : null;

  // node os 网卡（与 getMachineProfile 相同合并逻辑）
  const nodeMacs = [];
  const nodeLanIps = [];
  const interfaces = os.networkInterfaces();
  for (const key of Object.keys(interfaces)) {
    for (const item of interfaces[key] || []) {
      if (item.internal) continue;
      if (item.mac && item.mac !== '00:00:00:00:00:00') nodeMacs.push(item.mac.replace(/[-:]/g, '').toUpperCase());
      if (item.family === 'IPv4' && item.address && item.address !== '127.0.0.1' && !item.address.startsWith('169.254.')) nodeLanIps.push(item.address);
    }
  }
  const lanIps = Array.from(new Set([...(fields?.lanIps || []), ...nodeLanIps])).filter(Boolean);
  const macs = Array.from(new Set([...(fields?.adapterMacs || []), ...nodeMacs])).filter(Boolean);

  const stableKeys = ['systemUuid','systemSerial','baseboardSerial','baseboardProduct','biosSerial','cpuId','cpuModel','diskSerial','diskModel','machineGuid'];
  const parts = stableKeys.map((key) => `${key}=${String(fields?.[key] || '').trim().toUpperCase()}`);
  parts.push(`macs=${macs.map((mac) => mac.replace(/[-:]/g, '')).sort().join(',')}`);
  const source = parts.sort().join('|');
  const code = nodeCrypto.createHash('sha256').update(source).digest('hex').slice(0, 32).toUpperCase();
  console.log(JSON.stringify({ electronCode: code, macs, sourceLen: source.length }, null, 2));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
