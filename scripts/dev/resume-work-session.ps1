[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Validate,
  [switch]$Start,
  [string]$Branch = ''
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Invoke-NativeStep {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  Write-Host "[work:resume] $Label"
  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw "Falha em: $Label (codigo $LASTEXITCODE)."
  }
}

function Get-RepositoryStatus {
  $status = @(& git status --porcelain)

  if ($LASTEXITCODE -ne 0) {
    throw 'Nao foi possivel consultar o estado do repositorio.'
  }

  return $status
}

function Get-StatusPath {
  param([Parameter(Mandatory = $true)][string]$Entry)

  if ($Entry.Length -lt 4) {
    return ''
  }

  $path = $Entry.Substring(3).Trim()

  if ($path -match ' -> ') {
    $path = ($path -split ' -> ')[-1]
  }

  return $path.Trim('"')
}

function Test-GeneratedStatusEntry {
  param([Parameter(Mandatory = $true)][string]$Entry)

  $path = Get-StatusPath -Entry $Entry

  return $path -eq 'firestore.rules' -or
    $path -match '^firebase-export-[^/\\]+(?:[/\\].*)?$'
}

function Move-GeneratedEmulatorExports {
  $exports = @(
    Get-ChildItem -LiteralPath $ProjectRoot -Directory -Filter 'firebase-export-*' -ErrorAction SilentlyContinue
  )

  if ($exports.Count -eq 0) {
    return
  }

  $archiveRoot = Join-Path $ProjectRoot '.emulator-data-backups\manual-exports'

  if (-not (Test-Path $archiveRoot)) {
    New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null
  }

  foreach ($export in $exports) {
    $target = Join-Path $archiveRoot $export.Name

    if (Test-Path $target) {
      $suffix = Get-Date -Format 'yyyyMMdd-HHmmssfff'
      $target = Join-Path $archiveRoot "$($export.Name)-$suffix"
    }

    Write-Host "[work:resume] Arquivando exportacao do Emulator: $($export.Name)" -ForegroundColor Yellow
    Move-Item -LiteralPath $export.FullName -Destination $target
    Write-Host "[work:resume] Exportacao preservada em: $target" -ForegroundColor Green
  }
}

function Restore-GeneratedRulesArtifact {
  $rulesPath = Join-Path $ProjectRoot 'firestore.rules'
  $rulesTracked = $false

  & git ls-files --error-unmatch -- firestore.rules *> $null
  if ($LASTEXITCODE -eq 0) {
    $rulesTracked = $true
  }

  if ($rulesTracked) {
    Invoke-NativeStep 'Restaurando firestore.rules gerado localmente' {
      git restore -- firestore.rules
    }
    return
  }

  if (Test-Path $rulesPath) {
    Write-Host '[work:resume] firestore.rules local preservado como artefato ignorado.' -ForegroundColor DarkGray
  }
}

function Resolve-GeneratedRepositoryArtifacts {
  $status = @(Get-RepositoryStatus)

  if ($status.Count -eq 0) {
    return
  }

  $nonGeneratedChanges = @(
    $status | Where-Object { -not (Test-GeneratedStatusEntry -Entry $_) }
  )

  if ($nonGeneratedChanges.Count -gt 0) {
    Write-Host '[work:resume] Alteracoes locais detectadas:' -ForegroundColor Yellow
    $status | ForEach-Object { Write-Host "  $_" }
    throw 'A retomada foi interrompida para nao sobrescrever trabalho local.'
  }

  Move-GeneratedEmulatorExports
  Restore-GeneratedRulesArtifact

  $remainingStatus = @(Get-RepositoryStatus)

  if ($remainingStatus.Count -gt 0) {
    Write-Host '[work:resume] Artefatos locais ainda impedem a sincronizacao:' -ForegroundColor Yellow
    $remainingStatus | ForEach-Object { Write-Host "  $_" }
    throw 'Nao foi possivel normalizar automaticamente os artefatos gerados.'
  }
}

function Get-GitScalar {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  $output = @(& git @Arguments)

  if ($LASTEXITCODE -ne 0 -or $output.Count -eq 0) {
    throw $FailureMessage
  }

  return ([string]$output[0]).Trim()
}

function Get-DependencyLockHash {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LockPath
  )

  if (-not (Test-Path $LockPath)) {
    throw "Arquivo de lock ausente: $LockPath"
  }

  return (Get-FileHash -LiteralPath $LockPath -Algorithm SHA256).Hash
}

function Test-DependencyInstallCurrent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodeModulesPath,
    [Parameter(Mandatory = $true)]
    [string]$LockPath,
    [Parameter(Mandatory = $true)]
    [string]$StampPath
  )

  if (-not (Test-Path $NodeModulesPath) -or -not (Test-Path $StampPath)) {
    return $false
  }

  $expectedHash = Get-DependencyLockHash -LockPath $LockPath
  $installedHash = (Get-Content -LiteralPath $StampPath -Raw).Trim()

  return $installedHash -eq $expectedHash
}

function Save-DependencyInstallStamp {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LockPath,
    [Parameter(Mandatory = $true)]
    [string]$StampPath
  )

  $stampDirectory = Split-Path -Parent $StampPath

  if (-not (Test-Path $stampDirectory)) {
    New-Item -ItemType Directory -Path $stampDirectory | Out-Null
  }

  $lockHash = Get-DependencyLockHash -LockPath $LockPath
  Set-Content -LiteralPath $StampPath -Value $lockHash -Encoding ASCII
}

