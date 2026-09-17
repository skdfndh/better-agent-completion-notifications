$taskName = 'CodexTaskReminderWatchdog'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
