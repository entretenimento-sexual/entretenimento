[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Validate,
  [switch]$StartApp,
  [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Branch = 'feat/cache-architecture-foundation'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  & $Command @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "Comando falhou ($LASTEXITCODE): $Command $($Arguments -join ' ')"
  }
}

function Get-NodeMajorVersion {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    return $null
  }

  $major = & node -p "process.versions.node.split('.')[0]"
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  return [int]$major
}

function Enable-PortableNode22 {
  $portableRoot = Join-Path $env:USERPROFILE '.nodes\node-22'

  if (-not (Test-Path $portableRoot)) {
    return $false
  }

  $candidate = Get-ChildItem -Path $portableRoot -Directory -Filter 'node-v22*-win-x64' |
    Sort-Object Name -Descending |
    Select-Object -First 1

  if (-not $candidate) {
    return $false
  }

  $env:Path = "$($candidate.FullName);$env:Path"
  return (Get-NodeMajorVersion) -eq 22
}

Push-Location $RepoRoot

try {
  Write-Step "Verificando repositorio em $RepoRoot"

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git nao foi encontrado no PATH.'
  }

  Invoke-Native git rev-parse --is-inside-work-tree | Out-Null

  $dirty = @(git status --porcelain)
  if ($dirty.Count -gt 0) {
    Write-Host ($dirty -join [Environment]::NewLine) -ForegroundColor Yellow
    throw 'A arvore de trabalho possui alteracoes locais. Salve, faca commit ou stash antes de continuar.'
  }

  if (-not $SkipFetch) {
    Write-Step 'Atualizando referencias remotas'
    Invoke-Native git fetch origin --prune
  }

  Write-Step "Selecionando branch $Branch"

  & git show-ref --verify --quiet "refs/heads/$Branch"
  $localBranchExists = $LASTEXITCODE -eq 0

  if ($localBranchExists) {
    Invoke-Native git switch $Branch
  } else {
    Invoke-Native git switch --track -c $Branch "origin/$Branch"
  }

  Write-Step 'Aplicando somente atualizacao fast-forward'
  Invoke-Native git merge --ff-only "origin/$Branch"

  $currentBranch = (& git branch --show-current).Trim()
  if ($currentBranch -ne $Branch) {
    throw "Branch inesperada apos atualizacao: $currentBranch"
  }

  $head = (& git rev-parse HEAD).Trim()
  Write-Host "Branch: $currentBranch" -ForegroundColor Green
  Write-Host "HEAD:   $head" -ForegroundColor Green

  Write-Step 'Verificando Node.js 22'
  $nodeMajor = Get-NodeMajorVersion

  if ($nodeMajor -ne 22) {
    Write-Host "Node atual: $nodeMajor. Tentando instalacao portatil do usuario..." -ForegroundColor Yellow

    if (-not (Enable-PortableNode22)) {
      throw @'
Node.js 22 nao foi encontrado.
Instale ou extraia a versao 22 em:
  %USERPROFILE%\.nodes\node-22\node-v22.x.x-win-x64
Depois execute este script novamente.
'@
    }
  }

  Write-Host "Node: $(& node --version)" -ForegroundColor Green

  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd nao foi encontrado no PATH apos selecionar Node.js 22.'
  }

  Write-Host "npm:  $(& npm.cmd --version)" -ForegroundColor Green

  if ($Install -or -not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
    Write-Step 'Instalando dependencias pelo package-lock'
    Invoke-Native npm.cmd ci
  }

  if ($Validate) {
    Write-Step 'Executando suite de testes'
    Invoke-Native npm.cmd run test:ci

    Write-Step 'Executando build dev-emu'
    Invoke-Native npm.cmd run build:emu
  }

  if ($StartApp) {
    Write-Step 'Iniciando Angular em configuracao dev-emu'
    Write-Host 'Mantenha este terminal aberto. Use Ctrl+C para encerrar.' -ForegroundColor Yellow
    Invoke-Native npm.cmd run start:emu
  } else {
    Write-Step 'Sessao preparada'
    Write-Host 'Para validar:' -ForegroundColor Green
    Write-Host '  npm.cmd run test:ci'
    Write-Host '  npm.cmd run build:emu'
    Write-Host 'Para iniciar o app:' -ForegroundColor Green
    Write-Host '  npm.cmd run start:emu'
  }
}
finally {
  Pop-Location
}