Set-Location $ProjectRoot
Write-Host "[work:resume] Projeto: $ProjectRoot"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git nao foi encontrado no PATH.'
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd nao foi encontrado no PATH.'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js nao foi encontrado no PATH.'
}

Resolve-GeneratedRepositoryArtifacts

$currentBranch = Get-GitScalar `
  -Arguments @('branch', '--show-current') `
  -FailureMessage 'Nao foi possivel identificar a branch atual.'
$requestedBranch = ([string]$Branch).Trim()
$targetBranch = if ($requestedBranch) { $requestedBranch } else { $currentBranch }

if (-not $targetBranch) {
  throw 'Branch de retomada ausente. Abra uma branch local ou informe -Branch.'
}

Write-Host "[work:resume] Branch selecionada: $targetBranch"

Invoke-NativeStep "Buscando origin/$targetBranch" {
  git fetch origin $targetBranch
}

if ($currentBranch -ne $targetBranch) {
  & git show-ref --verify --quiet "refs/heads/$targetBranch"
  $localBranchExists = $LASTEXITCODE -eq 0

  if ($localBranchExists) {
    Invoke-NativeStep "Alternando explicitamente para $targetBranch" {
      git switch $targetBranch
    }
  } else {
    Invoke-NativeStep "Criando branch local explicita $targetBranch" {
      git switch --track -c $targetBranch "origin/$targetBranch"
    }
  }
}

Invoke-NativeStep 'Atualizando branch somente por fast-forward' {
  git merge --ff-only "origin/$targetBranch"
}

$localHead = Get-GitScalar `
  -Arguments @('rev-parse', 'HEAD') `
  -FailureMessage 'Nao foi possivel identificar o HEAD local.'
$remoteHead = Get-GitScalar `
  -Arguments @('rev-parse', "origin/$targetBranch") `
  -FailureMessage 'Nao foi possivel identificar o HEAD remoto.'

if ($localHead -ne $remoteHead) {
  throw "Branch local e remota divergentes. Local: $localHead Remoto: $remoteHead"
}

Write-Host "[work:resume] Checkpoint sincronizado: $localHead" -ForegroundColor Green

Invoke-NativeStep 'Validando alinhamento entre package.json e package-lock.json' {
  node "$ProjectRoot\scripts\dev\check-package-lock-sync.mjs"
}

$rootLockPath = Join-Path $ProjectRoot 'package-lock.json'
$rootNodeModulesPath = Join-Path $ProjectRoot 'node_modules'
$rootStampPath = Join-Path $rootNodeModulesPath '.work-resume-lock.sha256'
$functionsLockPath = Join-Path $ProjectRoot 'functions\package-lock.json'
$functionsNodeModulesPath = Join-Path $ProjectRoot 'functions\node_modules'
$functionsStampPath = Join-Path $functionsNodeModulesPath '.work-resume-lock.sha256'

$rootInstallCurrent = Test-DependencyInstallCurrent `
  -NodeModulesPath $rootNodeModulesPath `
  -LockPath $rootLockPath `
  -StampPath $rootStampPath

if ($Install -or -not $rootInstallCurrent) {
  Invoke-NativeStep 'Sincronizando dependencias da aplicacao com package-lock.json' {
    npm.cmd ci
  }
  Save-DependencyInstallStamp `
    -LockPath $rootLockPath `
    -StampPath $rootStampPath
}

$functionsInstallCurrent = Test-DependencyInstallCurrent `
  -NodeModulesPath $functionsNodeModulesPath `
  -LockPath $functionsLockPath `
  -StampPath $functionsStampPath

if ($Install -or -not $functionsInstallCurrent) {
  Invoke-NativeStep 'Sincronizando dependencias das Functions com package-lock.json' {
    npm.cmd --prefix functions ci
  }
  Save-DependencyInstallStamp `
    -LockPath $functionsLockPath `
    -StampPath $functionsStampPath
}

if ($Validate) {
  Invoke-NativeStep 'Executando build e testes das Functions' {
    npm.cmd --prefix functions run test
  }

  Invoke-NativeStep 'Validando lint completo das Functions' {
    npm.cmd --prefix functions run lint:deploy:all
  }

  Invoke-NativeStep 'Executando testes Angular' {
    npm.cmd run test:ci
  }

  Invoke-NativeStep 'Executando build Angular de producao' {
    npm.cmd run build
  }

  Invoke-NativeStep 'Executando E2E completo de videos' {
    npm.cmd run test:media:video:e2e
  }

  Invoke-NativeStep 'Executando E2E de revalidacao de idade' {
    npm.cmd run test:compliance:age:e2e
  }
}

$head = Get-GitScalar `
  -Arguments @('log', '-1', '--oneline') `
  -FailureMessage 'Nao foi possivel identificar o commit atual.'
Write-Host "[work:resume] Pronto em: $head" -ForegroundColor Green
Write-Host "[work:resume] SHA confirmado: $localHead" -ForegroundColor Green

$status = @(Get-RepositoryStatus)

if ($status.Count -gt 0) {
  Write-Host '[work:resume] Estado final:' -ForegroundColor Yellow
  $status | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host '[work:resume] Arvore de trabalho limpa.' -ForegroundColor Green
}

if ($Start) {
  Invoke-NativeStep 'Iniciando sessao local Angular + Firebase' {
    npm.cmd run dev:auth:win
  }
}
