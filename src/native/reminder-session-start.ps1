param(
  [string]$WorkspacePath = $env:CODEX_TASK_REMINDER_WORKSPACE,
  [string]$AppDataPath = $env:APPDATA,
  [string]$DesktopSupervisorScript = (Join-Path $PSScriptRoot 'reminder-desktop-host-supervisor.ps1'),
  [string]$HiddenLauncherScript = (Join-Path $PSScriptRoot 'reminder-hidden-launcher.vbs')
)

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

$scriptPattern = '(?i)-File\s+(?:"?' + [Regex]::Escape($DesktopSupervisorScript) + '"?)(?:\s|$)'
$existingSupervisor = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $scriptPattern })
if ($existingSupervisor.Count -gt 0) { exit 0 }

$arguments = "`"$HiddenLauncherScript`" `"-File`" `"$DesktopSupervisorScript`" `"-WorkspacePath`" `"$WorkspacePath`" `"-AppDataPath`" `"$AppDataPath`" `"-ExitWhenCodexStops`""
Start-Process -FilePath 'wscript.exe' -ArgumentList $arguments -WindowStyle Hidden
