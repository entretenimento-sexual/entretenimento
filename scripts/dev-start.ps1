$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

Write-Host "Atualizando código pelo GitHub..."
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha no git pull. Verifique se há alterações locais ou conflito."
  exit 1
}

Write-Host "Instalando dependências do app..."
npm install
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha no npm install do app."
  exit 1
}

Write-Host "Instalando dependências das functions..."
npm --prefix functions install
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha no npm install das functions."
  exit 1
}

Write-Host "Abrindo VS Code..."
code .
