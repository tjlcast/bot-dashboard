param(
  [string]$ApiUrl = "http://localhost:3000/v1",
  [int]$DelaySeconds = 1
)

$ErrorActionPreference = "Stop"
$clientRoot = Split-Path -Parent $PSScriptRoot
$tsx = Join-Path $clientRoot "node_modules\.bin\tsx.cmd"
if (!(Test-Path $tsx)) { throw "Install dependencies first: npm install" }
$env:ACP_API_URL = $ApiUrl

function Invoke-Reporter {
  param([string[]]$CliArgs)
  $entryPoint = Join-Path $clientRoot "src\index.ts"
  $raw = & $tsx $entryPoint $CliArgs
  if ($LASTEXITCODE -ne 0) { throw "CLI report failed" }
  return $raw | ConvertFrom-Json
}
function Wait-NextReport { Start-Sleep -Seconds $DelaySeconds }

Write-Host "Pairing simulated agent..."
$pair = Invoke-Reporter @("pair", "--name", "Simulated-Codex-Agent")
$env:ACP_DEVICE_TOKEN = $pair.token
$common = @("--app", "codex", "--session", "simulated-session-001", "--trace", "platform-v1-validation", "--trace-title", "Platform V1 validation")

Write-Host "Reporting 1/5: checkpoint"
$root = Invoke-Reporter (@("report") + $common + @("--type", "checkpoint", "--title", "Start platform V1 validation", "--detail", "Agent connected and starts the validation workflow.", "--conclusion", "Check the workbench and report chain."))
Wait-NextReport
Write-Host "Reporting 2/5: report"
$analysis = Invoke-Reporter (@("report") + $common + @("--parent", $root.nodeId, "--type", "report", "--title", "API connectivity verified", "--detail", "Pairing, authentication, and report API succeeded.", "--input", "Verify device pairing and POST reports.", "--conclusion", "Continue to validate DAG branching."))
Wait-NextReport
Write-Host "Reporting 3/5: report branch"
$ui = Invoke-Reporter (@("report") + $common + @("--parent", $analysis.nodeId, "--type", "report", "--title", "Workbench display checked", "--detail", "The trace list and canvas display this report.", "--conclusion", "Canvas expands nodes by parent."))
Wait-NextReport
Write-Host "Reporting 4/5: blocked branch"
$null = Invoke-Reporter (@("report") + $common + @("--parent", $analysis.nodeId, "--type", "blocked", "--title", "Confirm validation result", "--detail", "Please decide whether to mark the simulated workflow complete.", "--input", "Check the blocked item in Inbox.", "--conclusion", "Waiting for human input."))
Wait-NextReport
Write-Host "Reporting 5/5: decision"
$done = Invoke-Reporter (@("report") + $common + @("--parent", $ui.nodeId, "--type", "decision", "--title", "Automated validation conclusion", "--detail", "The main chain completed and a blocked branch remains.", "--conclusion", "The platform receives sequential Agent reports and renders a DAG."))
Write-Host "Simulation complete. Trace: $($done.traceId)"
