# Auditoria de navegação do perfil visitado e das galerias

Data: 30/10/2026. Código atualizado diretamente na `main`, sem branch, PR ou merge.

## Contratos validados em código

- Perfil do proprietário: `/perfil`; perfil de outra pessoa: `/outro-perfil/:id`. Galerias de fotos e vídeos compartilham `visitedProfileReturnRoute`.
- Em fotos, o modal mantém trava de abertura até seu fechamento usando `openWithResult$()`, sem alterar as regras canônicas de mídia.
- As listas de fotos e vídeos mantêm os itens selecionados e suas permissões; a grade de fotos usa `role=list` e `role=listitem`.
- Galeria de vídeos oferece retorno compacto ao perfil com foco visível e área mínima de toque de 44 px.
- Continuam obrigatórios os controles de publicação, moderação, bloqueio bilateral e URLs assinadas.

## Evidência e pendências

Testes de contrato e regressão adicionados/ajustados. Os vínculos das duas galerias e os testes correspondentes foram conferidos na `main`; **a execução do build/testes Angular ainda precisa de resultado local**. A aprovação do E2E administrativo de backfill é pendência separada; não inferir aprovação de commits de frontend.

Sem migração, deploy ou escrita em dados de produção.

## Retorno da suíte frontend (30/10/2026)

Execução fornecida: 491 arquivos de teste; 484 aprovados, 7 arquivos com falhas;
2.821 testes aprovados, 8 falhos, total 2.829.

As oito falhas foram atribuídas a: expectativa antiga do cabeçalho de vídeo;
duas expectativas antigas de rota de vídeo; expectativa antiga do motivo de
reciprocidade (`incompatible_profile` versus `reciprocal_mismatch`); mock
`CurrentUserStoreService` ausente no teste do `ResizeObserver`; asserção
dependente de LF em fonte CRLF; e duas expectativas de chaves de cache `v3`
quando a implementação usa `v4`.

Foram corrigidos os contratos dos testes e adicionado o mock no fixture.
Nenhuma política de segurança nem comportamento de discovery foi alterado
para satisfazer os asserts. A execução integral da suíte após essas correções
continua pendente. Comando: `npm.cmd test -- --watch=false`.

## Conclusão da suíte Angular e ajuste editorial do perfil — 30/10/2026

Resultado enviado pelo operador: **491/491 arquivos e 2.829/2.829 testes Angular aprovados**, zero falhas. Os registros `NG04002`, warnings de `disabled` em formulários reativos, contextos Firebase e operações não implementadas pelo jsdom são mensagens não bloqueantes da suíte; devem ser acompanhados sem confundi-los com testes fracassados.

Após essa execução, o cabeçalho do perfil visitado foi redistribuído para três papéis independentes: avatar, identidade e ações reais. Em superfícies largas, a ação fica na terceira coluna; para largura útil até 900 px, o CSS container query a desloca para uma linha completa, inclusive quando a barra lateral reduz o espaço disponível sem reduzir o viewport. O painel Sobre passou a agrupar preferências **já autorizadas** em cartões compactos com grade autoajustável; nenhum dado novo é buscado, omitido ou inferido. Não houve alteração dos métodos de amizade, conversa, denúncia ou do viewer.

Os testes de layout e DOM para essa nova revisão foram adicionados. **Eles ainda devem ser executados localmente**; o resultado de 2.829 testes é a linha de base anterior a estes commits. Validar com `npm.cmd run build:emu` e `npm.cmd test -- --watch=false`, e fazer inspeção visual real nos pontos de largura descritos no contrato editorial. Sem deploy, alterações em dados de produção, branches ou PRs.

## Falha observada na visita — 31/10/2026

Na visita visual a outro perfil em localhost, foi exibido indevidamente um modal de
"Ação não permitida" / "Você não tem permissão para acessar ou alterar esta mídia",
apesar de não existir tentativa de alteração. A seção de mídias exibiu falha
de carregamento. O console confirmou rejeição de **leitura** na regra gerada
`firestore.rules`, linha 1318 (`allow get` de `public_profiles/{userId}`),
enquanto `MediaPublicPreviewQueryService.getProfileMediaMetrics$` lia
`docData(public_profiles/{uid})`. Essa rejeição, por si só, não confirma se
o motivo foi a elegibilidade da sessão, o lifecycle do proprietário ou a
projeção legada ainda contaminada; as Rules intencionalmente falham fechado.

