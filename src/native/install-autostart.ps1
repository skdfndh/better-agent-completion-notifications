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
$openWorkbenchScript = Join-Path $PSScriptRoot 'open-workbench.ps1'
$arguments = "-NoProfile -WindowStyle Hidden -File `"$watchdogScript`" -WorkspacePath `"$WorkspacePath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description '随 Codex 启停的本地任务提醒守护器' -Force | Out-Null
$registeredTask = Get-ScheduledTask -TaskName $taskName
if ($registeredTask.State -ne 'Running') {
  Start-ScheduledTask -TaskName $taskName
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'Codex 提醒工作台.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoProfile -File `"$openWorkbenchScript`" -WorkspacePath `"$WorkspacePath`""
$shortcut.WorkingDirectory = Split-Path -Parent $openWorkbenchScript
$shortcut.Save()
