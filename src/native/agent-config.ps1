param([Parameter(Mandatory = $true)][ValidateSet('antigravity', 'dsh')][string]$Source,[Parameter(Mandatory = $true)][ValidateSet('install', 'uninstall')][string]$Action,[string]$ConfigPath)
if (-not $ConfigPath) { throw 'ConfigPath is required for optional agent integration.' }
$projectPath = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$handlerPath = Join-Path $projectPath 'src\hook-handler.ts'
$projectMarker = [Regex]::Escape($handlerPath.Replace('\', '\\'))
$eventName = if ($Source -eq 'dsh') { 'turn/end' } else { 'Stop' }
$command = "node --experimental-strip-types `"$handlerPath`" --source $Source"
if (Test-Path -LiteralPath $ConfigPath) { $document = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $document = [PSCustomObject]@{ hooks = [PSCustomObject]@{} } }
if ($null -eq $document.hooks) { $document | Add-Member -NotePropertyName hooks -NotePropertyValue ([PSCustomObject]@{}) }
$existing = @()
if ($document.hooks.$eventName) { $existing += @($document.hooks.$eventName | Where-Object { ($_ | ConvertTo-Json -Depth 10) -notmatch "$projectMarker.*--source $Source" }) }
if ($Action -eq 'install') { $existing += [PSCustomObject]@{ hooks = @([PSCustomObject]@{ type = 'command'; command = $command; commandWindows = $command; async = $true; timeout = 5 }) } }
if ($existing.Count -gt 0) { $document.hooks | Add-Member -Force -NotePropertyName $eventName -NotePropertyValue @($existing) } else { $document.hooks.PSObject.Properties.Remove($eventName) }
$directory = Split-Path -Parent $ConfigPath
if ($directory -and -not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ConfigPath, ($document | ConvertTo-Json -Depth 10), $utf8WithoutBom)