Correção:
- métrica de contagem e capa é auxiliar; se essa leitura falhar,
  emitir diagnóstico **silencioso** pelo `MediaApplicationErrorService`
  e usar métricas vazias para permitir que a **callable pública autorizada**
  continue buscando os candidatos;
- nunca ler `users/`, foto privada ou vídeo privado como fallback;
- erros da callable e de URLs assinadas **não são convertidos em sucesso**;
  a seção mostra o estado de erro próprio com ação de repetição;
- o componente que mostra erro inline informa a camada canônica com
  `silent: true`, impedindo um modal intrusivo e enganoso na visita.

Incluídos testes que simulam negação da consulta auxiliar,
preservação das mídias públicas autorizadas, propagação da recusa na
callable e apresentação exclusivamente inline. **Teste no navegador e
build/suíte após esses commits ainda pendentes**. Nenhuma regra de
privacidade/autorizações foi afrouxada. Fluxo: commits diretos na
`main`, sem branch/PR e sem deploy.

## Nova confirmação visual e eliminação da leitura duplicada — 31/10/2026

O operador enviou screenshot com duas fotos e um vídeo carregados, sem o
modal de ação não permitida; a nova suíte Angular teve **491/491 arquivos
e 2.835/2.835 testes aprovados**. O console ainda registrava o erro
silencioso de `getProfileMediaMetrics$` em `public_profiles/{uid}` na
regra de `get` (linha 1318 do gerado). Era uma consulta redundante:
o bootstrap do perfil já usa a Callable de discovery que saneia os dados,
revalida o proprietário e retorna `photosCount` e `videosCount`.

A prévia passa a receber os **metadados públicos já autorizados no
bootstrap**, via `profileMetrics`, em vez de repetir o `get` direto do
documento `public_profiles`. A projeção backend de discovery publica
também `coverPhotoId`, exclusivamente como ID da capa pública calculada
pelo agregador de mídias aprovadas. A seleção de capa fora da janela
continua revalidando `PUBLIC` e `APPROVED` pela leitura documental
protegida. Na ausência de métricas, somente os candidatos autorizados
pela Callable compõem a contagem mínima exibida, sem ler `users/`.

O layout foi compactado: redução do padding superior do hero,
ações na coluna lateral em áreas úteis amplas, quebra próxima à identidade
até 740px e expansão para a linha completa até 480px. Acessibilidade,
44px, métodos, ações, rotas, viewer e restrições permaneceram.

**Estado:** alterações de frontend, backend de discovery e testes
adicionais publicadas diretamente na `main`, sem branch/PR ou deploy.
A validação de compilação e testes desta revisão, bem como a inspeção
visual em diferentes larguras, ainda precisa ocorrer no checkout local;
não confundir os 2.835 testes aprovados anteriormente com a nova suíte.

## Revisão do retorno do viewer após suíte 2.840/2.840 — 31/10/2026

O operador apresentou nova execução Angular: **491/491 arquivos e 2.840/2.840 testes aprovados**. Os warnings de jsdom, Forms e `httpsCallable` permanecem não bloqueantes na suíte. O arquivo enviado apresenta apenas a execução Angular; a aprovação de builds/backend e a verificação visual da última revisão não são deduzidas desse registro.

**Bug concreto detectado na revisão estática:** a primeira prévia pública preservava `coverPhotoId` vindo de discovery, mas `ProfileMediaShowcaseViewerFacade.open$` reexecutava a mesma consulta sem os metadados. Caso a capa estivesse fora da primeira janela, a miniatura selecionada deixaria de ser encontrada no refresh e o viewer apresentaria falsa indisponibilidade.

**Correção:** `open$` recebe opcionalmente o mesmo snapshot público já autorizado, repassa-o a `getProfilePublicMediaPreview$` e mantém o refresh que verifica publicação, audiência e moderação antes do viewer. `ProfileMediaShowcaseComponent` observa mudanças reais dos metadados, mas compara os valores para não executar uma nova callable a cada atualização equivalente do objeto no template. O contexto do snapshot traz `ownerUid`; a query ignora os metadados quando eles pertencem a outro proprietário, evitando reaproveitamento de contagens/capa em mudança de rota. Mídias bloqueadas ou revogadas continuam indisponíveis.

Incluídos testes para a capa fora da janela, estabilidade da reatividade, passagem do snapshot ao viewer e troca de proprietário. **Os novos testes ainda precisam ser executados localmente**: eles não fazem parte dos 2.840 aprovados anteriormente. Sem alteração das Rules, sem deploy, branch ou PR.

