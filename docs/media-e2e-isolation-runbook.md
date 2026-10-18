# Media E2E: contenção, isolamento e duração (1C2-A3b2b2c12–c14)

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

## c13 — Redução de latência sem perda de cobertura

No commit c12, a suíte isolada de 11 cenários terminou aprovada, mas a maior
parte do tempo foi consumida pelos nove cenários de revogação: cerca de
10 minutos e 26 segundos, com esperas de 60–70 segundos por cenário.
A documentação do Firestore Emulator ressalva que ele não reproduz
integralmente os modos de concorrência da produção e pode manter
locks em operações sobre o mesmo documento. Ausência de mensagens
`ABORTED` sem `--debug` **não prova ausência de contenção**.

O c13 preserva a ordem **dentro** de cada cenário: leitura transacional,
gravação concorrente da revogação, liberação da primeira tentativa,
retry real e asserção de ausência de métrica persistida. Para reduzir
tempo total sem relaxar essa garantia, executa até **três cenários
independentes em paralelo**. Cada cenário usa novos documentos de
viewer, owner, blocks e metric; os dois cenários positivos terminam
antes dos nove de revogação. Um executor limitado drena todos os jobs
em andamento antes de encerrar a conexão do Firestore e propaga
todas as falhas de cenários ao CI.

Cada revogação bem-sucedida registra `[media-tx:e2e] TIMING` com
apenas inteiros de tempo monotônico (`firstReadWaitMs`,
`competingWriteWaitMs`, `settleWaitMs`, `totalMs`, `attempts`).
O cronômetro do conjunto emite `DURATION_MS`. O sumarizador
aceita somente esses números, sem labels, UIDs ou caminhos, e mantém
`executionResult: NOT_INFERRED`: a CI continua sendo autoridade
sobre aprovação. O campo `revocationSuiteWallMs` permite comparar
o tempo da suíte entre execuções sem confundir soma por cenário
com tempo decorrido. O aumento de paralelismo não deve ser considerado
uma correção dos locks internos do emulador.

Em regressões, verificar o máximo de espera pela gravação concorrente,
tentativas >= 2 por cenário e a conclusão dos 11 cenários. Se houver
contenção cruzada ou aumento de duração, reduzir o limite de
paralelismo após diagnóstico. Não alterar o ciclo transacional para
permitir o commit da primeira tentativa antes da revogação.

## c14 — Variabilidade do E2E e suporte com equipe reduzida

Base observada no c13: 202.487 ms de tempo da suíte isolada; 11/11 cenários,
nove revogações com retry real (mínimo duas tentativas), sem gravação de
métrica após a revogação. A nova política offline
`photo-e2e-performance.policy.mjs` diferencia **integridade dos marcadores**
de um **sinal consultivo de latência**. A referência de 202.487 ms é
uma única execução, não uma média, tendência ou percentil de múltiplos runs.
Por isso, a linha de revisão operacional de 360.000 ms é conservadora
e **não reprova a CI**: um período lento do Firestore Emulator não prova
regressão na segurança. O exit code e as asserções E2E continuam a autoridade.

Procedimento para equipe enxuta: no job Photo publication and moderation E2E,
verificar primeiro a conclusão dos 11 cenários e o check; depois ler
`performanceReview`, `revocationSuiteWallMs`,
`revocationMaxCompetingWriteWaitMs`, `revocationTimedCases` e
`revocationMaxAttempts`. Em `REVIEW_LATENCY`, comparar pelo menos
três execuções concluídas antes de ajustar o limite 3 de paralelismo.
Em `NOT_ASSESSED`, checar logs e término da suíte; não confundir
ausência de `ABORTED` com integridade.

Para feedback ao usuário, a topologia é:
- erro específico de vídeo/foto -> `MediaApplicationErrorService` com
  reason do catálogo -> `ApplicationErrorService`;
- erro de transporte transitório com o navegador efetivamente offline ->
  mensagem canônica de conexão da camada Network;
- `ApplicationErrorService` notifica uma vez via
  `ErrorNotificationService` e envia diagnóstico sanitizado ao
  `GlobalErrorHandlerService` com `skipUserNotification`;
- motivos canônicos de suspensão, moderação, termos, permissão e
  indisponibilidade de conteúdo não são substituídos por “offline” só
  porque o navegador perdeu a conexão. `reportSilently` preserva
  ausência de toast duplicado.

Se ocorrer erro de vídeo, registrar para triagem apenas operação, código
normalizado, reason e momento de execução do check. Não registrar URLs
assinadas, tokens, IDs de usuários ou conteúdo; não inserir novos
listeners, polling, retries em escritas, chamadas Transcoder nem novas
coleções Firestore para diagnóstico. Depuração começa pelo resultado da CI,
separa falha de produto de falha do emulador e escala apenas ocorrências
reproduzíveis no fluxo real.
