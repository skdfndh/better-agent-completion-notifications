param(
  [string]$WorkspacePath = $env:CODEX_TASK_REMINDER_WORKSPACE
)

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

$hostScript = Join-Path $PSScriptRoot 'reminder-host.ps1'
$hostProcess = $null

while ($true) {
  $codexRunning = @(Get-Process -Name 'codex' -ErrorAction SilentlyContinue).Count -gt 0
  $hostRunning = $hostProcess -and -not $hostProcess.HasExited

  if ($codexRunning -and -not $hostRunning) {
    $arguments = "-NoProfile -STA -WindowStyle Hidden -File `"$hostScript`" -WorkspacePath `"$WorkspacePath`""
    $hostProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -PassThru -WindowStyle Hidden
  }

  if (-not $codexRunning -and $hostRunning) {
    Stop-Process -Id $hostProcess.Id -ErrorAction SilentlyContinue
    $hostProcess = $null
  }

  Start-Sleep -Seconds 2
}
