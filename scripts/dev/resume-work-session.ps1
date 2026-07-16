[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Validate,
  [switch]$Start
)

$ErrorActionPreference = 'Stop'
$Branch = 'feat/auth-password-recovery-polish'
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

$status = @(Get-RepositoryStatus)

if ($status.Count -gt 0) {
  $nonGeneratedChanges = @(
    $status | Where-Object { $_ -notmatch 'firestore\.rules$' }
  )

  if ($nonGeneratedChanges.Count -gt 0) {
    Write-Host '[work:resume] Alteracoes locais detectadas:' -ForegroundColor Yellow
    $status | ForEach-Object { Write-Host "  $_" }
    throw 'A retomada foi interrompida para nao sobrescrever trabalho local.'
  }

  Invoke-NativeStep 'Restaurando firestore.rules gerado localmente' {
    git restore -- firestore.rules
  }
}

Invoke-NativeStep "Buscando origin/$Branch" {
  git fetch origin $Branch
}

$currentBranch = Get-GitScalar `
  -Arguments @('branch', '--show-current') `
  -FailureMessage 'Nao foi possivel identificar a branch atual.'

if ($currentBranch -ne $Branch) {
  & git show-ref --verify --quiet "refs/heads/$Branch"
  $localBranchExists = $LASTEXITCODE -eq 0

  if ($localBranchExists) {
    Invoke-NativeStep "Alternando para $Branch" {
      git switch $Branch
    }
  } else {
    Invoke-NativeStep "Criando branch local $Branch" {
      git switch --track -c $Branch "origin/$Branch"
    }
  }
}

Invoke-NativeStep 'Atualizando branch somente por fast-forward' {
  git merge --ff-only "origin/$Branch"
}

$localHead = Get-GitScalar `
  -Arguments @('rev-parse', 'HEAD') `
  -FailureMessage 'Nao foi possivel identificar o HEAD local.'
$remoteHead = Get-GitScalar `
  -Arguments @('rev-parse', "origin/$Branch") `
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
  try {
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
  } finally {
    if (Test-Path (Join-Path $ProjectRoot 'firestore.rules')) {
      & git restore -- firestore.rules
    }
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
