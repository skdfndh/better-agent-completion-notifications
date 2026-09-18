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

while ($true) {
  $watchdogProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $watchdogArguments -PassThru -WindowStyle Hidden
  $watchdogProcess.WaitForExit()
  Start-Sleep -Seconds $RestartDelaySeconds
}
