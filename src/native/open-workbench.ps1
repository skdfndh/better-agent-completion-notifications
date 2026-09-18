param(
  [string]$WorkspacePath = $env:CODEX_TASK_REMINDER_WORKSPACE
)

$projectPath = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$uiServerScript = Join-Path $projectPath 'src\ui\server.js'
$workbenchUrl = 'http://127.0.0.1:3300'

function Test-WorkbenchAvailable {
  try {
    $response = Invoke-WebRequest -Uri $workbenchUrl -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-WorkbenchAvailable)) {
  $nodeCommand = Get-Command 'node.exe' -ErrorAction Stop
  Start-Process -FilePath $nodeCommand.Source -ArgumentList @('--experimental-strip-types', $uiServerScript) -WorkingDirectory $projectPath -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 10 -and -not (Test-WorkbenchAvailable); $attempt += 1) {
    Start-Sleep -Milliseconds 500
  }
}

Start-Process $workbenchUrl
