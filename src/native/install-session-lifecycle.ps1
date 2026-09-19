param(
  [string]$WorkspacePath,
  [string]$HooksPath = (Join-Path $env:USERPROFILE '.codex\hooks.json'),
  [string]$StartupPath,
  [string]$TaskName = 'CodexTaskReminderWatchdog',
  [string]$UninstallScript = (Join-Path $PSScriptRoot 'uninstall-autostart.ps1')
)

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

if (-not $StartupPath) { $StartupPath = [Environment]::GetFolderPath('Startup') }
& $UninstallScript -TaskName $TaskName -StartupPath $StartupPath

$hookHandlerScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'hook-handler.ts'
$projectMarker = [Regex]::Escape($PSScriptRoot)

if (Test-Path -LiteralPath $HooksPath) {
  $hookDocument = Get-Content -LiteralPath $HooksPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
  $hookDocument = [PSCustomObject]@{ description = 'Codex task reminder hooks'; hooks = [PSCustomObject]@{} }
}

if ($null -eq $hookDocument.hooks) {
  $hookDocument | Add-Member -NotePropertyName hooks -NotePropertyValue ([PSCustomObject]@{})
}

function Remove-ProjectGroups($groups) {
  return @($groups | Where-Object { ($_ | ConvertTo-Json -Depth 10) -notmatch $projectMarker })
}

if ($hookDocument.hooks.SessionStart) {
  $remainingSessionStart = @($hookDocument.hooks.SessionStart | Where-Object { ($_ | ConvertTo-Json -Depth 10) -notmatch 'reminder-session-start\.ps1' })
  if ($remainingSessionStart.Count -gt 0) {
    $hookDocument.hooks | Add-Member -Force -NotePropertyName SessionStart -NotePropertyValue @($remainingSessionStart)
  } else {
    $hookDocument.hooks.PSObject.Properties.Remove('SessionStart')
  }
}

foreach ($eventName in @('Stop', 'PermissionRequest', 'Interrupt')) {
  $existing = if ($hookDocument.hooks.$eventName) { Remove-ProjectGroups @($hookDocument.hooks.$eventName) } else { @() }
  $command = "node --experimental-strip-types `"$hookHandlerScript`" --source codex"
  $handler = [PSCustomObject]@{ type = 'command'; command = $command; commandWindows = $command; async = $true; timeout = 5; statusMessage = 'Dispatching Codex reminder' }
  $group = [PSCustomObject]@{ hooks = @($handler) }
  $hookDocument.hooks | Add-Member -Force -NotePropertyName $eventName -NotePropertyValue @($existing + $group)
}

$directory = Split-Path -Parent $HooksPath
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$json = $hookDocument | ConvertTo-Json -Depth 10
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($HooksPath, $json, $utf8WithoutBom)
