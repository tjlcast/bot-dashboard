param(
  [string]$ProcessName = "node"
)

$ErrorActionPreference = "Stop"
$executableName = if ($ProcessName.EndsWith(".exe")) { $ProcessName } else { "$ProcessName.exe" }
$processes = Get-CimInstance Win32_Process -Filter "Name = '$executableName'" -ErrorAction SilentlyContinue
$processes = $processes | Where-Object { $_.CommandLine -match 'server[\\/]index\.js' }

if (@($processes).Count -eq 0) {
  Write-Host "No platform service process found: $ProcessName"
  exit 0
}

$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Stopped $(@($processes).Count) platform service process(es): $ProcessName"
