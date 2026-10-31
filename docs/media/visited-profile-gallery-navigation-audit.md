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
