Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ExecutorRoot {
  return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
}

function Get-DefaultEnvScriptPath {
  $executorRoot = Get-ExecutorRoot
  return Join-Path $executorRoot "scripts\windows\env.local.ps1"
}

function Get-DefaultAppConfigPath {
  $executorRoot = Get-ExecutorRoot
  return Join-Path $executorRoot "app_config.json"
}

function Import-DaemonEnv {
  param(
    [string]$EnvScript
  )

  $selected = $EnvScript
  if ([string]::IsNullOrWhiteSpace($selected)) {
    $selected = Get-DefaultEnvScriptPath
  }

  if ([string]::IsNullOrWhiteSpace($selected)) {
    return
  }

  if (Test-Path -LiteralPath $selected) {
    . $selected
  }
}

function Invoke-NpmInExecutor {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $executorRoot = Get-ExecutorRoot
  Push-Location $executorRoot
  try {
    & npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm command failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}
