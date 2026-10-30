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