## Viewer público de foto: correção visual após captura real — 31/10/2026

A captura do usuário mostra um viewer imersivo de foto do perfil visitado no desktop,
com a imagem tomando praticamente toda a altura da janela, o selo redundante
`Do perfil` no cabeçalho e a caixa de comentários separada do campo de resposta
por uma grande faixa vazia. A suíte entregue antes desta correção estava verde:
**491/491 arquivos e 2.844/2.844 testes**, sem falhas.

Diagnóstico de CSS:
- `.viewer-img` usava `max-height: calc(100dvh - 68px)` apesar de ficar
  dentro de painel que também reserva cabeçalho e padding; o limite do conteúdo
  não era a dimensão efetiva do grid;
- `.comments-empty` tinha `flex: 1 1 auto`, empurrando o formulário de
  comentários para o rodapé mesmo sem mensagens;
- o componente de recomendação exibia `Do perfil` quando `source='profile'`,
  um segundo rótulo de origem ao lado do usuário já identificado.

Correção localizada em `photo-viewer.component.css/html`, compartilhada pelo
`PhotoViewerComponent` e `PublicMixedPhotoViewerComponent`:
- imagem dimensionada pelo painel (`width/height/max-width/max-height: 100%`
  e `object-fit: contain`), com padding próprio e overflow contido;
- coluna de comentários com largura e fluxo compactos; estado vazio não estica,
  formulário e reações permanecem próximos;
- cabeçalho compacto sem projeção de suplemento vazio e sem `Do perfil`
  redundante; selo `Oficial` continua preservado;
- layout adaptativo em tablet, smartphone e paisagem de baixa altura,
  mantendo controles de 44px, anúncios/atalhos e as interações existentes.

Cobertura adicional: contrato de CSS/HTML para desktop, tablet, mobile e
paisagem; teste de componente para ausência do selo redundante sem suprimir
o link do proprietário. Nenhuma modificação em Rules, autorizações, moderação,
conteúdo ou rotas. **Os novos testes e a renderização em navegador ainda
precisam ser verificados no checkout local.** Alterações diretamente na `main`,
sem branch ou PR, sem deploy de produção.

## Conferência da galeria de fotos — 31/10/2026

Captura real do operador com o perfil `prfseves RJ` mostra **duas fotos públicas carregadas**; nenhuma falha de permissão ou de viewer é visível nessa tela. O log anexo encerra com **492/492 arquivos e 2.849/2.849 testes Angular aprovados**. Esse resultado corresponde à `main` anterior à correção editorial descrita aqui.

Observações: título e seta de retorno estavam em extremidades opostas do cabeçalho; o bloco de identidade mantinha padding de banner grande mesmo na galeria; duas fotos ocupavam as duas primeiras células da grade, com o restante naturalmente vazio. **Não ampliar duas fotos para preencher quatro colunas**: preservar densidade, proporção, ordem e paginação da coleção.

Correção localizada:
- seta de voltar junto ao título, mantendo `app-page-header` canônico, `routerLink` já validado e tap-target 44 px;
- identidade das galerias de fotos e vídeos com menor altura, avatar/tipografia compactos e fundo editorial discreto; ambas seguem a mesma escala;
- contador discreto indica quantas fotos foram realmente carregadas e distingue carregamento parcial (`hasMore`), sem afirmar total desconhecido;
- grid de 1–4 colunas, thumbnails uniformes e sem promoção artificial de capa, além de viewer, seleção por ID e URLs assinadas intactos.

Contratos de layout atualizados para os dois tipos de mídia. **A compilação/testes após estes commits e a confirmação visual ainda precisam ocorrer localmente**; 2.849 testes aprovados não incluem esta revisão. Nenhuma alteração das Rules, moderação, dados pessoais, deploy de produção, branch ou PR.

## Galerias: remover cabeçalho duplicado e mostrar quantitativo na aba — 31/10/2026

Capturas de validação mostram a galeria pública de fotos com **dois títulos visuais**
para a mesma seção: barra superior “Fotos” com retorno e contador “2 fotos”,
seguida de cartão de identidade e aba “Fotos” ativa. A duplicação aumenta
a altura e coloca o contador longe da navegação correspondente.

Decisão editorial aplicada simetricamente a fotos e vídeos:
- eliminar a barra superior visível e seu retorno redundante, porque **Perfil**
  na navegação abaixo já é um link canônico de retorno ao proprietário;
