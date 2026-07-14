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
    throw "Falha em: $Label (código $LASTEXITCODE)."
  }
}

function Get-RepositoryStatus {
  $status = @(& git status --porcelain)

  if ($LASTEXITCODE -ne 0) {
    throw 'Não foi possível consultar o estado do repositório.'
  }

  return $status
}

Set-Location $ProjectRoot
Write-Host "[work:resume] Projeto: $ProjectRoot"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git não foi encontrado no PATH.'
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd não foi encontrado no PATH.'
}

$status = @(Get-RepositoryStatus)

if ($status.Count -gt 0) {
  $nonGeneratedChanges = @(
    $status | Where-Object { $_ -notmatch 'firestore\.rules$' }
  )

  if ($nonGeneratedChanges.Count -gt 0) {
    Write-Host '[work:resume] Alterações locais detectadas:' -ForegroundColor Yellow
    $status | ForEach-Object { Write-Host "  $_" }
    throw 'A retomada foi interrompida para não sobrescrever trabalho local.'
  }

  Invoke-NativeStep 'Restaurando firestore.rules gerado localmente' {
    git restore -- firestore.rules
  }
}

Invoke-NativeStep "Buscando origin/$Branch" {
  git fetch origin $Branch
}

$currentBranch = String(& git branch --show-current).Trim()

if ($LASTEXITCODE -ne 0) {
  throw 'Não foi possível identificar a branch atual.'
}

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

Invoke-NativeStep 'Atualizando branch sem merge automático' {
  git merge --ff-only "origin/$Branch"
}

if ($Install -or -not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Invoke-NativeStep 'Instalando dependências da aplicação' {
    npm.cmd ci
  }
}

if ($Install -or -not (Test-Path (Join-Path $ProjectRoot 'functions\node_modules'))) {
  Invoke-NativeStep 'Instalando dependências das Functions' {
    npm.cmd --prefix functions ci
  }
}

if ($Validate) {
  try {
    Invoke-NativeStep 'Compilando Functions' {
      npm.cmd run functions:build
    }

    Invoke-NativeStep 'Validando lint completo das Functions' {
      npm.cmd --prefix functions run lint:deploy:all
    }

    Invoke-NativeStep 'Executando testes Angular' {
      npm.cmd run test:ci
    }

    Invoke-NativeStep 'Executando E2E completo de vídeos' {
      npm.cmd run test:media:video:e2e
    }
  } finally {
    if (Test-Path (Join-Path $ProjectRoot 'firestore.rules')) {
      & git restore -- firestore.rules
    }
  }
}

$head = String(& git log -1 --oneline).Trim()
Write-Host "[work:resume] Pronto em: $head" -ForegroundColor Green

$status = @(Get-RepositoryStatus)

if ($status.Count -gt 0) {
  Write-Host '[work:resume] Estado final:' -ForegroundColor Yellow
  $status | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host '[work:resume] Árvore de trabalho limpa.' -ForegroundColor Green
}

if ($Start) {
  Invoke-NativeStep 'Iniciando sessão local Angular + Firebase' {
    npm.cmd run dev:auth:win
  }
}
