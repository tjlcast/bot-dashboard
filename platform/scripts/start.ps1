param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($listener) {
  Write-Host "Service is already listening on port $Port (PID $($listener.OwningProcess))."
  exit 0
}

$env:PORT = $Port
$process = Start-Process -FilePath node.exe -ArgumentList "server/index.js" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
Write-Host "Service started (PID $($process.Id)): http://localhost:$Port"
