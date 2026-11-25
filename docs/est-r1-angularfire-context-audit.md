# EST-R1.1 — revisão residual de contextos AngularFire

Base: commit 8813ca81, Quality Gate 45628433882, aprovado (3.289 testes Angular).
O inventário da CI analisou 881 arquivos de produção e 463 chamadas diretas:
257 com contexto explícito, 110 em construção e 96 candidatas à revisão
(ante 123 na execução anterior).

## Revisão dos candidatos

- Providers e conectores: configuração síncrona de bootstrap nas fábricas provide*;
  não substituir por chamadas tardias nem alterar a topologia de emuladores.
- Admin guard: user(auth) é construído na invocação síncrona do guard Angular.
- FirestoreQueryService: as constraints são criadas pelo buildConstraints()
  invocado dentro de ctx.deferObservable$.
- FirestoreWriteService: a fábrica é invocada por ctx.run no helper de escrita.
- Repositórios de amizade: inCtxSync/inCtx$ restauram o contexto. eventsCol é
  chamado por listBlockEvents dentro da fábrica. Não expandir permissões.
- Foto, publicação, acesso, tracking e links sociais: as chamadas AngularFire
  sinalizadas são executadas antes do primeiro await nas fábricas protegidas.
  As sentinelas de links sociais após await foram movidas ao SDK nativo.
- Adapters de visibilidade de perfil e mídia: invocados dentro de
  deferObservable$ em cada nova assinatura; regressões específicas já aprovadas.
- Push: callables criadas sincronamente na fábrica do token de injeção.
- As chamadas httpsCallable em inicializadores de instância permanecem
  construídas no contexto de DI dos serviços.

Não há nova correção de contexto comprovada entre esses candidatos nesta
revisão. O auditor continua report-only, sem suprimir candidatos ou considerar
aliases/fluxo interprocedural automaticamente seguros. Esta revisão não é prova
de ausência de warnings em runtime: homologar cadastro, logout, bloqueio,
mídias, Chat e duas sessões na EST-R1.5.

## EST-R1.2 — primeira intervenção

Deduplicação de leituras one-shot de amizade, perfis públicos e mídia pública,
por identidade técnica, versão de encerramento e chave completa da requisição.
Sem cache de resposta concluída, sem compartilhar entre sessões, sem alterar
quotas, Rules ou autoridade do backend. Em logout a assinatura é revogada;
não há promessa de cancelar a requisição HTTP já iniciada. O polling de
amizade preserva o UID esperado e encerra quando a sessão muda.

A redução real de POSTs e da contenção do emulador depende de homologação.