- preservar `app-page-header` como `h1` semanticamente acessível dentro de
  `visually-hidden`, sem introduzir um segundo título visual;
- apresentar a quantidade de itens **efetivamente carregados** como badge na
  aba ativa (por exemplo **Fotos 2** ou **Vídeos 2**), com `+` caso exista
  paginação pendente; não afirmar quantidade total sem confirmação do backend;
- continuar anunciando a quantidade e a existência de páginas restantes a
  leitores de tela, manter `aria-current="page"` e área mínima de toque
  de 44 px; manter abas **Perfil/Fotos/Vídeos** e rotas existentes;
- remover seletores CSS aposentados, sem alterar cartões, ordem, moderação,
  permissões, URLs ou comportamento do viewer.

Os testes estáticos de HTML/CSS e o contrato arquitetural do PageHeader foram
ajustados para impedir o retorno da duplicação. A última execução **antes**
dessa revisão aprovou 492/492 arquivos e 2.851/2.851 testes. **A execução da
nova compilação e testes no Windows ainda precisa ser informada**. Código
diretamente na `main`; sem branches, PRs, migração ou deploy em produção.

## Consulta pública HTTP 429 ao navegar no perfil — 31/10/2026

O console real do usuário apresentou **7 POSTs HTTP 429** da Callable
`getPublicProfilesPage` em `127.0.0.1:5001`, seguidos de registros
duplicados de `Muitas consultas de perfis foram feitas em pouco tempo.`
O serviço usa limite backend de **20 unidades/60 s** e
**100 unidades/10 min**, com custo por quantidade de perfis; esses limites
**não foram aumentados nem removidos**. A suíte Angular 2.851/2.851
e o `build:emu` aprovados antes não exercitavam esse cenário de interação
contínua.

Diagnóstico/correções:
- `PublicProfileReadBoundaryService` compartilha somente requisições
  *simultâneas e idênticas* da mesma sessão. Após finalizar, a leitura é
  descartada (sem cache de exposição/autorização).
- A resposta `functions/resource-exhausted` estabelece cooldown local
  restrito ao UID do viewer, respeitando `details.retryAfterMs` do
  backend (fallback conservador). Novas tentativas nesse intervalo
  falham fechadas **sem novo POST**, sem conteúdo antigo e sem afetar outras
  sessões.
- Consulta individual ao perfil visitado mantém `forceRefresh: true`
  e obtém o erro explícito no bootstrap; erro transitório deixa de ser
  mascarado como `Perfil indisponível`. A interface apresenta
  `Não foi possível carregar o perfil` e `Tentar novamente`.
- Os demais consumidores de `getProfilesByUids$` preservam o contrato
  legado por padrão; propagação de erro é opt-in. O registro técnico
  permanece nos handlers de erro canônicos.

Cobertura adicionada: chamadas em voo, cooldown/retorno, separação entre
sessões, não amortecimento de `permission-denied`, propagação opt-in
do erro e estado diferenciado do perfil visitado.

**Pendente:** executar compilação e novos testes no checkout Windows e
reproduzir navegação real após fim da janela de quota. Nenhuma alteração em
Rules, backend do limitador, deploy de produção, branch ou PR.

## Otimização do percurso Pessoas → Perfil → Fotos/Vídeos — 31/10/2026

Validação de navegador anterior: 10 POSTs HTTP 200 e 3 preflights HTTP 204
de `getPublicProfilesPage` em cerca de 35 s; zero HTTP 429 na janela.
O Response de ~2 KB continha somente o perfil visitado (1 UID,
`scanned=1`); o de ~4,9 KB continha três perfis (`scanned=3`),
compatível com listagem de descoberta. Apenas esses Responses, sem o
Payload, **não provam** repetição exata das requisições.

Causa de duplicação confirmada pelo código: `PublicPhotoAccessService` e
`PublicVideoAccessService` já passam pelo enriquecimento do autor em
`UserDiscoveryQueryService.getProfilesByUids$` antes da hidratação pública.
As páginas das galerias realizavam **outra** `getPublicUserById$` só para
montar o cabeçalho, mesmo quando a primeira leitura autorizada já havia
retornado nickname/identidade/localidade do mesmo proprietário.

Correção:
- função pura `publicGalleryOwnerIdentityFromMedia` valida
  `ownerUid`, audiência `PUBLIC`, moderação `APPROVED`, nickname e
  marcador **transitório** `ownerIdentityFromPublicProfile`, emitido
  somente quando o enriquecimento de `public_profiles` retornou um autor
  atual; projeções legadas sem lookup vigente não podem autenticar cabeçalhos;
  o mapper de vídeo descarta marcadores presentes no documento de origem;
