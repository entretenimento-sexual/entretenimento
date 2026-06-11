$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

Write-Host "Validando functions..."
npm --prefix functions run build
if ($LASTEXITCODE -ne 0) {
  Write-Error "Build das functions falhou. Corrija antes de commitar."
  exit 1
}

Write-Host "Validando app..."
npm run build:emu
if ($LASTEXITCODE -ne 0) {
  Write-Error "Build do app falhou. Corrija antes de commitar."
  exit 1
}

Write-Host "Verificando alterações..."
git status --short

git add -u

$changes = git diff --cached --name-only
if (-not $changes) {
  Write-Host "Nada para commitar."
  exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "wip: checkpoint $timestamp"

if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha ao criar commit."
  exit 1
}

git push origin main
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha ao enviar para o GitHub."
  exit 1
}

Write-Host "Checkpoint enviado para o GitHub."
