param(
  [Parameter(Mandatory = $true)][ValidateSet('install', 'uninstall')][string]$Action,
  [string]$DshHome,
  [string]$Profile = 'web',
  [string]$DshCliPath = 'npx.cmd'
)

$ErrorActionPreference = 'Stop'
$bundleName = 'better-codex-task-reminder-dsh-bridge'
$projectPath = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$templatePath = Join-Path $PSScriptRoot 'dsh-bridge-template\package.json'
$handlerPath = Join-Path $projectPath 'src\hook-handler.ts'
$preferencesScript = Join-Path $projectPath 'src\agent-preferences.ts'
$resolvedDshHome = if ($DshHome) { $DshHome } else { Join-Path $env:USERPROFILE '.dsh' }
$profilePath = Join-Path $resolvedDshHome "profiles\$Profile"
$profilePackagePath = Join-Path $profilePath 'package.json'
$runtimePath = Join-Path $env:APPDATA 'CodexTaskReminder'
$dshHooksPath = Join-Path $runtimePath 'dsh-hooks.json'
$bundlePath = Join-Path $runtimePath 'dsh-bridge-bundle'
$bundlePackagePath = Join-Path $bundlePath 'package.json'
$bundlePatchPath = Join-Path $bundlePath 'cordis.patch.yml'

function Write-Utf8File([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Invoke-DshPlugin([string]$Operation, [string[]]$Arguments) {
  & $DshCliPath '@deepseek-ai/dsh' 'plugin' '--profile' $Profile $Operation @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "DSH plugin $Operation failed with exit code $LASTEXITCODE."
  }
}

function Set-DshSourcePreference([string]$Enabled) {
  & node --experimental-strip-types $preferencesScript --source dsh --enabled $Enabled
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to update DSH source preference."
  }
}

if (-not (Test-Path -LiteralPath $profilePath)) {
  throw "DSH profile directory does not exist: $profilePath"
}

if ($Action -eq 'uninstall') {
  $shouldRemove = $false
  if (Test-Path -LiteralPath $profilePackagePath) {
    $profileDocument = Get-Content -LiteralPath $profilePackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $dependency = $profileDocument.dependencies.PSObject.Properties[$bundleName]
    $bundleEntries = @($profileDocument.dsh.profile.bundles)
    $shouldRemove = ($null -ne $dependency) -or ($bundleEntries -contains $bundleName)
  }
  if ($shouldRemove) {
    Invoke-DshPlugin 'remove' @($bundleName)
  }
  if (Test-Path -LiteralPath $dshHooksPath) {
    Remove-Item -LiteralPath $dshHooksPath -Force
  }
  if (Test-Path -LiteralPath $bundlePath) {
    Remove-Item -LiteralPath $bundlePath -Recurse -Force
  }
  Set-DshSourcePreference 'false'
  exit 0
}

if (-not (Test-Path -LiteralPath $templatePath)) {
  throw "DSH bridge template does not exist: $templatePath"
}

$installed = $false
try {
  New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
  New-Item -ItemType Directory -Path $bundlePath -Force | Out-Null
  Copy-Item -LiteralPath $templatePath -Destination $bundlePackagePath -Force

  $command = "node --experimental-strip-types `"$handlerPath`" --source dsh"
  $hookDocument = [PSCustomObject]@{
    hooks = [PSCustomObject]@{
      Stop = @([PSCustomObject]@{
        hooks = @([PSCustomObject]@{
          type = 'command'
          command = $command
          timeout = 5
        })
      })
    }
  }
  Write-Utf8File $dshHooksPath (($hookDocument | ConvertTo-Json -Depth 10) + [Environment]::NewLine)

  $yamlPath = $dshHooksPath.Replace("'", "''")
  $bridgePatch = @"
- insert:
    - id: better-codex-task-reminder-dsh-hooks
      name: '@deepseek-ai/dsh-hooks-codex'
      config:
        configPath: '$yamlPath'
"@
  Write-Utf8File $bundlePatchPath ($bridgePatch + [Environment]::NewLine)

  Invoke-DshPlugin 'add' @($bundlePath)
  $installed = $true
  if (-not ((Test-Path -LiteralPath $dshHooksPath) -and (Test-Path -LiteralPath $bundlePackagePath) -and (Test-Path -LiteralPath $bundlePatchPath))) {
    throw 'DSH bridge runtime files could not be verified.'
  }
  Set-DshSourcePreference 'true'
} catch {
  if ($installed) {
    try {
      Invoke-DshPlugin 'remove' @($bundleName)
    } catch {
    }
  }
  if (Test-Path -LiteralPath $dshHooksPath) {
    Remove-Item -LiteralPath $dshHooksPath -Force
  }
  if (Test-Path -LiteralPath $bundlePath) {
    Remove-Item -LiteralPath $bundlePath -Recurse -Force
  }
  throw
}
