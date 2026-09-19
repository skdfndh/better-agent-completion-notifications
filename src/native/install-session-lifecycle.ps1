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

$hiddenLauncherScript = Join-Path $PSScriptRoot 'reminder-hidden-launcher.vbs'
$sessionStartScript = Join-Path $PSScriptRoot 'reminder-session-start.ps1'
$commandWindows = "wscript.exe `"$hiddenLauncherScript`" `"-File`" `"$sessionStartScript`" `"-WorkspacePath`" `"$WorkspacePath`""

if (Test-Path -LiteralPath $HooksPath) {
  $hookDocument = Get-Content -LiteralPath $HooksPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
  $hookDocument = [PSCustomObject]@{ description = 'Codex task reminder hooks'; hooks = [PSCustomObject]@{} }
}

if ($null -eq $hookDocument.hooks) {
  $hookDocument | Add-Member -NotePropertyName hooks -NotePropertyValue ([PSCustomObject]@{})
}

$handler = [PSCustomObject]@{
  type = 'command'
  command = $commandWindows
  commandWindows = $commandWindows
  async = $true
  timeout = 5
  statusMessage = 'Starting task reminder host'
}
$group = [PSCustomObject]@{
  matcher = 'startup|resume|clear'
  hooks = @($handler)
}
$hookDocument.hooks | Add-Member -Force -NotePropertyName SessionStart -NotePropertyValue @($group)

$directory = Split-Path -Parent $HooksPath
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$json = $hookDocument | ConvertTo-Json -Depth 10
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($HooksPath, $json, $utf8WithoutBom)