- galerias de fotos e vídeos derivam o cabeçalho da mesma página **já
  autorizada**, sem consulta extra quando o item possui identidade;
  `distinctUntilChanged` evita refetch ao paginar e `switchMap` impede
  reaproveitamento entre perfis; vídeo compara identidade integral da rota;
- quando página vazia ou mídia legada não traz o resumo público completo,
  o fallback permanece via `getPublicUserById$`; erro de autorização da
  mídia não é transformado em cabeçalho antigo;
- o cache público por UID deixa de **persistir** resultados sem
  `ageEligibilityVerifiedAdult` e `ageEligibilityValidUntil` válidos,
  que o próprio cache já se recusava a usar; `forceRefresh` pula até
  a leitura local, exigindo a resposta vigente do backend. Nenhuma
  validação foi relaxada, e não introduzimos TTL novo para exposição
  autorizada;
- no perfil visitado, os botões `Fotos` e `Vídeos` dentro da seção
  `Mídias` foram removidos, já que as abas de navegação cumprem essa
  função; o título `Mídias`, o mosaico e os viewers permanecem.

Cobertura adicionada: cabeçalho derivado de fotos/vídeos aprovados,
sem segunda consulta, fallback sem mídia, preservação após paginação,
isolamento por UID, moderação/audiência e ausência de inferência de
orientação para casais. Ajustados contratos de cache e layout.

**Pendente:** executar `build:emu`, suíte Angular e validação Network
no Windows após sincronizar a `main`. Os 2.859 testes previamente aprovados
não incluem essa rodada. Nenhuma alteração do backend, Rules, quota ou deploy.
Trabalho exclusivamente na `main` sem branch ou PR.

## Acabamento responsivo do perfil e galerias — 31/10/2026

Etapa seguinte à validação de quota (captura com sete respostas HTTP 200,
três preflights 204 e zero HTTP 429 em `getPublicProfilesPage`; não equivale
a medição estritamente controlada do percurso).

- `ProfileMediaShowcaseComponent`: cabeçalho **Mídias** alinhado ao início,
  com margem do título zerada, para seguir o mesmo eixo da seção **Sobre**.
  A grade, a ordem de seleção, o lançamento do viewer e o retorno de foco
  são preservados.
- `OtherUserProfileViewComponent`: abas adaptadas à largura efetiva do
  contêiner `visited-profile`, inclusive quando o navegador é largo e
  o perfil está restrito por um shell/sidebar. Rolagem horizontal quando
  necessária, barra fina perceptível e alvos de 44px mantidos.
- `PublicProfileVideosComponent`: `min-width: 0` e
  `box-sizing: border-box` evitam que largura integral mais padding
  excedam o espaço disponível. A galeria de fotos já tinha essa proteção.
- Novos testes de contrato para alinhamento, quebra responsiva e largura
  da galeria. Sem mudanças em Callables, permissões, moderação, quotas,
  paginação, retorno canônico ou URLs de acesso temporário.

Validação estática de seletores e estrutura aprovada no GitHub; executar
`npm.cmd run build:emu` e `npm.cmd test -- --watch=false` após
sincronização local. Não foi realizado deploy. Edição somente na `main`,
sem branches ou PRs.

## Reutilização do perfil visitado ao navegar entre usuários — 31/10/2026

Auditoria funcional do percurso Pessoas → Perfil → Galerias → Perfil identificou
que `OtherUserProfileViewComponent` chamava o bootstrap somente em `ngOnInit`.
Ao trocar apenas o parâmetro `/outro-perfil/:id`, o Angular pode reutilizar
esta instância e manter o perfil anterior em tela.

O carregamento agora observa o `paramMap` e o retry em um único fluxo RxJS:
`switchMap` cancela resultados obsoletos; ao mudar o alvo, a identidade e
contextos de amizade/intenção anteriores são limpos enquanto o novo perfil
carrega. O orquestrador recebe o UID da emissão atual, sem depender do
`snapshot` desatualizado, preservando a assinatura antiga como padrão para
outros consumidores. Testes cobrem A → B (pendente) → C, resposta atrasada de
B e retry após erro transitório. Sem mudança de Rules, política de mídias,
URLs, galeria, viewer, rotas públicas, backend ou deploy. Alterações somente
na `main`, sem branch ou PR.

