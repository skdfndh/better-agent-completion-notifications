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
$scheduledTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($scheduledTask) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
$startupPath = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell

$watchdogShortcutPath = Join-Path $startupPath 'Codex 任务提醒守护器.lnk'
$watchdogShortcut = $shell.CreateShortcut($watchdogShortcutPath)
$watchdogShortcut.TargetPath = 'powershell.exe'
$watchdogShortcut.Arguments = $arguments
$watchdogShortcut.WorkingDirectory = Split-Path -Parent $watchdogScript
$watchdogShortcut.Save()

$watchdogRunning = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*reminder-watchdog.ps1*' }).Count -gt 0
if (-not $watchdogRunning) {
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden
}

$shortcutPath = Join-Path $desktopPath 'Codex 提醒工作台.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoProfile -File `"$openWorkbenchScript`" -WorkspacePath `"$WorkspacePath`""
$shortcut.WorkingDirectory = Split-Path -Parent $openWorkbenchScript
$shortcut.Save()
