param(
  [string]$WorkspacePath = $env:CODEX_TASK_REMINDER_WORKSPACE
)

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

$hostScript = Join-Path $PSScriptRoot 'reminder-host.ps1'
$projectPath = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$uiServerScript = Join-Path $projectPath 'src\ui\server.js'
$preferencesPath = Join-Path $env:APPDATA 'CodexTaskReminder\preferences.json'
$hostProcess = $null
$workbenchProcess = $null

function Get-WorkbenchServiceEnabled {
  try {
    if (Test-Path -LiteralPath $preferencesPath) {
      $preferences = Get-Content -LiteralPath $preferencesPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($preferences.workbenchServiceEnabled -is [bool]) { return $preferences.workbenchServiceEnabled }
    }
  } catch { }
  return $true
}

function Start-WorkbenchService {
  $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand) { return $null }
  return Start-Process -FilePath $nodeCommand.Source -ArgumentList @('--experimental-strip-types', $uiServerScript) -WorkingDirectory $projectPath -PassThru -WindowStyle Hidden
}

function Test-WorkbenchAvailable {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3300' -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-ManagedProcess {
  param([string]$ScriptPath)

  $managedProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ScriptPath*" })
  foreach ($managedProcess in $managedProcesses) {
    $process = Get-Process -Id $managedProcess.ProcessId -ErrorAction SilentlyContinue
    if ($process -and -not $process.HasExited) {
      return $process
    }
  }
  return $null
}

if ($MyInvocation.InvocationName -eq '.' -or $env:TEST_REMINDER_WATCHDOG_NO_RUN) {
  return
}

$hostProcess = Get-ManagedProcess -ScriptPath $hostScript
$workbenchProcess = Get-ManagedProcess -ScriptPath $uiServerScript

while ($true) {
  $codexRunning = @(Get-Process -Name 'codex' -ErrorAction SilentlyContinue).Count -gt 0
  $hostRunning = $hostProcess -and -not $hostProcess.HasExited
  $workbenchRunning = $workbenchProcess -and -not $workbenchProcess.HasExited
  $workbenchEnabled = Get-WorkbenchServiceEnabled

  if ($codexRunning -and -not $hostRunning) {
    $arguments = "-NoProfile -STA -File `"$hostScript`" -WorkspacePath `"$WorkspacePath`""
    $hostProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -PassThru -WindowStyle Normal
  }

  if ($codexRunning -and $workbenchEnabled -and -not $workbenchRunning -and -not (Test-WorkbenchAvailable)) {
    $workbenchProcess = Start-WorkbenchService
  }

  if (-not $codexRunning -and $hostRunning) {
    Stop-Process -Id $hostProcess.Id -ErrorAction SilentlyContinue
    $hostProcess = $null
  }

  if ((-not $codexRunning -or -not $workbenchEnabled) -and $workbenchRunning) {
    Stop-Process -Id $workbenchProcess.Id -ErrorAction SilentlyContinue
    $workbenchProcess = $null
  }

  Start-Sleep -Seconds 2
}
