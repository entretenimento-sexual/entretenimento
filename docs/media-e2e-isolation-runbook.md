# Media E2E: contenção transacional e isolamento (1C2-A3b2b2c12)

A análise da CI do commit `c513ec75` encontrou grande volume de avisos
`Transaction lock timeout` e `ABORTED` no Firestore Emulator, embora os
quatro checks tenham terminado aprovados. Na execução analisada, os avisos
começaram quando `media-transaction-revocation.e2e.mjs` iniciou. Esta suíte
deliberadamente bloqueia a primeira tentativa transacional até uma alteração
concorrente e exige nova tentativa do Firestore (`attempts >= 2`) e ausência
de escrita indevida. Não equivale a uma falha de publicação de fotos.

Antes da c12, essa suíte compartilhava os emuladores Auth, Firestore, Storage
e Functions com as suítes de publicação/social. Alterações nos documentos
`users/{uid}` disparavam triggers de outros domínios, ampliando o ruído e a
contenção durante o teste de revogação. A nova ordem preserva a cobertura,
mas executa em **processos de emulador separados**, sem depender de sleeps:

1. `photo-publication.e2e.mjs` e `photo-social.e2e.mjs` continuam a testar
   callables e triggers em Auth/Firestore/Storage/Functions, usando o mesmo
   projeto `demo-entretenimento-media-e2e` e as mesmas verificações.
2. Após encerramento dos quatro emuladores, um novo Firestore Emulator é
   iniciado, sozinho, para `media-transaction-revocation.e2e.mjs`.
3. A suíte transacional preserva seus 11 cenários, barreiras de concorrência,
   reexecuções reais e asserts de não gravação após revogação. Nenhum teste
   foi ignorado; `&&` interrompe o pipeline se qualquer processo falhar.

`npm run test:media:e2e` executa o fluxo completo e compila Functions
uma vez. `npm run test:media:transaction:e2e` mantém a entrada independente
original e delega ao comando interno
`npm run test:media:transaction:isolated:e2e`.

O runner padrão não usa mais `--debug`, evitando repetição volumosa de
eventos do emulador e dados sensíveis em logs. A CI conserva a saída original
da suíte e seus códigos de saída; erros continuam falhando o check.
`summarize-photo-e2e-contention.mjs` resume *apenas* números de linhas
contendo avisos, marcadores de cenários e presença do marcador de conclusão,
sem imprimir UIDs, mensagens ou conteúdo privado. Este resumo é somente
diagnóstico: `executionResult: NOT_INFERRED` significa que avisos não
comprovam falha nem recuperação e que o resultado conclusivo vem do check
da CI. Logs de emulador podem duplicar eventos, então contagens de linhas
não representam transações distintas.

A transação sob teste ainda pode apresentar contenção intencional: o
Firestore Emulator pode manter locks enquanto a primeira tentativa aguarda
sinal de concorrência, e isso não deve ser ocultado ou alterado sem evidência.
Investigar persistência de `Transaction lock timeout`, aumento de tempo ou
falhas de asserção em nova CI antes de modificar o contrato transacional.
A intervenção não altera regras do Firestore, produção, quotas, jobs,
publicação, moderação, version fencing ou cancelamentos.
