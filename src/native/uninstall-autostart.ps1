param(
  [string]$TaskName = 'CodexTaskReminderWatchdog',
  [string]$StartupPath
)

$taskName = $TaskName
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

if (-not $StartupPath) { $StartupPath = [Environment]::GetFolderPath('Startup') }
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

$reminderProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and (
    $_.CommandLine -like '*reminder-supervisor.ps1*' -or
    $_.CommandLine -like '*reminder-watchdog.ps1*' -or
    $_.CommandLine -like '*reminder-desktop-host-supervisor.ps1*' -or
    $_.CommandLine -like '*reminder-host.ps1*'
  )
})
foreach ($reminderProcess in $reminderProcesses) {
  Stop-Process -Id $reminderProcess.ProcessId -ErrorAction SilentlyContinue
}
