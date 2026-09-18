param(
  [string]$WorkspacePath = $env:CODEX_TASK_REMINDER_WORKSPACE,
  [string]$WatchdogScript = (Join-Path $PSScriptRoot 'reminder-watchdog.ps1'),
  [int]$RestartDelaySeconds = 2
)

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

$watchdogArguments = "-NoProfile -WindowStyle Hidden -File `"$WatchdogScript`" -WorkspacePath `"$WorkspacePath`""

function Get-ManagedProcess {
  param([string]$ScriptPath)

  $scriptPattern = '(?i)-File\s+(?:"?' + [Regex]::Escape($ScriptPath) + '"?)(?:\s|$)'
  $managedProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $scriptPattern })
  foreach ($managedProcess in $managedProcesses) {
    $process = Get-Process -Id $managedProcess.ProcessId -ErrorAction SilentlyContinue
    if ($process -and -not $process.HasExited) {
      return $process
    }
  }
  return $null
}

if ($MyInvocation.InvocationName -eq '.' -or $env:TEST_REMINDER_SUPERVISOR_NO_RUN) {
  return
}

while ($true) {
  $watchdogProcess = Get-ManagedProcess -ScriptPath $WatchdogScript
  if (-not $watchdogProcess) {
    $watchdogProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $watchdogArguments -PassThru -WindowStyle Hidden
  }
  $watchdogProcess.WaitForExit()
  Start-Sleep -Seconds $RestartDelaySeconds
}
