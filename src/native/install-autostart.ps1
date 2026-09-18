param(
  [string]$WorkspacePath,
  [string]$TaskName = 'CodexTaskReminderWatchdog',
  [string]$DesktopPath,
  [string]$StartupPath,
  [switch]$SkipShortcuts,
  [switch]$SkipStart
)

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

$supervisorScript = Join-Path $PSScriptRoot 'reminder-supervisor.ps1'
$desktopHostSupervisorScript = Join-Path $PSScriptRoot 'reminder-desktop-host-supervisor.ps1'
$appDataPath = $env:APPDATA
$openWorkbenchScript = Join-Path $PSScriptRoot 'open-workbench.ps1'
$watchdogShortcutName = 'Codex ' + [char]0x4EFB + [char]0x52A1 + [char]0x63D0 + [char]0x9192 + [char]0x5B88 + [char]0x62A4 + [char]0x5668 + '.lnk'
$desktopHostShortcutName = 'Codex ' + [char]0x63D0 + [char]0x9192 + [char]0x684C + [char]0x9762 + [char]0x5BBF + [char]0x4E3B + '.lnk'
$workbenchShortcutName = 'Codex ' + [char]0x63D0 + [char]0x9192 + [char]0x5DE5 + [char]0x4F5C + [char]0x53F0 + '.lnk'
$arguments = "-NoProfile -WindowStyle Hidden -File `"$supervisorScript`" -WorkspacePath `"$WorkspacePath`" -AppDataPath `"$appDataPath`" -DisableNativeHost"
$desktopHostArguments = "-NoProfile -WindowStyle Hidden -File `"$desktopHostSupervisorScript`" -WorkspacePath `"$WorkspacePath`" -AppDataPath `"$appDataPath`""
$scheduledTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($scheduledTask) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigger, $recoveryTrigger) -Settings $settings -Principal $principal -Description 'Starts and restarts the Codex task reminder watchdog for the current user.' -Force | Out-Null

if (-not $SkipShortcuts) {
  if (-not $DesktopPath) {
    $DesktopPath = [Environment]::GetFolderPath('Desktop')
  }
  if (-not $StartupPath) {
    $StartupPath = [Environment]::GetFolderPath('Startup')
  }
  $shell = New-Object -ComObject WScript.Shell
  $watchdogShortcutPath = Join-Path $StartupPath $watchdogShortcutName
  if (Test-Path -LiteralPath $watchdogShortcutPath) {
    Remove-Item -LiteralPath $watchdogShortcutPath -Force
  }

  $desktopHostShortcutPath = Join-Path $StartupPath $desktopHostShortcutName
  $desktopHostShortcut = $shell.CreateShortcut($desktopHostShortcutPath)
  $desktopHostShortcut.TargetPath = 'powershell.exe'
  $desktopHostShortcut.Arguments = $desktopHostArguments
  $desktopHostShortcut.WorkingDirectory = Split-Path -Parent $desktopHostSupervisorScript
  $desktopHostShortcut.Save()

  $shortcutPath = Join-Path $DesktopPath $workbenchShortcutName
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = 'powershell.exe'
  $shortcut.Arguments = "-NoProfile -File `"$openWorkbenchScript`" -WorkspacePath `"$WorkspacePath`""
  $shortcut.WorkingDirectory = Split-Path -Parent $openWorkbenchScript
  $shortcut.Save()
}

if (-not $SkipStart) {
  $existingSupervisors = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*reminder-supervisor.ps1*' })
  $existingDesktopHostSupervisors = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*reminder-desktop-host-supervisor.ps1*' })
  $existingWatchdogs = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*reminder-watchdog.ps1*' })
  $existingHosts = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*reminder-host.ps1*' -or $_.CommandLine -like '*reminder-host-launcher.ps1*') })
  foreach ($reminderProcess in @($existingSupervisors + $existingDesktopHostSupervisors)) {
    Stop-Process -Id $reminderProcess.ProcessId -ErrorAction SilentlyContinue
  }
  foreach ($reminderProcess in @($existingHosts + $existingWatchdogs)) {
    Stop-Process -Id $reminderProcess.ProcessId -ErrorAction SilentlyContinue
  }
  Start-ScheduledTask -TaskName $TaskName
  Start-Process -FilePath 'powershell.exe' -ArgumentList $desktopHostArguments -WindowStyle Hidden
}
