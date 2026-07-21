[CmdletBinding()]
param(
  [string]$ProjectRoot = '',
  [string]$HostAddress = '127.0.0.1',
  [int]$Port = 4200
)

$ErrorActionPreference = 'Stop'

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $ProjectRoot = (Resolve-Path $ProjectRoot).Path
}

$logDirectory = Join-Path $ProjectRoot '.dev-logs'
$logPath = Join-Path $logDirectory 'angular-dev.log'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Content -LiteralPath $logPath -Value '' -Encoding UTF8

function Write-SessionMessage {
  param([Parameter(Mandatory = $true)][string]$Message)

  $line = "[angular:win] $Message"
  Write-Host $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Get-NodeVersion {
  param([Parameter(Mandatory = $true)][string]$Executable)

  try {
    $versionOutput = @(& $Executable --version 2>$null)
    $version = if ($versionOutput.Count -gt 0) {
      ([string]$versionOutput[0]).Trim()
    } else {
      ''
    }

    if ($LASTEXITCODE -eq 0 -and $version -match '^v\d+\.\d+\.\d+$') {
      return $version
    }
  } catch {
    return ''
  }

  return ''
}

function Get-Node22Runtime {
  $candidateDirectories = [System.Collections.Generic.List[string]]::new()

  if ($env:NODE_HOME) {
    $candidateDirectories.Add($env:NODE_HOME)
  }

  $pathNodeCommands = @(
    Get-Command node `
      -CommandType Application `
      -All `
      -ErrorAction SilentlyContinue
  )

  foreach ($command in $pathNodeCommands) {
    if ($command.Source) {
      $candidateDirectories.Add((Split-Path $command.Source -Parent))
    }
  }

  if ($env:USERPROFILE) {
    $portableRoot = Join-Path $env:USERPROFILE '.nodes\node-22'

    if (Test-Path $portableRoot) {
      $portableDirectories = @(
        Get-ChildItem `
          -LiteralPath $portableRoot `
          -Directory `
          -ErrorAction SilentlyContinue
      )

      foreach ($directory in $portableDirectories) {
        $candidateDirectories.Add($directory.FullName)
      }
    }
  }

  $runtimes = foreach ($directory in ($candidateDirectories | Select-Object -Unique)) {
    if (-not $directory) {
      continue
    }

    $nodeExecutable = Join-Path $directory 'node.exe'
    $npmExecutable = Join-Path $directory 'npm.cmd'

    if (-not (Test-Path $nodeExecutable) -or -not (Test-Path $npmExecutable)) {
      continue
    }

    $versionText = Get-NodeVersion -Executable $nodeExecutable

    if ($versionText -notmatch '^v22\.') {
      continue
    }

    [PSCustomObject]@{
      Directory = $directory
      Node = $nodeExecutable
      Npm = $npmExecutable
      Version = [version]$versionText.TrimStart('v')
      VersionText = $versionText
    }
  }

  $selectedRuntime = $runtimes |
    Sort-Object -Property Version -Descending |
    Select-Object -First 1

  if (-not $selectedRuntime) {
    $detectedCommands = if ($pathNodeCommands.Count -gt 0) {
      ($pathNodeCommands | ForEach-Object { $_.Source }) -join ', '
    } else {
      'nenhum node.exe encontrado no PATH'
    }

    throw "Node.js 22.x nao foi encontrado. Executaveis detectados: $detectedCommands"
  }

  return $selectedRuntime
}

try {
  $runtime = Get-Node22Runtime

  $env:NODE_HOME = $runtime.Directory
  $env:Path = "$($runtime.Directory);$env:Path"

  $nodeVersion = Get-NodeVersion -Executable $runtime.Node
  $npmOutput = @(& $runtime.Npm --version 2>$null)
  $npmVersion = if ($npmOutput.Count -gt 0) {
    ([string]$npmOutput[0]).Trim()
  } else {
    ''
  }

  if ($LASTEXITCODE -ne 0 -or -not $npmVersion) {
    throw "Nao foi possivel consultar o npm selecionado: $($runtime.Npm)"
  }

  Write-SessionMessage "Projeto: $ProjectRoot"
  Write-SessionMessage "Node: $nodeVersion"
  Write-SessionMessage "Node executavel: $($runtime.Node)"
  Write-SessionMessage "npm: $npmVersion"
  Write-SessionMessage "npm executavel: $($runtime.Npm)"
  Write-SessionMessage "Log: $logPath"
  Write-SessionMessage "Iniciando Angular em http://${HostAddress}:$Port/"

  Set-Location $ProjectRoot

  & $runtime.Npm run start:emu -- --host $HostAddress --port $Port 2>&1 |
    Tee-Object -FilePath $logPath -Append

  $exitCode = $LASTEXITCODE

  if ($exitCode -ne 0) {
    Write-SessionMessage "Angular encerrou com codigo $exitCode."
    exit $exitCode
  }

  Write-SessionMessage 'Angular encerrado normalmente.'
  exit 0
} catch {
  Write-SessionMessage "ERRO: $($_.Exception.Message)"
  exit 1
}
