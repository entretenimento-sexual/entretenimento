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
