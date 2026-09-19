param(
  [ValidateSet('antigravity')][string]$Source = 'antigravity',
  [Parameter(Mandatory = $true)][ValidateSet('install', 'uninstall')][string]$Action,
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$handlerPath = Join-Path $projectPath 'src\hook-handler.ts'
$preferencesScript = Join-Path $projectPath 'src\agent-preferences.ts'
$resolvedConfigPath = if ($ConfigPath) {
  $ConfigPath
} else {
  Join-Path $env:USERPROFILE '.gemini\config\hooks.json'
}
$command = "node --experimental-strip-types `"$handlerPath`" --source antigravity"

if (Test-Path -LiteralPath $resolvedConfigPath) {
  $document = Get-Content -LiteralPath $resolvedConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
  $document = [PSCustomObject]@{}
}

if ($Action -eq 'install') {
  $document | Add-Member -Force -NotePropertyName 'better-codex-task-reminder' -NotePropertyValue ([PSCustomObject]@{
    Stop = @([PSCustomObject]@{
      type = 'command'
      command = $command
      timeout = 5
    })
  })
} else {
  $document.PSObject.Properties.Remove('better-codex-task-reminder')
}

$directory = Split-Path -Parent $resolvedConfigPath
if ($directory -and -not (Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($resolvedConfigPath, ($document | ConvertTo-Json -Depth 10), $utf8WithoutBom)

$enabled = if ($Action -eq 'install') { 'true' } else { 'false' }
& node --experimental-strip-types $preferencesScript --source antigravity --enabled $enabled
if ($LASTEXITCODE -ne 0) {
  throw "Unable to update Antigravity source preference."
}
