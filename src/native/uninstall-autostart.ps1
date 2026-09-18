$taskName = 'CodexTaskReminderWatchdog'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$startupPath = [Environment]::GetFolderPath('Startup')
$watchdogShortcutName = 'Codex ' + [char]0x4EFB + [char]0x52A1 + [char]0x63D0 + [char]0x9192 + [char]0x5B88 + [char]0x62A4 + [char]0x5668 + '.lnk'
$watchdogShortcutPath = Join-Path $startupPath $watchdogShortcutName
if (Test-Path -LiteralPath $watchdogShortcutPath) {
  Remove-Item -LiteralPath $watchdogShortcutPath -Force
}
