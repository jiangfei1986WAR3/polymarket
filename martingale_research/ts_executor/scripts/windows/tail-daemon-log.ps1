param(
  [ValidateSet("stdout", "stderr")]
  [string]$Stream = "stdout",
  [int]$Tail = 60,
  [switch]$Wait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "daemon-common.ps1")

$executorRoot = Get-ExecutorRoot
$runtimeStateDir = Join-Path $executorRoot "runtime_state"
$logFile = if ($Stream -eq "stderr") {
  Join-Path $runtimeStateDir "daemon_runner.stderr.log"
} else {
  Join-Path $runtimeStateDir "daemon_runner.stdout.log"
}

if (-not (Test-Path -LiteralPath $logFile)) {
  Write-Output (ConvertTo-Json @{
    mode = "tail_daemon_log"
    stream = $Stream
    logFile = $logFile
    exists = $false
  } -Depth 4)
  exit 0
}

Write-Output (ConvertTo-Json @{
  mode = "tail_daemon_log"
  stream = $Stream
  logFile = $logFile
  exists = $true
  wait = [bool]$Wait
  tail = $Tail
} -Depth 4)

if ($Wait) {
  Get-Content -LiteralPath $logFile -Tail $Tail -Wait
} else {
  Get-Content -LiteralPath $logFile -Tail $Tail
}
