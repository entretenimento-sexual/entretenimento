# Remove SOMENTE referencias remotas antigas do Media.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/cleanup-obsolete-media-branches.ps1
# Exclusao explicita: ... -Execute
# Nao cria branches, PRs, merges, nem altera dados Firebase ou arquivos locais.
param([switch]$Execute)
$ErrorActionPreference = 'Stop'
$expected = [ordered]@{
  'feat/camera-captura-social-fotos-videos-20261028' = '25bbf7609ee85a8b09e29b936fc8adc4ff5f6571'
  'feat/captura-camera-midias-sociais-20261028' = 'ddd5323df2eb8e97e6b724bece5ad86f6526d76d'
  'feat/gestao-fotos-por-publicacoes-20261028' = 'ac3a01e90cdc45434594172b4748717856d07881'
  'feat/photo-legacy-cleanup-readiness-20261029' = '072aa44b82f9701b41e2e43aaafaefc9a4776ed4'
  'feat/photo-owner-gallery-canonical-metadata-20261029' = '8687282e3208696d0e22f19716d4fc1ffa131d80'
  'feat/photo-publication-display-date-20261029' = 'dbfaacde36c65a8f14cedc6b564513c155812f6c'
  'feat/photo-published-replacement-20261029' = 'a3c77ebfccf9c6fa23642a36a4c71e40b61cc6cb'
  'feat/video-friends-authorized-read-20261029' = '2aa711f36211ba86f5525cfc87529c4f9085999c'
  'feat/video-upload-audience-friends-20261028' = '7e17dde150f53aefb4b9624df1f6c1a52fa950b7'
  'fix/galeria-proprietario-publicacoes-canonicas-20261029' = '146e339fb037b84cef088456a96ce02158c91550'
  'fix/galeria-publica-destaque-capa-20261028' = 'f7e677765ff61ce55c14d17f16b575623d9c100c'
  'fix/galerias-somente-publicacoes-20261028' = 'ae5f0451e4ff33fcfb2953e12cf42f768b11e5ac'
  'fix/photo-legacy-origin-preservation-20261029' = '40550c89a8b01f1184e593daee93b41b85e64c0d'
  'fix/photo-replacement-confirm-published-20261029' = '87d3ec313749afd02015560567f3e9f50005a25b'
  'fix/photo-sync-stale-trigger-fence-20261029' = '3842e7b9d90b3ddc30a6f5868c50767241db892c'
  'fix/public-profile-photo-gallery-layout-20261029' = '91e9e3f2cf9808258bffd2b4a1330193e0a4efff'
}
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Push-Location $root
try {
  $current = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $current -ne 'main') {
    throw 'Execute exclusivamente a partir da branch main existente. Nao sera feita troca automatica.'
  }
  $origin = (& git remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0 -or $origin -cnotmatch '^(https://github\.com/entretenimento-sexual/entretenimento(\.git)?|git@github\.com:entretenimento-sexual/entretenimento(\.git)?)$') {
    throw 'O remote origin nao aponta para o repositorio esperado.'
  }
  $mainRemote = & git ls-remote --heads origin main
  if ($LASTEXITCODE -ne 0 -or -not $mainRemote) {
    throw 'Nao foi possivel conferir main remota.'
  }
  $mainSha = (($mainRemote | Select-Object -First 1) -split '\s+')[0]
  if ($mainSha -notmatch '^[0-9a-f]{40}$') {
    throw 'SHA da main invalido.'
  }
  # A main remota deve CONTER o commit de consolidacao certificado.
  # Nao basta o nome main: rejeitar repositorios antigos e historico reescrito.
  & git fetch --no-tags origin main
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel confirmar a historia da main remota.' }
  $consolidated = '34aa901bf3e01b962dd6f7dfe4d459efa81c0da1'
  $history = @(& git log '--format=%H' $mainSha)
  if ($LASTEXITCODE -ne 0 -or $history -notcontains $consolidated) {
    throw 'A main remota nao inclui o commit de consolidacao; nenhuma exclusao permitida.'
  }
  Write-Host "main remota verificada: $mainSha"
  $lines = & git ls-remote --heads origin
  if ($LASTEXITCODE -ne 0) { throw 'Falha na consulta de referencias remotas.' }
  $actual = @{}
  foreach ($line in $lines) {
    if ($line -match '^([0-9a-f]{40})\s+refs/heads/(.+)$') {
      $actual[$Matches[2]] = $Matches[1]
    }
  }
  $pending = @()
  foreach ($name in $expected.Keys) {
    if (-not $actual.ContainsKey($name)) {
      Write-Host "[ja ausente] $name"
      continue
    }
    if ($actual[$name] -ne $expected[$name]) {
      throw "ABORTADO: branch alterada desde a auditoria: $name. Nenhuma exclusao efetuada."
    }
    $pending += $name
  }
  if ($pending.Count -eq 0) {
    Write-Host 'Nenhuma branch obsoleta pendente.'
    exit 0
  }
  Write-Host "Branches auditadas para exclusao: $($pending.Count)"
  $pending | ForEach-Object { Write-Host "  $_" }
  if (-not $Execute) {
    Write-Host 'SIMULACAO. Use -Execute somente depois de revisar a lista. Nao excluiu nada.'
    exit 0
  }
  foreach ($name in $pending) {
    # Verificacao por referencia, novamente, antes da operacao destrutiva.
    $check = & git ls-remote --heads origin $name
    if ($LASTEXITCODE -ne 0) { throw "Falha na reverificacao de $name." }
    $shaNow = if ($check) { (($check | Select-Object -First 1) -split '\s+')[0] } else { '' }
    if ($shaNow -ne $expected[$name]) {
      throw "Interrompido: SHA de $name mudou desde a auditoria."
    }
    & git push origin --delete $name
    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao excluir $name. As anteriores podem ter sido excluidas; reexecute apos revisar."
    }
    Write-Host "[excluida] $name"
  }
  Write-Host 'Limpeza de referencias remotas concluida. A main nao foi modificada.'
} finally {
  Pop-Location
}
