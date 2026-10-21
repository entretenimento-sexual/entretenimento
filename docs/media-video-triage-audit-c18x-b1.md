# 1C2-A3b2b2c18x-B1 — Retry administrativo × exclusão de perfil

## Correção

O retry administrativo passa a ler, na mesma transação que substitui
o processingVersion, a fila media_video_deletion_jobs e a identidade
users/{uid}/video_identity_guards/{videoId}. Uma fila existente ou guard
incompatível/RETIRED bloqueia a mutação antes de gerar eventos ou alterar
vídeo privado. Legado sem guard permanece permitido **somente** sem fila
de exclusão, com todas as outras verificações de FAILED, origem e versão.

A proteção exige duas leituras pontuais transacionais por tentativa de
retry administrativo: é um custo de segurança restrito ao fluxo manual,
não uma varredura, scheduler ou consulta ao Transcoder.

## Testes

- Retry confirmado antes da exclusão: versão substituída e cancelada,
  ambos com eventos atômicos, sem reativação por replay tardio.
- Retry real e exclusão em concorrência: o vencedor é serializado pelo
  Firestore; estado final CANCEL_REQUESTED, publicação removida, tombstone
  RETIRED e somente eventos de commits efetivos.
- Casos legados ainda FAILED mas com fila de exclusão ou tombstone RETIRED:
  retry negado mesmo com estado previamente elegível.

Os testes reutilizam a função transacional de produção com Firestore
Emulator e preparação de metadata injetada, sem Storage e sem funções
implantadas.

## Limites

A auditoria é local aos cenários c18x-B1. Não valida cobertura global,
ordenamento total, retenção, custos produtivos ou exclusão da conta.
C18x-B2 deve testar cancelamentos e rechecks administrativos concorrentes.

globalCoverageVerified=false; globallySequenced=false;
productionCostVerified=false; cleanupAuthorized=false.
C19, TTL, consumidor global, deploy e flags seguem bloqueados.
