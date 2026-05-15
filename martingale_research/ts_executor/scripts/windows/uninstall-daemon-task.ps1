param(
  [string]$TaskName = "PolymarketTsExecutorDaemon"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Output (ConvertTo-Json @{
    mode = "scheduled_task_uninstall_skipped"
    reason = "not_found"
    taskName = $TaskName
  } -Depth 4)
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Output (ConvertTo-Json @{
  mode = "scheduled_task_uninstalled"
  taskName = $TaskName
} -Depth 4)
