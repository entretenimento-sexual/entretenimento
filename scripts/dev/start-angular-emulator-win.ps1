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
$sessionHeadPath = Join-Path $logDirectory 'angular-session-head.txt'
$script:LogFileEnabled = $true
$script:LogWriteWarningEmitted = $false

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

try {
  Set-Content -LiteralPath $logPath -Value '' -Encoding UTF8 -ErrorAction Stop
} catch {
  $script:LogFileEnabled = $false
  Write-Warning "[angular:win] Nao foi possivel inicializar o log em $logPath. A sessao continuara com saida no console. Erro: $($_.Exception.Message)"
}

function Write-LogLine {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Line
  )

  Write-Host $Line

  if (-not $script:LogFileEnabled) {
    return
  }

  $maxAttempts = 3

  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
      Add-Content -LiteralPath $logPath -Value $Line -Encoding UTF8 -ErrorAction Stop
      return
    } catch {
      if ($attempt -lt $maxAttempts) {
        Start-Sleep -Milliseconds (100 * $attempt)
        continue
      }

      $script:LogFileEnabled = $false

      if (-not $script:LogWriteWarningEmitted) {
        $script:LogWriteWarningEmitted = $true
        Write-Warning "[angular:win] O log ficou temporariamente indisponivel em $logPath. A sessao continuara com saida no console. Erro: $($_.Exception.Message)"
      }
    }
  }
}

function Write-SessionMessage {
  param([Parameter(Mandatory = $true)][string]$Message)

  Write-LogLine -Line "[angular:win] $Message"
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
  $env:NG_CLI_ANALYTICS = 'false'

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

  $angularCli = Join-Path $ProjectRoot 'node_modules\@angular\cli\bin\ng.js'

  if (-not (Test-Path $angularCli)) {
    throw "Angular CLI local nao encontrado: $angularCli"
  }

  Set-Location $ProjectRoot

  $gitHeadOutput = @(& git rev-parse HEAD 2>$null)
  $gitHead = if ($LASTEXITCODE -eq 0 -and $gitHeadOutput.Count -gt 0) {
    ([string]$gitHeadOutput[0]).Trim()
  } else {
    ''
  }

  if (-not $gitHead) {
    throw 'Nao foi possivel identificar o HEAD Git da sessao Angular.'
  }

  Set-Content -LiteralPath $sessionHeadPath -Value $gitHead -Encoding ASCII

  Write-SessionMessage "Projeto: $ProjectRoot"
  Write-SessionMessage "Git HEAD: $gitHead"
  Write-SessionMessage "Node: $nodeVersion"
  Write-SessionMessage "Node executavel: $($runtime.Node)"
  Write-SessionMessage "npm: $npmVersion"
  Write-SessionMessage "npm executavel: $($runtime.Npm)"
  Write-SessionMessage "Angular CLI: $angularCli"
  Write-SessionMessage "Log: $logPath"
  Write-SessionMessage 'HMR: ativo'
  Write-SessionMessage "Iniciando Angular em http://${HostAddress}:$Port/"

  $angularArguments = @(
    $angularCli,
    'serve',
    '--configuration',
    'dev-emu',
    '--hmr',
    '--host',
    $HostAddress,
    '--port',
    [string]$Port
  )

  $previousErrorActionPreference = $ErrorActionPreference

  try {
    # O Angular CLI escreve avisos validos em stderr. No Windows PowerShell 5.1,
    # stderr combinado com ErrorActionPreference=Stop vira excecao antes que o
    # codigo de saida real do processo seja avaliado. Durante o processo nativo,
    # os dois fluxos continuam registrados e somente LASTEXITCODE decide falha.
    $ErrorActionPreference = 'Continue'

    & $runtime.Node @angularArguments 2>&1 |
      ForEach-Object {
        Write-LogLine -Line ([string]$_)
      }

    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

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
