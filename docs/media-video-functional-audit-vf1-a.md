# VF1-A — Fronteira de publicação e quarentena preventiva de vídeos

Data: 2026-10-21. Base: `be88f058065ecd20c7af231f32c0d3c76593eb2c`.

## Correção implementada

- Vídeo novo pode ser processado e a intenção de publicação preservada, mas o
  status de moderação inicial é `PENDING_REVIEW`. `UNASSESSED` continua
  representando uma avaliação de segurança de conteúdo ainda não realizada.
- A publicação grava sua projeção e um relatório
  `moderation_reports` com `reason=preventive_media_review`, no
  **mesmo commit** transacional; o identificador é registrado na
  publicação e na projeção. O relatório é aberto, não aprovado.
- Descoberta, regras Firestore e URL de playback continuam exigindo
  `APPROVED`; `PENDING_REVIEW` não concede acesso público.
- O editor do proprietário preserva o status atual e não converte
  `PRIVATE`, `UNKNOWN` ou `PENDING_REVIEW` em `APPROVED`.
- Chamadas automáticas com quarentena ainda não publicada não podem
  ignorar a restrição; a continuação idempotente de projeções já
  publicadas permanece disponível.
- O callable de normalização legada mantém o contrato de resposta,
  mas não transforma status pendente em aprovado; o effect de migração
  automática do perfil foi desligado para não disparar calls redundantes.
- Uma aprovação `KEEP` para o relatório preventivo exige que a
  referência e ambos os status ainda sejam os da publicação pendente,
  dentro da mesma transação de moderação; não libera versões substituídas.
- O feedback no perfil distingue vídeo recebido de vídeo aprovado.

## Limites

Essa intervenção corrige **somente vídeo**. Fotografias ainda requerem
auditoria separada da política atual. Não equivale a revisão humana
automática nem comprova prontidão do serviço operacional de moderação;
a fila deverá ter responsáveis e capacidade suficientes antes de qualquer
ativação em produção. O relatório contém identificadores de propriedade
apenas na coleção backend de moderação já existente.

Preservados lifecycle de conta, identidade, version fencing, derived assets,
erros centralizados, Observables/RxJS e bloqueios da c19.

Sem deploy, branch, PR, flags, schedulers, TTL, novas consultas Transcoder
ou reabertura da c18x. Homologação e acesso a produção continuam condicionados
a testes, capacidade de moderação e autorização operacional específica.
