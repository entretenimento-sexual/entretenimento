[CmdletBinding()]
param(
  [string]$Branch = 'feat/auth-password-recovery-polish',
  [switch]$Start,
  [switch]$Validate
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ExpectedOrigin = 'https://github.com/entretenimento-sexual/entretenimento.git'
$ResumeScript = Join-Path $PSScriptRoot 'resume-work-session.ps1'

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[work:prepare] $Message"
}

function Require-Command {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name nao foi encontrado. $InstallHint"
  }
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Step $Label
  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw "Falha em: $Label (codigo $LASTEXITCODE)."
  }
}

Set-Location $ProjectRoot
Write-Step "Projeto: $ProjectRoot"

Require-Command -Name 'git' -InstallHint 'Instale o Git for Windows pela central de software da empresa.'
Require-Command -Name 'node' -InstallHint 'Instale Node.js 22.x pela central de software da empresa.'
Require-Command -Name 'npm.cmd' -InstallHint 'O npm acompanha a instalacao do Node.js 22.x.'

$nodeVersion = (& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
  throw "Versao do Node incompatível: $nodeVersion. Este projeto exige Node.js 22.x."
}
Write-Step "Node confirmado: $nodeVersion"

$npmVersion = (& npm.cmd --version).Trim()
if ($LASTEXITCODE -ne 0) {
  throw 'Nao foi possivel consultar a versao do npm.'
}
Write-Step "npm confirmado: $npmVersion"

$insideRepository = (& git rev-parse --is-inside-work-tree 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $insideRepository -ne 'true') {
  throw 'A pasta atual nao e um clone Git valido do projeto.'
}

$origin = (& git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or -not $origin) {
  throw 'O remoto origin nao foi encontrado.'
}

$hasEmbeddedCredential =
  $origin -match 'https://[^/@]+@github\.com/' -or
  $origin -match '(ghp_|github_pat_|oauth2:)'

$belongsToProject =
  $origin -match 'github\.com[/:]entretenimento-sexual/entretenimento(?:\.git)?$'

if (-not $belongsToProject) {
  throw "O origin atual aponta para outro repositorio: $origin"
}

if ($hasEmbeddedCredential -or $origin -ne $ExpectedOrigin) {
  Invoke-Native 'Removendo credenciais embutidas da URL do origin' {
    git remote set-url origin $ExpectedOrigin
  }
}

$credentialManagerAvailable = $false
& git credential-manager version *> $null
if ($LASTEXITCODE -eq 0) {
  $credentialManagerAvailable = $true
  Invoke-Native 'Configurando Git Credential Manager' {
    git credential-manager configure
  }
}

if (-not $credentialManagerAvailable) {
  Write-Host '[work:prepare] Git Credential Manager nao foi detectado.' -ForegroundColor Yellow
  Write-Host '[work:prepare] O Git podera abrir o navegador ou solicitar autenticacao no primeiro fetch.' -ForegroundColor Yellow
}

if (-not (Test-Path $ResumeScript)) {
  throw "Script de retomada ausente: $ResumeScript"
}

Write-Step "Preparando branch: $Branch"
& $ResumeScript `
  -Install `
  -Branch $Branch `
  -Start:$Start.IsPresent `
  -Validate:$Validate.IsPresent

if ($LASTEXITCODE -ne 0) {
  throw "A preparacao foi interrompida pelo script de retomada (codigo $LASTEXITCODE)."
}

Write-Step 'Maquina pronta. Nenhum token foi salvo na URL do repositorio.'
