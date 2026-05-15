param(
  [string]$TaskName = "PolymarketTsExecutorDaemon",
  [int]$IntervalMs = 60000,
  [switch]$Execute,
  [switch]$NoCommitState,
  [string]$EnvScript = "",
  [string]$ConfigFile = "",
  [switch]$RunAtStartup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "daemon-common.ps1")

$executorRoot = Get-ExecutorRoot
$startScript = Join-Path $executorRoot "scripts\windows\start-daemon.ps1"
$selectedEnvScript = $EnvScript
if ([string]::IsNullOrWhiteSpace($selectedEnvScript)) {
  $selectedEnvScript = Get-DefaultEnvScriptPath
}
$selectedConfigFile = $ConfigFile
if ([string]::IsNullOrWhiteSpace($selectedConfigFile)) {
  $defaultConfigFile = Get-DefaultAppConfigPath
  if (Test-Path -LiteralPath $defaultConfigFile) {
    $selectedConfigFile = $defaultConfigFile
  }
}

$commandParts = @(
  "-NoProfile"
  "-ExecutionPolicy"
  "Bypass"
  "-File"
  ('"{0}"' -f $startScript)
  "-IntervalMs"
  "$IntervalMs"
)

if ($Execute) {
  $commandParts += "-Execute"
}
if ($NoCommitState) {
  $commandParts += "-NoCommitState"
}
if (-not [string]::IsNullOrWhiteSpace($selectedEnvScript) -and (Test-Path -LiteralPath $selectedEnvScript)) {
  $commandParts += "-EnvScript"
  $commandParts += ('"{0}"' -f $selectedEnvScript)
}
if (-not [string]::IsNullOrWhiteSpace($selectedConfigFile) -and (Test-Path -LiteralPath $selectedConfigFile)) {
  $commandParts += "-ConfigFile"
  $commandParts += ('"{0}"' -f $selectedConfigFile)
}

$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument ($commandParts -join " ")
$trigger = if ($RunAtStartup) {
  New-ScheduledTaskTrigger -AtStartup
} else {
  New-ScheduledTaskTrigger -AtLogOn
}

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Output (ConvertTo-Json @{
  mode = "scheduled_task_installed"
  taskName = $TaskName
  executorRoot = $executorRoot
  intervalMs = $IntervalMs
  execute = [bool]$Execute
  noCommitState = [bool]$NoCommitState
  envScript = $selectedEnvScript
  configFile = $selectedConfigFile
  trigger = if ($RunAtStartup) { "startup" } else { "logon" }
} -Depth 4)
