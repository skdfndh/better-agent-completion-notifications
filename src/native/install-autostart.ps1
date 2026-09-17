param([string]$WorkspacePath)

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

$taskName = 'CodexTaskReminderWatchdog'
$watchdogScript = Join-Path $PSScriptRoot 'reminder-watchdog.ps1'
$arguments = "-NoProfile -WindowStyle Hidden -File `"$watchdogScript`" -WorkspacePath `"$WorkspacePath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description '随 Codex 启停的本地任务提醒守护器' -Force | Out-Null
Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden
