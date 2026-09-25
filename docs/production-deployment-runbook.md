# Runbook de implantação de produção

> **Estado:** PREPARADO / EXECUÇÃO BLOQUEADA.
>
> Este documento descreve a implantação de produção da plataforma `entretenimento`.
> Ele **não autoriza deploy**. A execução só pode começar quando a plataforma inteira
> tiver passado pelos gates de maturidade e houver decisão explícita de GO.
>
> Projeto Firebase/GCP de produção: `entretenimento-sexual`.
>
> Regra principal do primeiro rollout controlado: **não usar `npm run deploy:prod`**.
> Esse script continua útil como validação/atalho futuro, mas atualmente agrega
> Hosting, Firestore Rules, índices, Storage e todas as Functions em uma única
> operação. O rollout inicial deve ser seletivo e reversível por ondas.

## 1. Objetivos do rollout

A implantação deve:

- preservar compatibilidade com o cliente que já estiver publicado durante toda a janela;
- instalar dependências antes dos consumidores;
- implantar writers/triggers canônicos antes dos backfills que dependem deles;
- concluir backfills obrigatórios antes de publicar um frontend que pressuponha as novas projeções;
- manter Functions legadas necessárias para rollback até o fim do período de estabilização;
- publicar o frontend por último;
- permitir interrupção entre ondas sem deixar a plataforma num estado incoerente;
- evitar qualquer alteração de preço, ranking, thresholds de custo ou política comercial durante a mesma janela;
- evitar mudanças destrutivas de dados na janela principal.

## 2. Gates de maturidade — todos obrigatórios

A janela permanece **NO-GO** enquanto qualquer item abaixo estiver pendente.

1. O SHA de release está fixado, sem alterações posteriores.
2. Quality Gate e Angular CI estão verdes para o SHA de release.
3. `npm run validate:prod` passa no mesmo SHA.
4. O mesmo SHA foi ensaiado integralmente em staging, incluindo Functions,
   Rules, Storage, Hosting e os backfills aplicáveis.
5. App Check de produção está validado por `appcheck:prod:check`.
6. Web Push de produção está validado por `webpush:prod:check`.
7. `functions:exports:check` confirma o artefato compilado que o Firebase
   realmente carregará.
8. Firestore Rules tests estão verdes e foi feita a classificação de cada
   mudança de Rules como **compatível** ou **restritiva** para o cliente atual.
9. Todos os novos índices necessários foram identificados.
10. Existe um baseline real de custo/latência/erros de pelo menos 14 dias para
    as superfícies que serão monitoradas; thresholds não são recalibrados por intuição.
11. Alertas de custo e operacionais estão ativos e com canal de notificação testado.
12. Existe export recente do Firestore e foram registrados os SHAs/configurações
    atualmente implantados de Hosting, Functions, Rules e Storage.
13. O rollback SHA foi testado/buildado e permanece disponível.
14. Não há migração destrutiva pendente sem plano reverso específico.
15. Cobrança recorrente real só entra na janela se sua readiness de produção
    estiver aprovada separadamente. Caso contrário, Functions/rotas de billing
    existentes permanecem sem ativação de webhook recorrente de produção.
16. Não há PR crítica pendente que altere contratos de dados, Rules, Functions
    ou frontend do mesmo domínio.

## 3. Preparação da release

Criar uma tag/registro imutável para o SHA aprovado e registrar:

- `RELEASE_SHA`;
- `ROLLBACK_SHA` (último release comprovadamente estável);
- versão do Node: 22;
- versão da Firebase CLI;
- projeto ativo;
- lista das Functions atualmente implantadas;
- lista das Functions que serão alteradas;
- Rules/Storage atuais;
- índices atuais e estado de construção;
- configuração dos schedulers/event triggers;
- configuração do webhook de billing, sem imprimir segredos;
- estado dos alertas e dashboards.

Validação local/CI obrigatória:

```powershell
npm ci
npm --prefix functions ci
npm run validate:prod
npm run functions:exports:check
```

Antes de qualquer escrita em produção, conferir explicitamente o projeto:

```powershell
firebase use
firebase projects:list
firebase functions:list --project entretenimento-sexual
```

Não prosseguir se o contexto autenticado ou o project ID forem diferentes do
esperado.

## 4. Backup e snapshots

Antes de T0:

- criar export do Firestore para bucket de backup previamente validado;
- registrar a release atual do Hosting;
- guardar o `ROLLBACK_SHA`;
- salvar uma cópia versionada das Rules/Storage Rules e índices do rollback;
- registrar lista e região das Functions;
- registrar jobs do Cloud Scheduler e event triggers relevantes;
- registrar configuração do webhook de cobrança se billing fizer parte da janela.

Exemplo de export, usando um bucket já criado e autorizado:

```powershell
gcloud firestore export gs://<BACKUP_BUCKET>/<RELEASE_ID> --project=entretenimento-sexual
```

Um export não deve ser tratado como mecanismo automático de rollback. Importar
um snapshot completo depois de a plataforma receber novas escritas pode apagar
dados válidos posteriores. Em caso de corrupção, a recuperação de dados exige
decisão separada e escopo mínimo.

## 5. Estratégia de compatibilidade de Firestore Rules

Índices e Rules têm tratamento diferente.

### Índices

Implantar **antes** das Functions/clientes que dependem deles:

```powershell
firebase deploy --only firestore:indexes --project entretenimento-sexual
```

A próxima onda só começa depois que todos os índices novos necessários estiverem
em estado READY. Índices extras não são removidos durante a janela de rollback.

### Rules

Cada diff de Rules deve ser classificado:

- **aditivo/compatível:** pode ser implantado antes do novo cliente;
- **restritivo:** não pode quebrar a versão de frontend ainda servida;
- **incompatível com cliente anterior:** deve ser dividido em duas releases
  (compatibilidade primeiro, tightening depois da adoção do frontend novo).

No rollout principal, preferir:

1. Functions/backend compatíveis;
2. backfills;
3. Rules/Storage compatíveis com cliente antigo e novo;
4. Hosting novo;
5. tightening final somente em release posterior, se necessário.

Isso reduz o risco de uma Rule nova derrubar clientes ainda em cache/CDN.

## 6. Ordem das Functions

Nunca implantar todas as Functions apenas por conveniência. Gerar o conjunto real
a partir do diff `ROLLBACK_SHA..RELEASE_SHA`, do artefato compilado e de
`firebase functions:list`. Usar seletores explícitos:

```powershell
firebase deploy --only functions:<fn1>,functions:<fn2> --project entretenimento-sexual
```

### Onda F1 — autoridade e projeções fundamentais

Primeiro os writers/autoridades que tornam os dados novos canônicos.

**Maioridade/compliance**, quando alterados na release:

- `processAgeVerificationProviderAssertion`;
- `expireAgeEligibilityAtBoundary`;
- `scheduleAgeEligibilityExpirationTask`;
- `expireAgeEligibilityRecords`;
- `refreshMyAgeEligibility`;
- callables de verificação/reverificação/moderação etária afetadas pelo diff.

**Discovery/projeções públicas**, quando alterados:

- `initializePublicAgeEligibilityProjection`;
- `syncPublicAgeEligibilityProjection`;
- `syncPublicProfileDiscovery`;
- `syncPublicPreferenceProjectionTrigger`.

**Billing/entitlement:** só se a readiness de billing estiver aprovada. Implantar
writers/entitlements antes dos consumidores. A configuração/ativação do webhook
recorrente Asaas é uma ação separada e permanece bloqueada sem GO específico.

Gate F1: logs sem erro anômalo, projeções de teste convergindo e nenhum aumento de
permission-denied/unauthenticated para fluxos válidos.

### Onda F2 — triggers/projeções de Comunidades

Implantar antes dos backfills que dependem deles:

- `syncCommunityNotificationSummaryTrigger`;
- `syncCommunityFeedRealtimeTrigger`;
- `reconcileCommunityMembershipNotificationsTrigger`;
- `syncCommunityProfileMembershipIndexTrigger`;
- `syncCommunityHighlightCommunityTrigger`;
- `syncCommunityArchiveProjections`;
- `syncCommunityOfficialAssociation`;
- `syncCommunityOfficialAssociationLifecycle`;
- `syncCommunityFeedActivity`;
- `syncCommunityHighlightTarget`;
- `syncCommunityMembershipActivity`;
- `syncCommunityRankingFromCommunity`;
- `syncCommunityRankingFromDiscovery`;
- `syncCommunityUserIndex`;
- `syncVenuePublicLocation`;
- `syncCommunityCapacityRegularization`;
- `syncCommunityMemberManagementIndex`;
- `syncCommunityMemberManagementIndexFromUser`;
- `syncCommunityMemberSearchIndex`;
- `syncCommunityMemberSearchIndexFromPublicProfile`.

Os aliases com sufixo `Trigger` existem deliberadamente porque produção pode
conter Functions HTTPS legadas sob o nome antigo. **Não apagar os exports legados
na mesma onda.** O retiro desses endpoints é uma etapa posterior, após
estabilização e confirmação de que não recebem tráfego.

Gate F2: eventos novos atualizam as projeções esperadas; não há loop de trigger,
duplicidade de notificação nem explosão de writes.

### Onda F3 — callables/commands e leituras de Comunidades

Depois das projeções básicas, implantar apenas os handlers alterados da release,
incluindo, conforme o diff:

- criação/capability;
- discovery/Explore;
- Mural e realtime;
- comentários/respostas/reactions/moderação;
- Discussões/Tópicos;
- membership, convites e roster;
- `searchCommunityMembersPage`, quando a busca interna de membros fizer parte do diff;
- busca/filtros administrativos de membros;
- ownership/arquivamento e busca/shortlist de sucessão;
- associação Official;
- notificações/preferências;
- gestão e leitura de Communities/Profiles.

A regra é não publicar no frontend uma chamada que ainda não esteja presente e
smoke-tested no backend.

### Onda F4 — schedules/lifecycles

Schedules entram depois dos writers/triggers que recebem seus efeitos:

- `runCommunityLifecycle`;
- `runCommunityOfficialAssociationLifecycle`;
- `runCommunityPurge`;
- `runCommunityRanking`;
- `runCommunityDiscoveryExposureRetention`;
- `runCommunityExploreContentRetention`;
- `runCommunityBoostLifecycle`;
- reconciliadores periódicos de billing, se billing estiver aprovado.
- reconciliador de suspensão moderada temporária
  (`reconcileModerationSuspensions`) somente depois do índice
  `users(accountStatus, suspensionEndsAt, __name__)` estar READY;

Jobs destrutivos/retention/purge não devem ser o primeiro evento executado por
uma nova versão. Confirmar configuração, elegibilidade e dry-run/inspection
quando houver.

### Onda F5 — demais domínios alterados

Media, chat, friendship, account lifecycle, notifications e subscriber
experiences são implantados seletivamente depois das dependências transversais
que consumirem. Não redeployar domínio sem diff somente para “uniformizar” a
release.

### Regra específica — kernel `Community × Local`

A refatoração do kernel `social-space`, quando o diff estiver limitado a
`src/app/core/domain/social-space.definition.ts`,
`src/app/community/**` e testes/documentação de frontend, é **client-only**:

- a lista de Functions desta mudança deve ser vazia;
- não há backfill;
- não há alteração de Firestore Rules, Storage Rules ou índices;
- não há migração de dados;
- não há mudança de entitlement, pricing, ownership ou capacidade;
- `official_space` permanece somente como alias de compatibilidade no backend
  e não deve ser transportado para a UI.

Nesse caso, não redeployar Functions por conveniência. O kernel entra somente na
onda de Hosting, que continua sendo a última onda do rollout geral. Se o
`RELEASE_SHA` futuro também contiver mudanças reais de Functions, aplicar F1–F5
normalmente para **essas** mudanças antes de publicar o Hosting.

## 7. Migrações/backfills — ordem e gates

Todos os backfills são executados **depois do runtime que manterá o estado novo**
e **antes do frontend que pressupõe a migração concluída**.

### B1 — projeção pública de maioridade

Se a auditoria indicar projeções antigas sem o campo canônico:

1. rodar `backfill-public-age-eligibility-projection-admin.mjs` em dry-run;
2. conferir cobertura e truncamento;
3. somente após aprovação, usar `AGE_PROJECTION_DRY_RUN=false` e
   `AGE_PROJECTION_APPLY=true`;
4. validar amostra e contagens.

A fonte é exclusivamente `age_eligibility_records/{uid}`.

### B2 — tarefas de expiração etária

Somente depois de `expireAgeEligibilityAtBoundary` estar implantada:

1. dry-run de `backfill-age-expiration-tasks-admin.mjs`;
2. revisar volume e checkpoints;
3. aplicação exige `AGE_EXPIRATION_TASK_DRY_RUN=false` e
   `AGE_EXPIRATION_TASK_APPLY=true`.

### B3 — resumo global de notificações de Comunidades

Este é gate obrigatório antes do frontend que usa a projeção global v2.

1. `syncCommunityNotificationSummaryTrigger` já deve estar implantada;
2. rodar `npm run maintenance:community-notification-global-summary` com
   `COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_DRY_RUN=true`;
3. confirmar `scanComplete=true` e ausência de truncamento;
4. para aplicar:
   - `COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_DRY_RUN=false`;
   - `COMMUNITY_NOTIFICATION_GLOBAL_BACKFILL_CONFIRM=true`;
5. repetir validação pós-escrita;
6. só então liberar o frontend dependente.

O backfill legado que “toca” notificações para gerar summaries por Comunidade
(`scripts/maintenance/backfill-community-notification-summaries-admin.mjs`)
não faz parte automaticamente desta release. Ele só deve ser usado se auditoria
mostrar lacunas nessa geração anterior, em uma ação explicitamente aprovada.

### B4 — conteúdo comunitário elegível no Explore

Somente depois do runtime novo:

1. dry-run de `npm run maintenance:community-explore-content`;
2. conferir número de Comunidades/posts varridos, elegíveis e qualquer truncamento;
3. aplicação exige:
   - `COMMUNITY_EXPLORE_CONTENT_BACKFILL_DRY_RUN=false`;
   - `COMMUNITY_EXPLORE_CONTENT_BACKFILL_CONFIRM=true`;
4. validar que o índice contém apenas conteúdo elegível/sanitizado;
5. somente depois publicar o frontend que distribui esse conteúdo.

### B5 — regularização de capacidade/ownership

Somente depois de `syncCommunityCapacityRegularization`:

1. dry-run de `npm run maintenance:community-capacity-regularization`;
2. conferir owners deduplicados e ações previstas;
3. aplicação exige:
   - `COMMUNITY_CAPACITY_REGULARIZATION_DRY_RUN=false`;
   - `COMMUNITY_CAPACITY_REGULARIZATION_CONFIRM=true`.

Esse processo **não** transfere ownership, não arquiva Comunidades e não remove
memberships.

### B6 — discovery legado, se necessário

Usar o runner administrativo
`scripts/maintenance/backfill-public-profile-discovery-admin.mjs` somente se a
auditoria apontar perfis ainda não migrados. Ele usa dry-run por padrão e escrita
real exige `BACKFILL_CONFIRM_WRITE=YES`.

### B7 — cleanup de `ageVerification`

Não é parte do rollout normal. É uma operação destrutiva separada, ainda que
limitada ao campo legado. Só pode ocorrer após novo dry-run e GO específico.
Execução real exige `LEGACY_AGE_CLEANUP_CONFIRM=true`.

### B8 — índice administrativo de membros/sucessão

Somente quando a release contiver busca server-side de membros e sucessores:

1. publicar os índices de `community_member_management_index` em T0 e
   aguardar todos ficarem `READY`;
2. implantar `syncCommunityMemberManagementIndex` e
   `syncCommunityMemberManagementIndexFromUser` na F2;
3. rodar `npm run maintenance:community-member-management-index` com
   `COMMUNITY_MEMBER_MANAGEMENT_INDEX_DRY_RUN=true`;
4. revisar `scannedCommunities`, `scannedMemberships`, `projected`,
   `skipped`, `failures`, qualquer truncamento e também:
   - `searchPrefixCompositeIndexCount`;
   - `averageSearchPrefixesPerProjection`;
   - `maxSearchPrefixesPerProjection`;
   - `estimatedSearchPrefixCompositeEntries`;
   a escrita real deve ser abortada se a amplificação projetada ficar fora do
   baseline/orçamento aprovado para a release;
5. escrita real exige simultaneamente:
   - `COMMUNITY_MEMBER_MANAGEMENT_INDEX_DRY_RUN=false`;
   - `COMMUNITY_MEMBER_MANAGEMENT_INDEX_CONFIRM=true`;
6. somente depois do backfill verde implantar em F3 as versões consumidoras de
   `getCommunityMembersForManagement` e
   `getCommunityOwnershipCandidatesPage`;
7. Hosting com busca/filtros permanece depois de F3 e Rules.

A projeção é derivada e descartável. O backfill **não** altera membership,
papel, elegibilidade, ownership, capacidade ou billing.


### B9 — índice de busca interna de membros

Somente quando a release contiver a busca interna de membros:

1. publicar o índice de `community_member_search_index` em T0 e aguardar
   estado `READY`;
2. implantar `syncCommunityMemberSearchIndex` e
   `syncCommunityMemberSearchIndexFromPublicProfile` na F2;
3. rodar `npm run maintenance:community-member-search-index` com
   `COMMUNITY_MEMBER_SEARCH_INDEX_DRY_RUN=true`;
4. revisar `scannedCommunities`, `scannedMemberships`, `projected`,
   `skipped`, `failures`, truncamento e também:
   - `searchPrefixCompositeIndexCount`;
   - `averageSearchPrefixesPerProjection`;
   - `maxSearchPrefixesPerProjection`;
   - `estimatedSearchPrefixCompositeEntries`;
   a escrita real deve ser abortada se a amplificação de índice/writes ficar
   fora do baseline/orçamento aprovado;
5. a aplicação real exige simultaneamente:
   - `COMMUNITY_MEMBER_SEARCH_INDEX_DRY_RUN=false`;
   - `COMMUNITY_MEMBER_SEARCH_INDEX_CONFIRM=true`;
6. validar amostras garantindo que somente nickname/profileId públicos estejam
   presentes e que nenhum campo de `users/{uid}` tenha sido projetado;
7. somente depois do backfill verde implantar `searchCommunityMembersPage` em
   F3;
8. publicar Rules compatíveis mantendo
   `community_member_search_index` backend-only;
9. Hosting com o campo de busca permanece por último.

A projeção é derivada e descartável. Ela nunca concede acesso e nunca substitui
a revalidação de membership, maioridade pública ou bloqueio bilateral. Rollback
não deve alterar memberships nem apagar o índice durante a janela emergencial.

Tópicos/Discussões permanecem fora deste rollout enquanto o gate canônico de
produto estiver congelado. A busca interna de membros não autoriza nem reativa
Tópicos.

## 8. Firestore Rules e Storage Rules

Depois das Functions/backfills e antes do Hosting:

```powershell
npm run rules:build
npm run rules:check
npm run test:rules
```

Se o diff estiver classificado como compatível:

```powershell
firebase deploy --only firestore:rules,storage --project entretenimento-sexual
```

Smoke test imediatamente os acessos públicos, autenticados, owner/admin e
bloqueios esperados. Qualquer regressão de autorização interrompe a janela.

## 9. Hosting — sempre por último

Somente quando backend, projeções, índices e Rules estiverem estáveis:

```powershell
npm run build:prod
firebase deploy --only hosting --project entretenimento-sexual
```

Após publicação, validar tanto navegação nova quanto refresh/deep links, além de
uma sessão já aberta antes do deploy para detectar incompatibilidades de cache.

### 9.1 — classificação do delta de janela limitada de DOM

A limitação de DOM de Discovery/Mural é um delta de frontend. Isoladamente, ela
não exige alteração de Functions, Firestore Rules, Storage Rules, índices,
schedulers, backfill ou migração de dados. O page size de backend permanece o
mesmo; apenas a quantidade de cards/posts simultaneamente montados no DOM é
limitada.

Portanto, **se este delta for isolado em uma release própria**, a implantação é
Hosting-only depois dos gates normais de build/test/staging. O rollback também é
Hosting-only, reconstruindo o `ROLLBACK_SHA`.

Esta classificação não pode ser extrapolada para o branch inteiro. Antes da
release real, o diff `ROLLBACK_SHA..RELEASE_SHA` continua sendo a autoridade
para decidir F1–F5, Rules, índices e backfills. Nunca redeployar Functions sem
mudança apenas porque o frontend foi alterado.

## 10. Smoke tests de produção

Usar contas de teste designadas e dados não sensíveis. Não provocar cobrança
real nem operações destrutivas apenas para smoke test.

### S0 — infraestrutura

- app carrega sem erro de bootstrap;
- Auth e sessão existentes funcionam;
- App Check não bloqueia tráfego válido;
- não há pico inesperado de 4xx/5xx, retries ou invocações;
- Rules não geram permission-denied em operações legítimas;
- logs não exibem dados técnicos/sensíveis ao usuário.

### S1 — maioridade/compliance

- usuário elegível acessa superfícies adultas;
- usuário sem autoridade etária não obtém acesso por campos client-authoritative;
- consentimento adulto continua separado da prova etária;
- reverificação/contestação mantém o fluxo esperado;
- denúncia de possível menoridade e notificações associadas continuam operacionais.

### S2 — Perfis + canonização de erros

- `/perfil` carrega perfil próprio;
- perfil alheio redireciona/abre a superfície pública correta;
- Comunidades embutidas nos perfis carregam sem tratamento de erro divergente;
- falha benigna/esperada apresenta mensagem pelo pipeline
  `ApplicationErrorService`, sem toast duplicado;
- warning/success continuam passando pelo `ErrorNotificationService`;
- navegação para perfil inexistente/indisponível não expõe erro técnico.

### S3 — Explore

- feed inicial e paginação;
- perfis compatíveis;
- fotos/vídeos e viewer;
- publicação de foto por conta de teste, se autorizado;
- “Atividade nas suas Comunidades”;
- “Comunidades para você”;
- conteúdo comunitário distribuído;
- exposures/opens sem duplicação anômala;
- degradação de conteúdo opcional não derruba a página.

### S4 — Comunidades

- discovery e cache/paginação;
- preview/deep links;
- Mural, comentários, respostas, reactions e moderação;
- Discussões: lista, detalhe, resposta e moderação, somente quando o gate canônico do produto estiver habilitado;
- membership, solicitações e convites;
- roster e gestão;
- busca interna de membros por nickname público, com mínimo de 2 caracteres,
  paginação backend e sem filtragem client-side;
- busca por nickname com acento deve funcionar com termo equivalente sem acento;
- nome civil/privado que não seja o nickname público não pode produzir resultado;
- visitante, membership pendente ou bloqueada não pode enumerar integrantes;
- bloqueio bilateral remove o alvo dos resultados;
- mudança de nickname público converge para o índice sem alterar membership;
- cursor adulterado ou pertencente a outra consulta é rejeitado com erro seguro;
- estado sem resultado não é tratado como falha;
- rate limit da busca usa apresentação canônica e não expõe termo pesquisado em log;
- em Comunidade sintética com 500+ membros, busca administrativa por nome/apelido sem scan
  client-side, filtro por papel, combinação busca+papel e paginação sem
  duplicação/omissão;
- bloqueados preservam filtro pelo papel anterior quando disponível;
- ownership abre shortlist de admins/moderadores, permite ampliar para todos os
  elegíveis e pesquisar no servidor;
- candidato que perde papel/elegibilidade entre listagem e confirmação é
  recusado pela revalidação canônica;
- ownership/transfer/archive sem transferência automática indevida;
- Official/Business respeitando autoridade e entitlement;
- capacidade/regularização;
- notificações/unread global e detalhe paginado;
- bloqueio bilateral em leitura/interação;
- sponsored/Boost sem herdar dívida entre proprietários.

### S4.1 — kernel Community × Local

Além do smoke geral de Comunidades:

- abrir `/dashboard/comunidades` e `/dashboard/locais` por navegação e deep link;
- confirmar que cards de Local continuam retornando para `/dashboard/locais`;
- confirmar que “Minhas comunidades”, filtros por interesse, Discussões,
  Membros, busca de membros, regras, lifecycle, capacidade, ownership e moderação aparecem apenas
  quando a capability correspondente estiver habilitada;
- confirmar que Local mantém “Seguir”, “Solicitar acesso”, “Novidades”,
  localização pública e vínculo com Comunidade oficial;
- confirmar que owner de Local aparece como “Responsável” e owner de Comunidade
  como “Proprietário”;
- confirmar que feed/fotos, solicitações e saída preservam comportamento e
  mensagens sem branches literais na view;
- confirmar que nenhuma superfície de Room foi reativada;
- confirmar que nenhum texto/estado `official_space` aparece no frontend.

Para uma release que contenha somente esta refatoração, rollback operacional é
rebuild/redeploy do Hosting a partir do `ROLLBACK_SHA`; não há rollback de
Functions, Rules, índices ou dados associado a este delta.

### S4.2 — sessões longas / janela limitada de DOM

Executar com massa de teste suficiente para ultrapassar seis páginas sem alterar
o page size canônico:

- Discovery: carregar mais de 72 cards e confirmar que no máximo 72
  `.community-card-shell` orgânicos permanecem montados simultaneamente;
- Mural: carregar mais de 60 posts e confirmar que no máximo 60
  `.community-post` permanecem montados simultaneamente;
- confirmar que “Ver anteriores/Ver seguintes” e
  “Mais recentes/Mais antigas” navegam apenas por conteúdo já carregado e não
  disparam nova chamada de paginação;
- confirmar que a chamada ao backend ocorre somente quando o usuário alcança a
  borda final carregada e aciona o “Ver mais” canônico;
- em cada append e troca de janela, medir visualmente/por teste automatizado que
  a âncora de leitura preserva sua posição no viewport, sem salto perceptível;
- com o Mural numa janela antiga, receber novos posts realtime: a leitura não
  deve ser puxada para o topo; o indicador de novas publicações deve aparecer;
- acionar o indicador de novidades e confirmar retorno ao topo, foco/highlight e
  comportamento de `prefers-reduced-motion`;
- navegar por uma resposta/highlight para um post já carregado, porém fora da
  janela atual: a janela deve revelá-lo antes de foco/highlight, sem nova
  hidratação desnecessária;
- publicar um post próprio enquanto estiver numa janela antiga e confirmar que o
  post criado é revelado sem consumir/ocultar novidades externas pendentes;
- abrir comentários/menus, avançar a janela e retornar, confirmando que não há
  foco órfão, menu preso ou erro de acessibilidade;
- em “Minhas comunidades”, alterar busca/filtro depois de muitas páginas
  carregadas: a janela deve reiniciar no começo do recorte filtrado sem perder
  o conjunto carregado no estado;
- recarregar/reentrar no Discovery após uma sessão longa e confirmar que o cache
  continua preservando paginação/itens já carregados conforme o contrato atual;
  o limite de 72 é de DOM, não de cache.

Para este delta, qualquer crescimento do DOM acima desses tetos, salto de scroll,
perda de foco dirigido ou nova chamada de backend provocada por navegação local
é critério de **NO-GO**.

### S5 — integração transversal

- amizade/bloqueio;
- chat direto;
- notificações push e read status;
- mídia pública e acesso temporário;
- upload/visualização de mídia de teste;
- account lifecycle apenas em ambiente/conta de teste apropriada;
- billing: somente leituras e estados seguros, a menos que exista plano separado
  para teste financeiro em produção.

## 11. Observabilidade e critérios de abortar

Não inventar novos thresholds na janela. Usar os thresholds aprovados a partir
do baseline real.

Abortar imediatamente se ocorrer qualquer um dos seguintes:

- regressão de segurança/autorização;
- falso acesso ou falso bloqueio de maioridade;
- perda/corrupção de dados;
- duplicação de cobrança, notificação ou trigger;
- crescimento anormal de invocações/writes incompatível com o baseline;
- erro sustentado acima do threshold operacional aprovado;
- p95/p99 fora do envelope aprovado;
- índice necessário não READY;
- backfill truncado ou inconsistente;
- Rules bloqueando fluxo válido;
- frontend exigindo projeção ainda não concluída.

Ao abortar, **não avançar para a onda seguinte**.

## 12. Rollback

Rollback é por camada; não existe “reverter tudo” como primeira ação.

### Hosting

Rebuild/redeploy do `ROLLBACK_SHA` para Hosting. Não depender apenas de cache
ou de rollback visual do console.

### Functions

Redeploy seletivo das Functions afetadas a partir do `ROLLBACK_SHA`.
Não apagar Functions novas automaticamente. Triggers aliases/legados permanecem
até a estabilização justamente para reduzir risco de rollback.

Se um scheduler precisar ser interrompido, primeiro listar/confirmar o job real e
pausá-lo explicitamente; nunca adivinhar o nome do job.

### Firestore/Storage Rules

Redeploy dos arquivos do `ROLLBACK_SHA`. Se o rollback do frontend antigo
precisar de permissões antigas, essa compatibilidade deve ter sido preservada
desde o planejamento.

### Índices

Não remover durante a janela. Índices adicionais são preferíveis a derrubar um
rollback por índice ausente.

### Backfills/dados

Backfills deste rollout devem ser aditivos/idempotentes. Preferir correção
forward. Não importar Firestore completo para “desfazer” um backfill sem análise
de impacto, pois isso pode sobrescrever escritas legítimas feitas depois do
snapshot.

Para o índice `community_member_management_index`, rollback de F3/Hosting não
exige apagar a projeção: ela não concede autorização e pode permanecer inerte.
Se um sincronizador de F2 produzir writes anômalos, reverter somente a Function
afetada e interromper o B8. Nunca reconstruir membership, papel ou ownership a
partir dessa projeção.

Operações destrutivas, como cleanup de campo legado, ficam fora da janela
principal justamente para manter essa propriedade.

### Billing

Se houver ativação de webhook na mesma release (somente com GO específico),
registrar a configuração anterior antes do apply e reverter o endpoint/eventos
separadamente. Nunca imprimir ou versionar API keys/tokens.

A capability de mudança de valor da recorrência é um gate separado do checkout
recorrente. Antes de considerar `ASAAS_SUBSCRIPTION_UPDATE_ENABLED=true`:

- validar schedule + cancel de downgrade no Sandbox;
- confirmar que alteração de valor com cartão está habilitada para a conta
  Asaas de produção;
- validar que `updatePendingPayments: true` converge uma cobrança do próximo
  ciclo já criada sem alterar períodos pagos;
- validar cobrança menor recebida antes de `endsAt` e settlement somente na
  data efetiva;
- validar cancelamento do downgrade antes da data efetiva e restauração do
  valor recorrente atual;
- manter a flag **false/ausente** se qualquer requisito não estiver confirmado.

Ativar `ASAAS_RECURRING_ENABLED` não implica ativar
`ASAAS_SUBSCRIPTION_UPDATE_ENABLED`.

## 13. Janela operacional

Escolher a janela usando tráfego real; não presumir horário de menor uso.

Reservar uma janela controlada com congelamento de mudanças e período adicional
de observação. Sequência relativa:

- **T-24h:** fechar release SHA, revisar diff, validar staging e runbook;
- **T-60m:** confirmar CI, `validate:prod`, credenciais, alertas, backup e rollback;
- **T0:** deploy de índices;
- **T+:** somente após READY, executar F1 → smoke;
- depois F2 → smoke;
- executar dry-runs e backfills obrigatórios → validar;
- executar F3/F4/F5 conforme o diff → smoke por domínio;
- deploy de Rules/Storage compatíveis → smoke de autorização;
- deploy de Hosting → smoke end-to-end;
- manter observação reforçada e change freeze até os indicadores permanecerem
  dentro do envelope aprovado.

Não iniciar uma nova onda enquanto a anterior não estiver explicitamente verde.

## 14. Go/No-Go checklist final

**GO somente se todos estiverem marcados:**

- [ ] release SHA imutável e rollback SHA registrados;
- [ ] CI completo verde;
- [ ] `npm run validate:prod` verde;
- [ ] staging ensaiado no mesmo SHA;
- [ ] backup Firestore concluído;
- [ ] alertas/dashboards ativos;
- [ ] índices novos READY;
- [ ] índice de suspensões moderadas temporárias READY antes do reconciliador;
- [ ] diff de Rules classificado e compatível;
- [ ] Functions a implantar listadas por onda;
- [ ] aliases de triggers legados preservados;
- [ ] dry-runs dos backfills revisados, incluindo B8 quando aplicável;
- [ ] backfills obrigatórios concluídos antes do frontend;
- [ ] App Check e Web Push validados;
- [ ] billing recorrente explicitamente incluído ou explicitamente fora da janela;
- [ ] capability de update de recorrência Asaas homologada ou
      `ASAAS_SUBSCRIPTION_UPDATE_ENABLED` mantida desabilitada;
- [ ] smoke test accounts/dados preparados;
- [ ] smoke de sessão longa confirma teto de 72 cards no Discovery e 60 posts
      no Mural, âncora de scroll e navegação local sem chamadas extras;
- [ ] critérios de abortar e responsáveis conhecidos;
- [ ] rollback SHA buildável e procedimentos revisados;
- [ ] nenhuma mudança de ranking/preço/custo não relacionada misturada na release.

## 14.1. Compatibilidade temporária a retirar em release posterior

Além dos aliases de trigger já documentados, o callable
`getCommunityOwnershipCandidates` permanece temporariamente publicado para
clientes anteriores à paginação administrativa. Nenhum frontend novo pode
consumi-lo; o caminho canônico é `getCommunityOwnershipCandidatesPage`.

A remoção deve ocorrer em release separada e somente quando:

- Hosting novo estiver estável e sem rollback pendente;
- métricas de invocação confirmarem ausência de uso do callable legado durante
  a janela de observação definida para a release;
- `getCommunityOwnershipCandidatesPage` estiver com erro, latência e custo
  dentro do baseline;
- não houver sessão/cache de cliente anterior considerada suportada pela janela;
- rollback da remoção estiver documentado.

A retirada não deve ser misturada com mudanças de Rules, ranking, pricing,
billing ou capacidade.

## 15. Encerramento da janela

Após estabilidade:

- registrar SHA efetivamente implantado;
- registrar resultados dos smoke tests e backfills;
- comparar custo/erros/latência com baseline;
- confirmar ausência de filas/retries anormais;
- manter aliases/legados por período de estabilização definido;
- abrir release separada para remoção de compatibilidade antiga;
- somente então considerar tightening final de Rules ou cleanup destrutivo.

A implantação é considerada concluída apenas quando frontend e backend estão
coerentes, projeções foram migradas, observabilidade está estável e existe um
registro reproduzível do que foi implantado.
