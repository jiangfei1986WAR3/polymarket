param(
  [int]$IntervalMs = 60000,
  [switch]$Execute,
  [switch]$NoCommitState,
  [int]$StopWaitMs = 15000,
  [string]$EnvScript = "",
  [string]$ConfigFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "daemon-common.ps1")

Import-DaemonEnv -EnvScript $EnvScript

$args = @(
  "run", "daemon-service", "--",
  "restart",
  "--interval-ms", "$IntervalMs",
  "--stop-wait-ms", "$StopWaitMs"
)
$selectedConfigFile = $ConfigFile
if ([string]::IsNullOrWhiteSpace($selectedConfigFile)) {
  $defaultConfigFile = Get-DefaultAppConfigPath
  if (Test-Path -LiteralPath $defaultConfigFile) {
    $selectedConfigFile = $defaultConfigFile
  }
}
if (-not [string]::IsNullOrWhiteSpace($selectedConfigFile)) {
  $args += "--config"
  $args += $selectedConfigFile
}
if ($Execute) {
  $args += "--execute"
}
if ($NoCommitState) {
  $args += "--no-commit-state"
}

Invoke-NpmInExecutor -Arguments $args
