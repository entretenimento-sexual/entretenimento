# c18r — Captura parcial de recuperação, retentativas e orçamento de eventos

## Resultado de auditoria

O c18q passou nos quatro checks antes desta intervenção. A c18r examina
`admin-video-processing-recovery.handler.ts` e
`video-processing-reconciliation.firestore.ts`, preservando a distinção
entre mudanças de estado e operações que apenas movimentam leases,
`nextAttemptAt`, contadores de erros e mensagens.

A captura continua limitada. Falhas de provider GET, reservas de polling,
reservas de reconciliação, ações RECHECK_* sem transição e ajustes de
metadados **não** produzem um registro de transição. Isso reduz custo,
mas impede afirmar que o outbox registra toda mutação de um job.

## Novas operações instrumentadas

- `retryFailedJob`: `VERSION_REPLACED` na **mesma transação** que
  substitui o job FAILED por um novo QUEUED, preservando
  `processingVersion` antigo e `nextProcessingVersion` novo.
  A proteção canônica `lastAdminOperationId`, o fencing de estado,
  a proteção de origem e o cleanup anterior não mudam.
- `mutateExistingJob`: somente mudanças reais de estado administrativo
  (como CANCEL_ACTIVE) geram `STATE_TRANSITION`. RECHECK_PROVIDER,
  RECHECK_STALE e RECHECK_UNCONFIRMED não fabricam transições quando
  apenas modificam parâmetros.
- `updateRecoveredSubmissionIfCurrent`: registra mudanças reais entre
  SUBMITTING/PROCESSING/QUEUED/FAILED e `CANCEL_REQUESTED`; a resposta
  de fonte substituída pode retornar false e **ainda gravar o estado de
  cancelamento**. Esse evento só é gravado se a transação confirmar.
  As respostas antigas e versões substituídas não geram eventos.

O outbox permanece com um evento por transação de estado elegível e
com UUID escolhido fora do callback de retry. O evento não contém nomes
de provider jobs, URL, storage path, UID do proprietário ou texto de erros.

## Custo: limites e lacunas

| Operação | Escritas adicionais do outbox |
|---|---:|
| Uma transição/retentativa confirmada e instrumentada | 1 |
| Uma operação vetada por versão/claim | 0 |
| Uma transação abortada | 0 persistidas |
| Uma ação administrativa sem mudança de estado | 0 |
| Uma reserva de polling / falha de GET sem mudança de estado | 0 |
| Consulta externa para verificar transição | 0 acrescentadas |

A única cota garantida é o **máximo local de uma escrita de evento por
transação elegível**; não há limite de eventos por período nem orçamento
global de gravações ou cobranças. Não se pode inferir custo financeiro
a partir de contagem de chamadas do Emulator.

A coleção `media_video_processing_mutation_events` precisa de decisão
separada sobre prazo de retenção, autorização de leitura backend-only,
remoção de eventos e proteção de auditoria. Hash de identidade continua
sendo dado correlacionável e deve receber proteção adequada. Não ativar
TTL nem apagar histórico sem comprovar que a reconciliação independente
já consumiu e certificou o intervalo, pois isso destruiria evidências.

## Critérios ainda bloqueados

1. Falta instrumentar outros escritores (probe, preflight, backfill,
   várias transições do scheduler, escritores externos e migrações).
2. Não existe sequenciamento canônico de todos os escritores nem
   uma prova de que nenhum evento foi perdido.
3. Não existe backfill confiável do histórico anterior ao outbox.
4. Não há medição financeira de produção, plano de retenção aprovado,
   nem testes de carga com limites de custos.
5. Índices READY, efeitos temporais e nove requisitos do gate global
   ainda exigem evidência independente.

A c18r **não** altera `globalCoverageVerified=false`,
`globallySequenced=false`, a desativação de ordenação global ou o
bloqueio da c19. Não há deploy, PR, branch ou flag.
