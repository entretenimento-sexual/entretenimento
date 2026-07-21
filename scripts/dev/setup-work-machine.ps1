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

function Get-NodeVersion {
  param([Parameter(Mandatory = $true)][string]$Executable)

  try {
    $version = (& $Executable --version 2>$null).Trim()
    if ($LASTEXITCODE -eq 0 -and $version -match '^v\d+\.\d+\.\d+$') {
      return $version
    }
  } catch {
    return $null
  }

  return $null
}

function Find-PortableNode22 {
  $searchRoots = [System.Collections.Generic.List[string]]::new()

  if ($env:NODE22_HOME) {
    $searchRoots.Add($env:NODE22_HOME)
  }

  if ($env:USERPROFILE) {
    $searchRoots.Add((Join-Path $env:USERPROFILE '.nodes\node-22'))
    $searchRoots.Add((Join-Path $env:USERPROFILE 'AppData\Roaming\nvm'))
  }

  $candidates = foreach ($root in ($searchRoots | Select-Object -Unique)) {
    if (-not (Test-Path $root)) {
      continue
    }

    $directories = @((Get-Item $root)) + @(
      Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue
    )

    foreach ($directory in $directories) {
      $nodeExecutable = Join-Path $directory.FullName 'node.exe'
      $npmExecutable = Join-Path $directory.FullName 'npm.cmd'

      if (-not (Test-Path $nodeExecutable) -or -not (Test-Path $npmExecutable)) {
        continue
      }

      $versionText = Get-NodeVersion -Executable $nodeExecutable
      if (-not $versionText -or $versionText -notmatch '^v22\.') {
        continue
      }

      [PSCustomObject]@{
        Directory = $directory.FullName
        Node = $nodeExecutable
        Npm = $npmExecutable
        Version = [version]$versionText.TrimStart('v')
        VersionText = $versionText
      }
    }
  }

  return $candidates |
    Sort-Object -Property Version -Descending |
    Select-Object -First 1
}

function Select-Node22 {
  $currentNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  $currentVersion = if ($currentNode) {
    Get-NodeVersion -Executable $currentNode.Source
  } else {
    $null
  }

  if ($currentVersion -match '^v22\.') {
    $currentNpm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue

    return [PSCustomObject]@{
      Directory = Split-Path $currentNode.Source -Parent
      Node = $currentNode.Source
      Npm = if ($currentNpm) { $currentNpm.Source } else { $null }
      VersionText = $currentVersion
      Portable = $false
    }
  }

  if ($currentVersion) {
    Write-Step "Node atual: $currentVersion. Procurando Node 22 local."
  } else {
    Write-Step 'Node global nao encontrado. Procurando Node 22 local.'
  }

  $portableNode = Find-PortableNode22
  if (-not $portableNode) {
    $detected = if ($currentVersion) { $currentVersion } else { 'nao encontrado' }
    throw "Versao do Node incompativel: $detected. Instale Node.js 22.x ou disponibilize uma copia portatil em %USERPROFILE%\.nodes\node-22."
  }

  $env:Path = "$($portableNode.Directory);$env:Path"
  $env:NODE_HOME = $portableNode.Directory

  return [PSCustomObject]@{
    Directory = $portableNode.Directory
    Node = $portableNode.Node
    Npm = $portableNode.Npm
    VersionText = $portableNode.VersionText
    Portable = $true
  }
}

Set-Location $ProjectRoot
Write-Step "Projeto: $ProjectRoot"

Require-Command -Name 'git' -InstallHint 'Instale o Git for Windows pela central de software da empresa.'

$selectedNode = Select-Node22
if ($selectedNode.Portable) {
  Write-Step "Node 22 portatil selecionado: $($selectedNode.Node)"
  Write-Step 'A selecao vale somente para este processo; o Node global permanece inalterado.'
}

$nodeVersion = Get-NodeVersion -Executable $selectedNode.Node
if (-not $nodeVersion -or $nodeVersion -notmatch '^v22\.') {
  throw "Falha ao ativar Node.js 22.x. Versao detectada: $nodeVersion"
}
Write-Step "Node confirmado: $nodeVersion"

$npmExecutable = $selectedNode.Npm
if (-not $npmExecutable -or -not (Test-Path $npmExecutable)) {
  $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
  $npmExecutable = if ($npmCommand) { $npmCommand.Source } else { $null }
}

if (-not $npmExecutable -or -not (Test-Path $npmExecutable)) {
  throw 'npm.cmd nao foi encontrado na instalacao selecionada do Node.js 22.x.'
}

$npmVersion = (& $npmExecutable --version).Trim()
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

$resumeParameters = @{
  Install = $true
  Branch = $Branch
}

if ($Start.IsPresent) {
  $resumeParameters['Start'] = $true
}

if ($Validate.IsPresent) {
  $resumeParameters['Validate'] = $true
}

Write-Step "Preparando branch: $Branch"
& $ResumeScript @resumeParameters

if (-not $?) {
  throw 'A preparacao foi interrompida pelo script de retomada.'
}

Write-Step 'Maquina pronta. Nenhum token foi salvo na URL do repositorio.'
