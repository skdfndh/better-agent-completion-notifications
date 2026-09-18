$taskName = 'CodexTaskReminderWatchdog'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$startupPath = [Environment]::GetFolderPath('Startup')
$watchdogShortcutName = 'Codex ' + [char]0x4EFB + [char]0x52A1 + [char]0x63D0 + [char]0x9192 + [char]0x5B88 + [char]0x62A4 + [char]0x5668 + '.lnk'
$desktopHostShortcutName = 'Codex ' + [char]0x63D0 + [char]0x9192 + [char]0x684C + [char]0x9762 + [char]0x5BBF + [char]0x4E3B + '.lnk'
$watchdogShortcutPath = Join-Path $startupPath $watchdogShortcutName
if (Test-Path -LiteralPath $watchdogShortcutPath) {
  Remove-Item -LiteralPath $watchdogShortcutPath -Force
}

$desktopHostShortcutPath = Join-Path $startupPath $desktopHostShortcutName
if (Test-Path -LiteralPath $desktopHostShortcutPath) {
  Remove-Item -LiteralPath $desktopHostShortcutPath -Force
}

$desktopHostSupervisors = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*reminder-desktop-host-supervisor.ps1*' })
foreach ($desktopHostSupervisor in $desktopHostSupervisors) {
  Stop-Process -Id $desktopHostSupervisor.ProcessId -ErrorAction SilentlyContinue
}
