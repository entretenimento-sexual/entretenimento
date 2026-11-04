#!/usr/bin/env node
// scripts/maintenance/backfill-public-profile-discovery-admin.mjs
// -----------------------------------------------------------------------------
// RETIRADO — Backfill legado de discovery.
//
// A versão anterior escrevia interestedInGenders e interestedInOrientations em
// public_profiles/{uid}, contrariando a fronteira canônica de privacidade.
// O histórico permanece no Git para auditoria, mas nenhuma execução deste
// arquivo pode acessar dados ou escrever no Firestore, mesmo com
// BACKFILL_DRY_RUN=false ou credenciais administrativas disponíveis.
//
// Referências:
// - Issue #236: retenção de dados legados e correção do backfill
// - functions/src/discovery/backfill-public-profile-discovery.handler.ts
// - functions/src/discovery/sync-public-profile-discovery.handler.ts
// - firestore-rules/public_profiles_next.rules
//
// A migração de dados legados depende de checkpoint, conferência de fontes
// privadas e plano de preservação; não reativar esta implementação.
// -----------------------------------------------------------------------------

console.error(
  '[backfill:discovery] BLOQUEADO: script legado desativado por violar a privacidade de public_profiles.'
);
console.error(
  '[backfill:discovery] Nenhum dado foi lido ou alterado. Consulte a Issue #236 e o backfill canônico administrativo.'
);

process.exitCode = 2;
