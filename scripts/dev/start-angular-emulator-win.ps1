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

function Select-Node22 {
  $currentNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  $currentVersion = if ($currentNode) {
    (& $currentNode.Source --version 2>$null).Trim()
  } else {
    ''
  }

  if ($currentVersion -match '^v22\.') {
    return
  }

  $portableRoot = if ($env:USERPROFILE) {
    Join-Path $env:USERPROFILE '.nodes\node-22'
  } else {
    ''
  }

  $portableNode = if ($portableRoot -and (Test-Path $portableRoot)) {
    Get-ChildItem -LiteralPath $portableRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -like 'node-v22*-win-x64' -and
        (Test-Path (Join-Path $_.FullName 'node.exe')) -and
        (Test-Path (Join-Path $_.FullName 'npm.cmd'))
      } |
      Sort-Object -Property Name -Descending |
      Select-Object -First 1
  } else {
    $null
  }

  if (-not $portableNode) {
    throw "Node.js 22.x nao foi encontrado. Versao atual: $currentVersion"
  }

  $env:NODE_HOME = $portableNode.FullName
  $env:Path = "$($portableNode.FullName);$env:Path"
}

try {
  Select-Node22

  $nodeVersion = (& node --version).Trim()
  $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction Stop
  $npmVersion = (& $npmCommand.Source --version).Trim()

  Write-SessionMessage "Projeto: $ProjectRoot"
  Write-SessionMessage "Node: $nodeVersion"
  Write-SessionMessage "npm: $npmVersion"
  Write-SessionMessage "Log: $logPath"
  Write-SessionMessage "Iniciando Angular em http://${HostAddress}:$Port/"

  Set-Location $ProjectRoot

  & $npmCommand.Source run start:emu -- --host $HostAddress --port $Port 2>&1 |
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
