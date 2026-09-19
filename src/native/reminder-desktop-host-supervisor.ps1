param(
  [string]$WorkspacePath = $env:CODEX_TASK_REMINDER_WORKSPACE,
  [string]$AppDataPath,
  [string]$HostScript = (Join-Path $PSScriptRoot 'reminder-host.ps1'),
  [switch]$AlwaysRun,
  [switch]$ExitWhenCodexStops,
  [string]$CodexProcessName = 'codex',
  [int]$PollSeconds = 2
)

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

if ($AppDataPath) { $env:APPDATA = $AppDataPath }

$hostProcess = $null
$hostArguments = "-NoProfile -STA -File `"$HostScript`" -WorkspacePath `"$WorkspacePath`""

while ($true) {
  $codexRunning = $AlwaysRun -or (@(Get-Process -Name $CodexProcessName -ErrorAction SilentlyContinue).Count -gt 0)
  $hostRunning = $hostProcess -and -not $hostProcess.HasExited

  if ($codexRunning -and -not $hostRunning) {
    $hostProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $hostArguments -PassThru -WindowStyle Hidden
  }

  if (-not $codexRunning -and $hostRunning) {
    Stop-Process -Id $hostProcess.Id -ErrorAction SilentlyContinue
    $hostProcess = $null
  }

  if ($ExitWhenCodexStops -and -not $codexRunning) { break }

  Start-Sleep -Seconds $PollSeconds
}