**Validação pendente:** build Angular e suíte no checkout local. A inspeção
estática e os testes acrescentados não equivalem a execução verde.

## Navegação entre galerias: isolamento de requisições e erros — 31/10/2026

Auditoria estática adicional da `main` após o commit `3496dcd`:

- Ao trocar de perfil, deep link ou repetir a leitura, requisições ainda pendentes de páginas adicionais de fotos e vídeos agora perdem sua inscrição RxJS. As guardas de revisão e identidade existentes continuam protegendo o estado. **O cancelamento da inscrição não significa que o transporte HTTP/Callable já iniciado seja abortado no servidor.**
- Na galeria de vídeos, a agregação das páginas exige `ownerUid` igual ao proprietário atual; itens de outro proprietário não podem compor o mosaico da rota. O carregamento de vídeo individual por deep link também exige coincidência de `ownerUid` e `id` antes de montar a tela, sem substituir validações de autorização do backend.
- Em fotos, a falha ao carregar mais itens passa por `MediaApplicationErrorService.report` com `silent: true`, mantendo a mensagem inline e a opção de repetir sem modal duplicado.
- Contratos unitários atualizados para recusa de vídeos de outro perfil, cancelamento de leituras obsoletas, aviso centralizado e preservação da paginação.

Sem mudança nas regras de visibilidade, moderação, assinaturas, backend, URLs, downloads ou compartilhamentos externos. **As alterações estão sujeitas à compilação e execução local da suíte**; a auditoria estática não equivale a testes executados.


## Deduplicação de chamadas durante navegação rápida — 01/11/2026

A captura Network exibe 23 requisições filtradas por `getPublicProfilesPage` no
conjunto de 234 registros (inclui fetch e preflight). Os HTTP 200/204 vistos não
identificam sozinhos os payloads, portanto **a captura não prova POSTs idênticos**.

Na revisão da fronteira pública foi confirmado um caso reprodutível:
`shareReplay({ refCount: true })` interrompia a inscrição quando a rota era
destruída, porém `from(Promise)` não aborta a Callable já iniciada. A entrada
pendente saía do mapa e uma remontagem imediata podia disparar **novo POST
idêntico enquanto o primeiro ainda estava em voo**.

Correção restrita a `PublicProfileReadBoundaryService`: compartilhar o
Observable até a Promise se resolver, com `refCount: false` e descarte da
entrada em `finalize`. O resultado não é reaproveitado após conclusão,
erros de autorização continuam falhando fechados, e os limites 20/60 s e
100/10 min não foram alterados. O escopo continua separado por UID da sessão.
Se um componente deixar de escutar, a resposta não será renderizada nele.

Dois testes de regressão cobrem desmontagem/remontagem A → B → A durante um
POST ainda pendente e isolamento entre viewers. Mantidos nomes de métodos,
assinaturas, fluxos RxJS e tratamento centralizado de erros. Nenhum deploy,
branch ou PR. **Build Angular e suíte ainda exigem execução local**.

## Correção do contrato arquitetural do perfil visitado — 01/11/2026

Evidências locais enviadas: `npm.cmd run build:emu` concluído com sucesso
(avisos NG8102/NG8107 não bloqueantes em moderação administrativa); suíte Angular
com **493/494 arquivos aprovados e 2.880/2.881 testes aprovados**.
A única falha está em `src/app/shared/ui-canonical-boundary.architecture.spec.ts`
(linha 800), porque o componente visual passou a importar `ActivatedRoute`
para lidar com a reutilização de `/outro-perfil/:id`. Os 6 testes da fronteira
de leitura pública, incluindo deduplicação de Callables, foram aprovados.

Correção pontual: observação de `paramMap` e normalização/estabilidade do UID
encapsuladas em `VisitedProfileBootstrapOrchestrator.observeTargetUid$()`.
O componente conserva `combineLatest`, `switchMap`, o estado de retry, a
limpeza de proprietário e o cancelamento de resultados obsoletos, mas não importa
nem injeta `ActivatedRoute`. O contrato arquitetural **não foi alterado nem
enfraquecido**. Teste unitário adicionado para A → A normalizado → B → C por
`uid` → rota vazia.

Sem mudança de contratos externos, backend, moderação, regras de acesso,
URLs assinadas, viewers, cache ou limites. Publicação somente na `main`,
sem branch ou PR. **A nova suíte e a compilação ainda devem ser executadas
após sincronização local para considerar a correção validada.**
