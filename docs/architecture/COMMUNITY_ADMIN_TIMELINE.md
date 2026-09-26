# Community Admin Timeline

## Objetivo

Disponibilizar para owner/admin uma linha do tempo administrativa legível sem
expor os documentos brutos de auditoria.

A superfície cobre mudanças de papel, bloqueio/desbloqueio/remoção,
aprovação/recusa de entrada, transferência/arquivamento, alterações de
configuração e visibilidade de participação, destaque administrativo,
moderação de conteúdo/tópicos, vínculo oficial e lifecycle.

Nunca entram na projeção: reason de moderação, evidência, KYC/KYB, resolução
interna, IDs de conteúdo ou payloads arbitrários. UID interno existe somente na
projeção privada para resolução server-side de nomes e não é retornado pela
callable.

## Fluxo

1. Operações existentes continuam produzindo audits canônicos.
2. Triggers onDocumentCreated aceitam somente ações explicitamente whitelisted,
   incluindo community_official_claim_audit e community_official_association_audit.
3. O evento seguro vai para community_admin_timeline/{communityId}/items.
4. Firestore Rules negam leitura e escrita client-side.
5. getCommunityAdminTimeline valida App Check e contexto social existente.
6. Somente owner/admin recebem o DTO sanitizado, com nomes resolvidos no backend.

## Exclusões intencionais

A timeline é de gestão, não um espelho do audit bruto. Ficam fora por decisão:

- criação autoral de posts, comentários, respostas e tópicos;
- reactions e ações ordinárias de membros;
- envio/aceite/recusa/revogação de convites, para evitar ruído operacional;
- preferência individual de visibilidade do próprio membro;
- community_ranking_mode_audit, reservado a operações da plataforma;
- business_official_entitlement_usage_audit, por conter estado comercial interno;
- community_purge_audit, que permanece como recibo operacional de destruição;
- eventos duplicados de criação/associação oficial quando a mesma transição já
  é representada pelo fluxo de claim oficial.

Essas exclusões são deliberadas e devem continuar fail-closed: evento novo não
entra na timeline até ser explicitamente whitelisted e sanitizado.

## Backfill

scripts/maintenance/backfill-community-admin-timeline-admin.mjs é dry-run por
padrão e idempotente. O dry-run pode inventariar todas as fontes e reporta
contagens separadas por fonte. Escrita real exige:

- COMMUNITY_ADMIN_TIMELINE_DRY_RUN=false
- COMMUNITY_ADMIN_TIMELINE_CONFIRM=true
- COMMUNITY_ADMIN_TIMELINE_SOURCE=<fonte>

A execução real é obrigatoriamente feita uma fonte por vez. O limite
COMMUNITY_ADMIN_TIMELINE_MAX_AUDITS_PER_SOURCE controla o teto de leitura de
cada rodada. Não executar o backfill real antes dos triggers estarem publicados
e estabilizados.

## Ordem futura de produção

Nenhuma etapa abaixo deve ser executada até a plataforma estar madura e houver
autorização explícita para produção.

1. Congelar o SHA aprovado e executar validate:prod, testes de Functions, Rules
   e build Angular.
2. Publicar Firestore Rules com o deny explícito da projeção.
3. Publicar somente os oito triggers syncCommunityAdminTimeline*.
4. Validar eventos sintéticos controlados em staging.
5. Publicar getCommunityAdminTimeline.
6. Smoke test owner/admin e negação para moderator/member.
7. Rodar backfill em dry-run e revisar contagens por fonte.
8. Rodar backfill real em lotes pequenos, observando leituras/escritas.
9. Publicar Hosting com a aba de histórico administrativo.
10. Observar logs, taxa de erro, latência e custo antes de ampliar o backfill.

## Rollback

- UI: reverter Hosting; a projeção continua privada e inerte.
- Callable: rollback/remover getCommunityAdminTimeline.
- Triggers: rollback dos oito syncCommunityAdminTimeline*; audits originais
  continuam intactos.
- Backfill: a coleção é derivada; corrigir a policy e reconstruir apenas a
  projeção afetada.
- Rules: manter o deny durante qualquer rollback.

## Smoke tests obrigatórios

- owner vê timeline e paginação;
- admin vê timeline;
- moderator/member recebe permission-denied;
- cliente Firestore direto não lê/lista/escreve a projeção;
- promoção/rebaixamento mostra papéis anterior/novo;
- bloqueio/desbloqueio/remoção não mostra motivo interno;
- configuração mostra somente nomes dos campos alterados;
- alteração de visibilidade de participação aparece como configuração;
- pin/unpin de destaque aparece sem targetId ou duração;
- moderação mostra apenas o tipo do alvo, sem IDs/reason;
- vínculo oficial mostra somente a transição de status;
- evento não-whitelisted não aparece;
- cursor não duplica nem perde eventos com timestamp igual;
- conta removida aparece como Conta indisponível, sem UID.
