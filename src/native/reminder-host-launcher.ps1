param(
  [string]$WorkspacePath = $env:CODEX_TASK_REMINDER_WORKSPACE,
  [string]$AppDataPath,
  [string]$HostScript = (Join-Path $PSScriptRoot 'reminder-host.ps1')
)

Remove-Item -Path Env:TEST_REMINDER_HOST_NO_RUN -ErrorAction SilentlyContinue
if ($AppDataPath) { $env:APPDATA = $AppDataPath }
$hostArguments = "-NoProfile -STA -File `"$HostScript`" -WorkspacePath `"$WorkspacePath`""
$hostProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $hostArguments -PassThru -WindowStyle Hidden
$hostProcess.WaitForExit()
